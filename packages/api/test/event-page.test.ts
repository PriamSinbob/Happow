import { describe, expect, it, vi } from 'vitest';
import { createEventPage, eventIdFromPath } from '../src';
import { whenText, withTags } from '../src/eventPage';

/** M9 slice A: /e/<id> answers with the app's index.html plus that event's preview tags. */

const SB = 'https://proj.supabase.co';
const env = { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'service-key' };
const now = () => new Date('2026-10-30T12:00:00Z');
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

const OUTLINES = [
  {
    name: 'Stare Miasto',
    here: true,
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [17.02, 51.1],
          [17.04, 51.1],
          [17.03, 51.12],
        ],
      ],
    },
  },
];

function backend(rows: unknown[] | 'error', outlines: unknown = OUTLINES) {
  return vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const args = JSON.parse(String(init.body));
    if (String(input) === `${SB}/rest/v1/rpc/district_outlines`) {
      expect(args).toEqual({ p_lat: EVENT.lat, p_lng: EVENT.lng, p_radius_m: 1500 });
      return outlines === 'error' ? new Response('{}', { status: 500 }) : Response.json(outlines);
    }
    expect(String(input)).toBe(`${SB}/rest/v1/rpc/event_by_id`);
    expect(args).toEqual({ event_id: EVENT.id });
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
    const { page } = createEventPage(env, { now, fetch: backend([EVENT]) });
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
    // Slice B: the event's own image, its URL carrying a version of what's drawn.
    expect(html).toMatch(
      /og:image" content="https:\/\/happow\.example\/e\/ticketmaster%3AZ7%20%22x%22\/preview\.png\?v=[0-9a-f]{12}"/,
    );
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
    // The generic title and description are replaced, not duplicated; the app still loads.
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html).not.toContain('Everything happening near you');
    expect(html).toContain('<div id="root"></div>');
  });

  it('gives an unknown or hidden event the generic page with a 404', async () => {
    // event_by_id reads events_public, so a hidden event comes back as no row.
    const { page } = createEventPage(env, { now, fetch: backend([]) });
    const res = await page(get(link), INDEX);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(INDEX);
  });

  it('still serves the app when the database fails, uncached', async () => {
    const { page } = createEventPage(env, { now, fetch: backend('error') });
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

describe('preview image data (M9 slice B)', () => {
  it('gives what the image draws, with the districts around the event', async () => {
    const { preview } = createEventPage(env, { now, fetch: backend([EVENT]) });
    const data = await preview(EVENT.id);
    expect(data).toMatchObject({
      title: EVENT.title,
      venue: EVENT.venue_name,
      categoryLabel: 'Muzyka',
      lang: 'pl',
      point: { lat: 51.11, lng: 17.03 },
      outlines: OUTLINES,
    });
    expect(data!.category!.id).toBe('music');
    expect(data!.when).toMatch(/19:00–21:30$/);
    expect(data!.version).toMatch(/^[0-9a-f]{12}$/);
  });

  it('changes the version only when something drawn changes', async () => {
    const v = async (ev: object) =>
      (await createEventPage(env, { now, fetch: backend([ev]) }).preview(EVENT.id))!.version;
    const base = await v(EVENT);
    expect(await v({ ...EVENT })).toBe(base);
    expect(await v({ ...EVENT, title: 'Inny koncert' })).not.toBe(base);
    expect(await v({ ...EVENT, start_at: '2026-10-31T19:00:00Z' })).not.toBe(base);
  });

  it('draws a plain map when the districts fail, and nothing for a hidden event', async () => {
    const plain = await createEventPage(env, { now, fetch: backend([EVENT], 'error') }).preview(
      EVENT.id,
    );
    expect(plain!.outlines).toEqual([]);
    expect(await createEventPage(env, { now, fetch: backend([]) }).preview(EVENT.id)).toBeNull();
  });
});

describe('links that outlive the event (M9 slice D)', () => {
  it('marks an ended event in the preview text, and keeps its image', async () => {
    const later = () => new Date('2026-11-02T12:00:00Z');
    const { page, preview } = createEventPage(env, { now: later, fetch: backend([EVENT]) });
    const html = await (await page(get(link), INDEX)).text();
    expect(html).toMatch(/og:description" content="Zakończone · [^"]*19:00–21:30/);
    expect(html).toMatch(/preview\.png\?v=/);
    const before = await createEventPage(env, { now, fetch: backend([EVENT]) }).preview(EVENT.id);
    expect((await preview(EVENT.id))!.version).toBe(before!.version);
  });
});
