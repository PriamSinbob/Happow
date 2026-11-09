import { describe, expect, it } from 'vitest';
import { launchItems, loadConfig, siteTemplate } from '../src';
import { uaFromTemplate } from '../../../apps/web/build/crawlerPage';

describe('siteTemplate', () => {
  const app = { site: { url: 'https://happow.app' }, legal: { contactEmail: 'hi@happow.app' } };

  it('fills the User-Agent, and drops the contact part when there is none', () => {
    const t = 'Happow/0.5 (+{siteUrl}/crawler; {contactEmail})';
    expect(siteTemplate(t, app)).toBe('Happow/0.5 (+https://happow.app/crawler; hi@happow.app)');
    expect(siteTemplate(t, { ...app, legal: { contactEmail: null } })).toBe(
      'Happow/0.5 (+https://happow.app/crawler)',
    );
  });

  it('agrees with the build-time copy the static pages use', () => {
    const t = 'Happow/0.5 (+{siteUrl}/crawler; {contactEmail})';
    expect(uaFromTemplate(t, app)).toBe(siteTemplate(t, app));
  });

  it('is applied by loadConfig', () => {
    const c = loadConfig();
    expect(c.app.ingest.userAgent).not.toMatch(/[{}]/);
    expect(c.app.ingest.userAgent).toContain(`${c.app.site.url}/crawler`);
  });
});

describe('no domain or contact address in code', () => {
  it('keeps the site URL and the email in config only', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const root = new URL('../../../', import.meta.url).pathname;
    const dirs = [
      'packages/core/src',
      'packages/api/src',
      'packages/extract/src',
      'packages/ingest/src',
      'apps/web/src',
      'apps/web/worker',
      'apps/web/build',
      'scripts',
    ];
    const bad: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        // launch.ts looks for these patterns in config, so it names them.
        if (f === 'node_modules' || f === 'fonts' || f === 'launch.ts') continue;
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx|js)$/.test(f)) {
          const text = readFileSync(p, 'utf8');
          if (/workers\.dev|happow\.(app|pl)\b|[\w.+-]+@(gmail|outlook|yahoo)\.com/.test(text))
            bad.push(p.slice(root.length));
        }
      }
    };
    for (const d of dirs) walk(join(root, d));
    expect(bad).toEqual([]);
  });
});

describe('launchItems', () => {
  const now = new Date('2026-11-05T12:00:00Z');
  const ready = () => {
    const c = loadConfig();
    return {
      ...c,
      app: {
        ...c.app,
        site: { ...c.app.site, url: 'https://happow.app' },
        legal: {
          ...c.app.legal,
          operator: 'Jan Kowalski',
          address: 'ul. Przykładowa 1, 50-001 Wrocław',
          contactEmail: 'kontakt@happow.app',
          termsVersion: '2027-01-01',
        },
        auth: { ...c.app.auth, emailDelivery: 'app' as const },
        email: { ...c.app.email, provider: 'resend' as const, from: 'Happow <hi@happow.app>' },
        analytics: { ...c.app.analytics, plausibleDomain: 'happow.app' },
      },
      sources: c.sources.map((s) => (s.beforeLaunch ? { ...s, enabled: false } : s)),
      plans: { ...c.plans, earlyAccess: null },
    };
  };

  it('finds nothing once everything is set', () => {
    expect(launchItems(ready(), now, '{ "previews": {} }')).toEqual([]);
  });

  it('blocks on the drafts, the personal mailbox, workers.dev and private-testing sources', () => {
    const items = launchItems(loadConfig(), now);
    const ids = items.filter((i) => i.level === 'block').map((i) => i.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'operator',
        'address',
        'contact',
        'domain',
        'terms',
        'codes',
        'email',
      ]),
    );
    expect(ids).toContain('source:meetup-pages');
  });

  it('blocks Cron Triggers on previews, and the real wrangler.jsonc has none', async () => {
    const { readFileSync } = await import('node:fs');
    const real = readFileSync(new URL('../../../wrangler.jsonc', import.meta.url), 'utf8');
    expect(launchItems(ready(), now, real)).toEqual([]);
    const bad = '{ // note\n "previews": { "triggers": { "crons": ["*/15 * * * *"] } } }';
    expect(launchItems(ready(), now, bad).map((i) => i.id)).toEqual(['previews']);
  });
});
