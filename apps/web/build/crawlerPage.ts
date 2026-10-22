import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';
import type { Plugin } from 'vite';

/**
 * The crawler policy (docs/CRAWLER.md) as a public page at /crawler. The crawler's User-Agent
 * links here, so site owners can read what it does and how to opt out even when the repository
 * itself is private. Rendered at build time; no JavaScript on the page.
 */

const SOURCE = fileURLToPath(new URL('../../../docs/CRAWLER.md', import.meta.url));

const STYLE = `
:root{color-scheme:light dark;--bg:#fbfaf7;--ink:#17171a;--muted:#86807a;--line:rgba(23,23,26,.14)}
@media (prefers-color-scheme:dark){:root{--bg:#000;--ink:#ece9e3;--muted:#80838b;--line:rgba(236,233,227,.18)}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:720px;margin:0 auto;padding:32px 16px 64px}
h1{font-size:28px;line-height:1.2;margin:0 0 16px}
h2{font-size:20px;margin:32px 0 8px}
a{color:inherit}
code,pre{font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
pre{padding:12px 14px;border:1px solid var(--line);border-radius:10px;overflow-x:auto;white-space:pre-wrap;word-break:break-all}
table{border-collapse:collapse;width:100%;font-size:15px}
th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-weight:500}
`;

/** Full HTML document for the given Markdown. */
export function crawlerHtml(markdown: string): string {
  const body = marked.parse(markdown, { async: false, gfm: true });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Happow crawler</title>
<meta name="description" content="What the Happow crawler reads, how often, and how to opt out.">
<style>${STYLE}</style>
</head>
<body>
<main>
${body}</main>
</body>
</html>
`;
}

export function renderCrawlerPage(): string {
  return crawlerHtml(readFileSync(SOURCE, 'utf8'));
}

/** Emits crawler.html into the build (served at /crawler) and serves it in `vite dev`. */
export function crawlerPage(): Plugin {
  return {
    name: 'happow-crawler-page',
    configureServer(server) {
      server.middlewares.use('/crawler', (req, res, next) => {
        if (req.url && req.url !== '/' && req.url !== '') return next();
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.end(renderCrawlerPage());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'crawler.html', source: renderCrawlerPage() });
    },
  };
}
