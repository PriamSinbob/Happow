// @vitest-environment node
import { describe, expect, it } from 'vitest';
import appConfig from '../../../config/app.json';
import {
  fill,
  LEGAL_PAGES,
  renderLegalPage,
  renderPages,
  uaFromTemplate,
} from '../build/crawlerPage';

/** M13 §1: the legal texts as static pages, filled from config. */
describe('legal pages', () => {
  it('renders every page in Polish and English, with no placeholder left', () => {
    const pages = renderPages();
    for (const name of LEGAL_PAGES) {
      for (const file of [`legal/${name}.html`, `legal/${name}.en.html`]) {
        const html = pages[file]!;
        expect(html, file).toMatch(/^<!doctype html>/);
        expect(html, file).not.toMatch(/\{\{\w+\}\}/);
      }
    }
    expect(pages['legal/terms.html']).toContain('lang="pl"');
    expect(pages['legal/terms.en.html']).toContain('lang="en"');
  });

  it('names the contact and version, and marks a missing operator for completion', () => {
    const html = renderLegalPage('privacy', 'en');
    expect(html).toContain(appConfig.legal.contactEmail!);
    expect(html).toContain(appConfig.legal.termsVersion);
    if (appConfig.legal.operator === null) expect(html).toContain('to be completed before launch');
    // The art. 14 notice for performers and organisers.
    expect(html).toMatch(/art\. 14/);
    expect(renderLegalPage('privacy', 'pl')).toMatch(/art\. 14 RODO/);
  });

  it('links between the pages and to the other language', () => {
    const html = renderLegalPage('takedown', 'pl');
    expect(html).toContain('href="/legal/privacy"');
    expect(html).toContain('href="/legal/takedown.en"');
  });

  it('refuses an unknown placeholder rather than publishing it', () => {
    expect(() => fill('{{nope}}', {})).toThrow(/nope/);
  });

  it('the crawler page shows the User-Agent filled from config', () => {
    const ua = uaFromTemplate(appConfig.ingest.userAgent, appConfig);
    expect(renderPages()['crawler.html']).toContain(ua);
    expect(ua).toContain(`${appConfig.site.url}/crawler`);
    if (appConfig.legal.contactEmail) expect(ua).toContain(appConfig.legal.contactEmail);
  });
});
