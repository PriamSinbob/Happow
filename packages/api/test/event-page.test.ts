import { describe, expect, it, vi } from 'vitest';
import { createEventPage, eventIdFromPath } from '../src';
import { whenText, withTags } from '../src/eventPage';

/** M9 slice A: /e/<id> answers with the app's index.html plus that event's preview tags. */

const SB = 'https://proj.supabase.co';
const env = { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'service-key' };
const INDEX = `<!doctype html>
<html lang="pl">
  <head>
    <meta charset="UTF-8" />
    <meta name="description" content="Everything happening near you, now." />
    <title>Happow</title>
  </head>
  <body><div id="root"></div></body>
</html>`;

const EVENT = {
  id: 'ticketmaster:Z7 "x"',
  title: 'Koncert <Jazz> & więcej',
  category_ids: ['music'],
  start_at: '2026-10-31T18:00:00Z',
  end_at: '2026-10-31T20:30:00Z',
  timezone: 'Europe/Warsaw',
  venue_name: 'Klub "Pod Kolumnami"',
  lat: 51.11,
  lng: 17.03,
};

function backend(rows: unknown[] | 'error') {
  return vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    expect(String(input)).toBe(`${SB}/rest/v1/rpc/event_by_id`);
    expect(JSON.parse(String(init.body))).toEqual({ event_id: EVENT.id });
    if (rows === 'error') return new Response('{}', { status: 500 });
    return Response.json(rows);
  });
}

const get = (path: string) => new Request(`https://happow.example${path}`);
const link = `/e/${encodeURIComponent(EVENT.id)}`;

describe('event links (M9 slice A)', () => {
  it('reads the id from the path, percent-encoded, ignoring anything after it', () => {
    expect(eventIdFromPath('/e/ticketmaster%3AZ7')).toBe('ticketmaster:Z7');
    expect(eventIdFromPath('/e/ticketmaster%3AZ7/preview.png')).toBe('ticketmaster:Z7');
    expect(eventIdFromPath('/e/')).toBeNull();
    expect(eventIdFromPath('/e/%E0%A4%A')).toBeNull();
    expect(eventIdFromPath('/about')).toBeNull();
  });

  it('fills in the tags for a public event, HTML-escaped, in the region language', async () => {
    const page = createEventPage(env, { fetch: backend([EVENT]) });
    const res = await page(get(link), INDEX);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    const title = 'Koncert &lt;Jazz&gt; &amp; więcej · Happow';
    expect(html).toContain(`<title>${title}</title>`);
    expect(html).toContain(`<meta property="og:title" content="${title}" />`);
    // Wrocław's language is Polish; 19:00–21:30 local time.
    expect(html).toMatch(
      /og:description" content="[^"]*19:00–21:30 · Klub &quot;Pod Kolumnami&quot; · Muzyka"/,
    );
    expect(html).toContain(
      `<meta property="og:url" content="https://happow.example/e/ticketmaster%3AZ7%20%22x%22" />`,
    );
    expect(html).toContain('<link rel="canonical" href="https://happow.example/e/');
    expect(html).toContain('og:image" content="https://happow.example/icons/icon-512.png"');
    expect(html).toContain('<meta name="twitter:card" content="summary" />');
    // The generic title and description are replaced, not duplicated; the app still loads.
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html).not.toContain('Everything happening near you');
    expect(html).toContain('<div id="root"></div>');
  });

  it('gives an unknown or hidden event the generic page with a 404', async () => {
    // event_by_id reads events_public, so a hidden event comes back as no row.
    const page = createEventPage(env, { fetch: backend([]) });
    const res = await page(get(link), INDEX);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(INDEX);
  });

  it('still serves the app when the database fails, uncached', async () => {
    const page = createEventPage(env, { fetch: backend('error') });
    const res = await page(get(link), INDEX);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toBe(INDEX);
  });

  it('formats the time, with the end only on the same day', () => {
    expect(whenText(EVENT.start_at, EVENT.end_at, 'Europe/Warsaw', 'en')).toBe(
      'Sat, Oct 31, 19:00–21:30',
    );
    expect(whenText(EVENT.start_at, '2026-11-01T02:00:00Z', 'Europe/Warsaw', 'en')).toBe(
      'Sat, Oct 31, 19:00',
    );
  });

  it('sets the page language', () => {
    const html = withTags(INDEX, {
      title: 't',
      description: 'd',
      url: 'u',
      image: 'i',
      card: 'summary',
      lang: 'en',
    });
    expect(html).toContain('<html lang="en">');
  });
});
