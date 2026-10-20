import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod/v4';
import { boundFetch } from './fetch.js';
import type { ExtractedEvent } from './types.js';

export interface ExtractInput {
  url: string;
  /** Visible page text (see htmlToText). */
  text: string;
  /** Local date the page is read on, so "Sat 24.10" gets the right year. */
  today: string;
  timeZone: string;
  categories: { id: string; label: string }[];
}

/** Turns page text into events when a page has no structured data. Swappable behind config. */
export interface Extractor {
  /** Identifies provider + model, part of the extraction cache key. */
  readonly id: string;
  extract(input: ExtractInput): Promise<ExtractedEvent[]>;
}

export class ExtractionRefusedError extends Error {}

// Stable across requests so it can be cached; everything that varies goes in the user message.
const SYSTEM = `You extract real-world events from the text of one web page, for a map of what is happening near the reader.

Return every event on the page that takes place at a physical place and has a date. A listing page can hold many events; an event page usually holds one, plus "similar events" teasers that you should skip unless the page is itself a listing. Skip online-only events unless you mark them as online_only, and skip navigation, ads, newsletters and opening hours that are not events.

Report only what the page states. Use null when the page does not say (for example no end time or no price); never invent a venue, address, time or price. Dates and times are local to the given time zone: write dates as YYYY-MM-DD and times as HH:MM (24 h). When the page gives a day and month without a year, choose the next such date on or after today.

Keep titles in the page's language and as written, without prices or ticket text. category_ids must come from the given list; pick one, or two if both clearly apply.

confidence is how sure you are about the title, date, start time and place together: about 0.9 when all are stated plainly, 0.6 when one had to be inferred, 0.3 or lower when the page is ambiguous.`;

// Enums are not enforced by the structured-output schema the SDK derives from zod (they become
// descriptions), and an unknown value would fail the parse; take plain strings and filter in code.
function schema(categoryIds: string[]) {
  const event = z.object({
    title: z.string(),
    start_date: z.string().describe('YYYY-MM-DD, local'),
    start_time: z.string().nullable().describe('HH:MM 24h, local; null if not stated'),
    end_date: z.string().nullable(),
    end_time: z.string().nullable(),
    venue_name: z.string().nullable(),
    street: z.string().nullable(),
    postal_code: z.string().nullable(),
    city: z.string().nullable(),
    is_free: z.boolean().nullable(),
    price_min: z.number().nullable(),
    price_max: z.number().nullable(),
    currency: z.string().nullable().describe('ISO 4217, e.g. PLN'),
    ticket_url: z.string().nullable(),
    event_url: z.string().nullable().describe("The event's own page, if the page links to one"),
    status: z.enum(['scheduled', 'cancelled', 'postponed']),
    online_only: z.boolean(),
    category_ids: z.array(z.string()).describe(`Ids from: ${categoryIds.join(', ')}`),
    confidence: z.number().describe('0 to 1'),
  });
  return z.object({ events: z.array(event) });
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

function when(date: string | null, time: string | null): string | null {
  if (!date || !DATE.test(date)) return null;
  return time && TIME.test(time) ? `${date}T${time}` : date;
}

function safeUrl(s: string | null, base: string): string | null {
  if (!s) return null;
  try {
    const u = new URL(s, base);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

export interface ClaudeExtractorOptions {
  apiKey: string;
  model: string;
  effort: 'low' | 'medium' | 'high';
  maxInputChars: number;
  maxTokens: number;
  /** For tests and non-standard runtimes. */
  fetch?: typeof fetch;
}

/** Claude through the official SDK with a structured-output schema, so the reply is always valid JSON. */
export class ClaudeExtractor implements Extractor {
  readonly id: string;
  private readonly client: Anthropic;

  constructor(private readonly opts: ClaudeExtractorOptions) {
    this.id = `anthropic:${opts.model}`;
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      fetch: boundFetch(opts.fetch),
      maxRetries: 2,
    });
  }

  async extract(input: ExtractInput): Promise<ExtractedEvent[]> {
    const ids = input.categories.map((c) => c.id);
    if (!ids.length) throw new Error('no categories configured');
    const text = input.text.slice(0, this.opts.maxInputChars);
    const message = await this.client.messages.parse({
      model: this.opts.model,
      max_tokens: this.opts.maxTokens,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: {
        effort: this.opts.effort,
        format: zodOutputFormat(schema(ids)),
      },
      messages: [
        {
          role: 'user',
          content: [
            `Page URL: ${input.url}`,
            `Today: ${input.today} (time zone ${input.timeZone})`,
            `Categories (id: label): ${input.categories.map((c) => `${c.id}: ${c.label}`).join('; ')}`,
            '',
            '<page_text>',
            text,
            '</page_text>',
          ].join('\n'),
        },
      ],
    });

    if (message.stop_reason === 'refusal') throw new ExtractionRefusedError('extraction refused');
    if (message.stop_reason === 'max_tokens')
      throw new Error('extraction hit max_tokens; raise extraction.maxTokens or shorten input');
    const out = message.parsed_output;
    if (!out) throw new Error('extraction returned no structured output');

    return out.events.flatMap((e): ExtractedEvent[] => {
      const start = when(e.start_date, e.start_time);
      if (!start || !e.title.trim()) return [];
      return [
        {
          title: e.title.trim(),
          description: null,
          start,
          end: when(e.end_date ?? (e.end_time ? e.start_date : null), e.end_time),
          venueName: e.venue_name,
          address: { street: e.street, postalCode: e.postal_code, city: e.city, country: null },
          point: null,
          isFree: e.is_free,
          priceMin: e.price_min !== null && e.price_min >= 0 ? e.price_min : null,
          priceMax: e.price_max !== null && e.price_max >= 0 ? e.price_max : null,
          currency: e.currency ? e.currency.toUpperCase().slice(0, 3) : null,
          url: safeUrl(e.event_url, input.url),
          ticketUrl: safeUrl(e.ticket_url, input.url),
          imageUrl: null,
          status: e.status,
          online: e.online_only,
          categoryHints: [],
          categoryIds: [...new Set(e.category_ids.filter((c) => ids.includes(c)))].slice(0, 2),
          method: 'llm',
          confidence: Math.min(1, Math.max(0, e.confidence)),
        },
      ];
    });
  }
}
