import { describe, expect, it } from 'vitest';
import { loadConfig, siteTemplate } from '../src';
import { uaFromTemplate } from '../../../apps/web/build/crawlerPage';

/** M13 §2: the site's address and contact come from config only. */
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

describe('no domain or contact address in code (M13 §2)', () => {
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
        if (f === 'node_modules' || f === 'fonts') continue;
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
