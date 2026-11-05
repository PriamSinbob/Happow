// @vitest-environment node
import { describe, expect, it } from 'vitest';
import appConfig from '../../../config/app.json';
import { renderCrawlerPage, uaFromTemplate } from '../build/crawlerPage';

describe('crawler policy page', () => {
  const html = renderCrawlerPage();

  it('renders docs/CRAWLER.md as a standalone page', () => {
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('<h1>Happow crawler</h1>');
    expect(html).toContain('<table>');
  });

  it('shows the exact User-Agent the crawler sends, which links back to this page', () => {
    const ua = uaFromTemplate(appConfig.ingest.userAgent, appConfig);
    expect(html).toContain(ua.replace(/&/g, '&amp;'));
    // The crawler page's address, then the contact (M13 §3).
    expect(ua).toMatch(/\(\+https:\/\/[^);]+\/crawler(; [^)]+@[^)]+)?\)$/);
  });

  it('does not send site owners to the code repository', () => {
    expect(html).not.toContain('github.com');
  });
});
