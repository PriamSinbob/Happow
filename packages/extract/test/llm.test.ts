import { describe, expect, it, vi } from 'vitest';
import { ClaudeExtractor, ExtractionRefusedError, htmlToText } from '../src';
import { fixture } from './helpers';

const categories = [
  { id: 'music', label: 'Music' },
  { id: 'kids', label: 'Kids & family' },
  { id: 'other', label: 'Other' },
];

/** A Messages API response whose text block carries the structured output. */
function reply(output: unknown, stop_reason = 'end_turn') {
  return new Response(
    JSON.stringify({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'claude-haiku-5-5',
      content: [{ type: 'text', text: JSON.stringify(output) }],
      stop_reason,
      stop_sequence: null,
      usage: { input_tokens: 1200, output_tokens: 150 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

const nfmEvent = {
  title: 'Pustynne portato',
  start_date: '2026-11-22',
  start_time: '10:00',
  end_date: null,
  end_time: null,
  venue_name: 'NFM, Sala Czerwona',
  street: 'plac Wolności 1',
  postal_code: '50-071',
  city: 'Wrocław',
  is_free: false,
  price_min: 35,
  price_max: 120,
  currency: 'pln',
  ticket_url: null,
  event_url: null,
  status: 'scheduled',
  online_only: false,
  category_ids: ['kids', 'music'],
  age_min: null,
  family: true,
  entry: 'fixed',
  confidence: 0.92,
};

function extractor(fetchMock: typeof fetch) {
  return new ClaudeExtractor({
    apiKey: 'sk-test',
    model: 'claude-haiku-5-5',
    effort: 'low',
    maxInputChars: 12000,
    maxTokens: 16000,
    fetch: fetchMock,
  });
}

describe('ClaudeExtractor', () => {
  const input = {
    url: 'https://www.nfm.wroclaw.pl/pl/component/nfmcalendar/event/14132',
    text: htmlToText(fixture('nfm-event.html')),
    today: '2026-10-20',
    timeZone: 'Europe/Warsaw',
    categories,
  };

  it('sends a cached system prompt, the page text and a strict output schema', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      reply({ events: [nfmEvent] }),
    );
    const [e, ...rest] = await extractor(fetchMock as typeof fetch).extract(input);
    expect(rest).toHaveLength(0);
    expect(e).toMatchObject({
      title: 'Pustynne portato',
      start: '2026-11-22T10:00',
      end: null,
      venueName: 'NFM, Sala Czerwona',
      address: { street: 'plac Wolności 1', postalCode: '50-071', city: 'Wrocław' },
      priceMin: 35,
      priceMax: 120,
      currency: 'PLN',
      categoryIds: ['kids', 'music'],
      ageMin: null,
      family: true,
      entry: 'fixed',
      method: 'llm',
      confidence: 0.92,
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://api.anthropic.com/v1/messages');
    const body = JSON.parse(init!.body as string);
    expect(body.model).toBe('claude-haiku-5-5');
    expect(body.system[0].cache_control).toEqual({ type: 'ephemeral' });
    // The system prompt must not vary per request, or the cache never hits.
    expect(body.system[0].text).not.toContain('2026-10-20');
    expect(body.output_config.effort).toBe('low');
    expect(body.output_config.format.type).toBe('json_schema');
    expect(JSON.stringify(body.output_config.format.schema)).toContain('music, kids, other');
    expect(body.messages[0].content).toContain('Today: 2026-10-20');
    expect(body.messages[0].content).toContain('Pustynne portato');
    expect(body).not.toHaveProperty('temperature');
    // Age and entry fields, prompted with the Polish cues.
    const schemaText = JSON.stringify(body.output_config.format.schema);
    for (const f of ['age_min', 'family', 'entry']) expect(schemaText).toContain(f);
    for (const cue of ['od 18 lat', '18+', 'wstęp od 16 lat', 'dla dzieci', 'rodzinny', '0+'])
      expect(body.system[0].text).toContain(cue);
  });

  it('keeps plausible ages and known entry types only', async () => {
    const fetchMock = vi.fn(async () =>
      reply({
        events: [
          { ...nfmEvent, title: 'A', age_min: 18, family: null, entry: 'open' },
          { ...nfmEvent, title: 'B', age_min: 0, family: false, entry: 'whenever' },
          { ...nfmEvent, title: 'C', age_min: 2026, family: null, entry: null },
          { ...nfmEvent, title: 'D', age_min: 16.5, family: null, entry: null },
        ],
      }),
    );
    const events = await extractor(fetchMock as unknown as typeof fetch).extract(input);
    expect(events.map((e) => [e.title, e.ageMin, e.family, e.entry])).toEqual([
      ['A', 18, null, 'open'],
      ['B', 0, false, null],
      ['C', null, null, null],
      ['D', null, null, null],
    ]);
  });

  it('drops events without a usable date and clamps confidence', async () => {
    const fetchMock = vi.fn(async () =>
      reply({
        events: [
          { ...nfmEvent, start_date: 'sometime' },
          { ...nfmEvent, title: 'B', confidence: 7, category_ids: ['kids', 'made-up', 'kids'] },
        ],
      }),
    );
    const events = await extractor(fetchMock as unknown as typeof fetch).extract(input);
    expect(events.map((e) => [e.title, e.confidence, e.categoryIds])).toEqual([['B', 1, ['kids']]]);
  });

  it('surfaces refusals and truncation instead of returning partial data', async () => {
    const refused = vi.fn(async () => reply({ events: [] }, 'refusal'));
    await expect(extractor(refused as unknown as typeof fetch).extract(input)).rejects.toThrow(
      ExtractionRefusedError,
    );
    const cut = vi.fn(async () => reply({ events: [] }, 'max_tokens'));
    await expect(extractor(cut as unknown as typeof fetch).extract(input)).rejects.toThrow(
      /max_tokens/,
    );
  });
});
