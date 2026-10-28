/**
 * Share into Happow (M12 slice D, docs/milestones/M12-more-events.md §4.1). The installed app is a
 * share target (manifest `share_target`, Android): sharing a page opens `/share?title=&text=&url=`.
 * On start the app keeps what was shared for the add form, then swaps the address for `/#/add`,
 * so a reload or Back never fills the form again and the shared link leaves the address bar.
 */

export interface Shared {
  /** The page to fill the add form from; null when only text was shared. */
  link: string | null;
  /** For the event title when the page gives nothing (owner, 2026-10-28). */
  title: string | null;
}

const KEY = 'happow:share';
const TITLE_MAX = 160;
const LINK = /https?:\/\/[^\s<>"]+/i;

function webUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim().replace(/[.,;:!?)\]]+$/, ''));
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * What a share carries. Many Android apps put "Look at this https://…" in `text` and leave `url`
 * empty, so the link is `url`, else the first link in `text`. The title is `title`, else the
 * rest of `text` without the link.
 */
export function parseShare(params: URLSearchParams): Shared | null {
  const text = params.get('text')?.trim() ?? '';
  const link = webUrl(params.get('url')) ?? webUrl(LINK.exec(text)?.[0]);
  const rest = text.replace(LINK, ' ').replace(/\s+/g, ' ').trim();
  const raw = params.get('title')?.trim() || rest;
  const title = raw ? raw.slice(0, TITLE_MAX).trim() : null;
  return link || title ? { link, title } : null;
}

/** On start: a share lands on /share. Keeps it and opens the add form. True if it was a share. */
export function captureShare(loc: Location = window.location, history: History = window.history) {
  if (loc.pathname !== '/share') return false;
  const shared = parseShare(new URLSearchParams(loc.search));
  try {
    if (shared) sessionStorage.setItem(KEY, JSON.stringify(shared));
  } catch {
    /* blocked storage: the form simply opens empty */
  }
  history.replaceState(null, '', '/#/add');
  return true;
}

/** The waiting share, once: the add form takes it when it can use it (signed in, account loaded). */
export function takeShare(): Shared | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return raw ? (JSON.parse(raw) as Shared) : null;
  } catch {
    return null;
  }
}
