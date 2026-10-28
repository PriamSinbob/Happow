/**
 * `pnpm venues:probe <url…>` runs the website check (M12 §2.2) on any sites by hand: an iCal
 * feed, The Events Calendar's REST API, or Event JSON-LD on the home or events page. It prints
 * what it finds and writes nothing; the daily `venue-probe` source does the same for OSM venues.
 */
import { getRegion, loadConfig } from '@happow/core';
import { HttpClient, probeSite, robotsGate } from '@happow/ingest';

const config = loadConfig();
const sites = process.argv.slice(2);
if (!sites.length) throw new Error('usage: pnpm venues:probe <url> [<url>…]');
const region = getRegion(config, config.app.defaultRegion);
const { ingest, venues } = config.app;
const http = new HttpClient({ userAgent: ingest.userAgent, minIntervalMs: 1000, retries: 1 });
const allowed = robotsGate(http, ingest.userAgent);

for (const site of sites) {
  const r = await probeSite(site, {
    http,
    allowed,
    timeZone: region.timezone,
    now: new Date(),
    horizonDays: 60,
    eventsPageWords: venues.probe.eventsPageWords,
  });
  console.log(`${site}: ${r.status}${r.error ? ` (${r.error})` : ''}`);
  for (const c of r.candidates) {
    console.log(`  ${c.kind} ${c.url}: ${c.count} upcoming`);
    for (const s of c.sample) console.log(`    ${s.start} ${s.title}`);
  }
}
