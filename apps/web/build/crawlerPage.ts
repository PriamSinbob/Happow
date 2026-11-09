import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';
import type { Plugin } from 'vite';
import appJson from '../../../config/app.json';

/**
 * Server-rendered pages from Markdown in docs/: the crawler policy at /crawler (its
 * User-Agent links here) and the legal texts at /legal/<name> (Polish) and /legal/<name>.en.
 * Rendered at build time with `{{…}}` values from config; no JavaScript on the pages, so they can
 * be linked from emails and store listings, and read when the repository is private.
 */

/**
 * `{siteUrl}` and `{contactEmail}` in the User-Agent template: the same as `siteTemplate` in
 * @happow/core (which Vite can't load while it reads its own config); a test checks they agree.
 */
export function uaFromTemplate(
  s: string,
  app: { site: { url: string }; legal: { contactEmail: string | null } },
): string {
  const email = app.legal.contactEmail;
  return s
    .replace(/[;,]?\s*\{contactEmail\}/g, (m) => (email ? m.replace('{contactEmail}', email) : ''))
    .replaceAll('{siteUrl}', app.site.url);
}

const DOCS = fileURLToPath(new URL('../../../docs/', import.meta.url));

export const LEGAL_PAGES = ['terms', 'privacy', 'takedown', 'storage'] as const;
export type LegalPage = (typeof LEGAL_PAGES)[number];
const LANGS = ['pl', 'en'] as const;
type Lang = (typeof LANGS)[number];

const TITLES: Record<LegalPage, Record<Lang, string>> = {
  terms: { pl: 'Regulamin', en: 'Terms of use' },
  privacy: { pl: 'Polityka prywatności', en: 'Privacy policy' },
  takedown: { pl: 'Zgłoszenia i usuwanie treści', en: 'Reports and takedown' },
  storage: { pl: 'Pamięć urządzenia i ciasteczka', en: 'Device storage and cookies' },
};

const STYLE = `
:root{color-scheme:light dark;--bg:#fbfaf7;--ink:#17171a;--muted:#86807a;--line:rgba(23,23,26,.14)}
@media (prefers-color-scheme:dark){:root{--bg:#000;--ink:#ece9e3;--muted:#80838b;--line:rgba(236,233,227,.18)}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:720px;margin:0 auto;padding:32px 16px 64px}
h1{font-size:28px;line-height:1.2;margin:0 0 16px}
h2{font-size:20px;margin:32px 0 8px}
a{color:inherit}
nav{display:flex;flex-wrap:wrap;gap:6px 14px;margin:0 0 24px;font-size:14px;color:var(--muted)}
nav a[aria-current]{color:var(--ink);font-weight:600;text-decoration:none}
.todo{background:rgba(255,190,0,.25);padding:0 3px;border-radius:3px}
code,pre{font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
pre{padding:12px 14px;border:1px solid var(--line);border-radius:10px;overflow-x:auto;white-space:pre-wrap;word-break:break-all}
table{border-collapse:collapse;width:100%;font-size:15px}
th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-weight:500}
`;

const TODO = { pl: '[do uzupełnienia przed startem]', en: '[to be completed before launch]' };

/** The `{{name}}` values the pages may use, all from config. */
function pageValues(lang: Lang = 'en'): Record<string, string> {
  const app = appJson;
  const todo = `<span class="todo">${TODO[lang]}</span>`;
  return {
    siteUrl: app.site.url,
    siteName: app.site.name,
    userAgent: uaFromTemplate(app.ingest.userAgent, app),
    contactEmail: app.legal.contactEmail ?? todo,
    operator: (app.legal as { operator: string | null }).operator ?? todo,
    address: (app.legal as { address: string | null }).address ?? todo,
    termsVersion: app.legal.termsVersion,
    codeRequestRetentionDays: String(app.auth.codeRequestRetentionDays),
    privateKeepDays: String(app.private.keepAfterEndDays),
    agendaKeepPastDays: String(app.agenda.keepPastDays),
    attendanceKeepHours: String(app.attendance.keepAfterEndHours),
    followsMax: String(app.follows.max),
  };
}

/** Replaces `{{name}}`; an unknown name is an error, so a typo never reaches a public page. */
export function fill(markdown: string, values: Record<string, string>): string {
  return markdown.replace(/\{\{(\w+)\}\}/g, (_, k: string) => {
    if (!(k in values)) throw new Error(`unknown placeholder {{${k}}}`);
    return values[k]!;
  });
}

function page(opts: {
  lang: Lang;
  title: string;
  description: string;
  nav?: string;
  body: string;
}) {
  return `<!doctype html>
<html lang="${opts.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${opts.title}</title>
<meta name="description" content="${opts.description}">
<style>${STYLE}</style>
</head>
<body>
<main>
${opts.nav ?? ''}${opts.body}</main>
</body>
</html>
`;
}

/** Full HTML document for the crawler policy's Markdown. */
function crawlerHtml(markdown: string): string {
  return page({
    lang: 'en',
    title: 'Happow crawler',
    description: 'What the Happow crawler reads, how often, and how to opt out.',
    body: marked.parse(fill(markdown, pageValues('en')), { async: false, gfm: true }),
  });
}

export function renderCrawlerPage(): string {
  return crawlerHtml(readFileSync(`${DOCS}CRAWLER.md`, 'utf8'));
}

/** Path of a legal page: /legal/terms (Polish, the default language) or /legal/terms.en. */
function legalPath(name: LegalPage, lang: Lang): string {
  return `/legal/${name}${lang === 'pl' ? '' : `.${lang}`}`;
}

export function renderLegalPage(name: LegalPage, lang: Lang): string {
  const source = `${DOCS}legal/${name}.${lang}.md`;
  if (!existsSync(source)) throw new Error(`missing ${source}`);
  const other: Lang = lang === 'pl' ? 'en' : 'pl';
  const nav = `<nav aria-label="${lang === 'pl' ? 'Dokumenty' : 'Documents'}">${LEGAL_PAGES.map(
    (p) =>
      `<a href="${legalPath(p, lang)}"${p === name ? ' aria-current="page"' : ''}>${TITLES[p][lang]}</a>`,
  ).join(
    '',
  )}<a href="${legalPath(name, other)}" lang="${other}">${other === 'pl' ? 'Polski' : 'English'}</a></nav>\n`;
  return page({
    lang,
    title: `${TITLES[name][lang]} · ${appJson.site.name}`,
    description: TITLES[name][lang],
    nav,
    body: marked.parse(fill(readFileSync(source, 'utf8'), pageValues(lang)), {
      async: false,
      gfm: true,
    }),
  });
}

/** Every page: output file name → HTML. */
export function renderPages(): Record<string, string> {
  const out: Record<string, string> = { 'crawler.html': renderCrawlerPage() };
  for (const name of LEGAL_PAGES)
    for (const lang of LANGS)
      out[`${legalPath(name, lang).slice(1)}.html`] = renderLegalPage(name, lang);
  return out;
}

/** Emits the pages into the build and serves them in `vite dev`. */
export function crawlerPage(): Plugin {
  return {
    name: 'happow-pages',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0]!.replace(/\/$/, '');
        const file =
          path === '/crawler'
            ? 'crawler.html'
            : /^\/legal\/[a-z.]+$/.test(path)
              ? `${path.slice(1)}.html`
              : null;
        if (!file) return next();
        const html = renderPages()[file];
        if (!html) return next();
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.end(html);
      });
    },
    generateBundle() {
      for (const [fileName, source] of Object.entries(renderPages()))
        this.emitFile({ type: 'asset', fileName, source });
    },
  };
}
