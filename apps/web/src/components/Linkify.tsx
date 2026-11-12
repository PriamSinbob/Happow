import { Fragment } from 'react';

/** http(s) links and bare "www." addresses; trailing punctuation stays outside the link. */
const LINK = /((?:https?:\/\/|www\.)[^\s<>"']+[^\s<>"'.,;:!?)\]}])/gi;

/** A text's parts: plain runs and the links between them. */
export function linkParts(text: string): { text: string; href: string | null }[] {
  const out: { text: string; href: string | null }[] = [];
  let last = 0;
  for (const m of text.matchAll(LINK)) {
    const at = m.index ?? 0;
    const raw = m[0];
    const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    let ok = false;
    try {
      ok = /^https?:$/.test(new URL(href).protocol);
    } catch {
      ok = false;
    }
    if (!ok) continue;
    if (at > last) out.push({ text: text.slice(last, at), href: null });
    out.push({ text: raw, href });
    last = at + raw.length;
  }
  if (last < text.length) out.push({ text: text.slice(last), href: null });
  return out;
}

/**
 * Text people wrote (an organiser's update) with its links made tappable. Only http(s) links,
 * opened in a new tab without handing over the referrer; the text itself is never read as HTML.
 */
export function Linkify({ text }: { text: string }) {
  return (
    <>
      {linkParts(text).map((p, i) =>
        p.href ? (
          <a
            key={i}
            href={p.href}
            target="_blank"
            rel="noopener noreferrer nofollow ugc"
            // Inside a card or a row: the tap is the link's, not the card's.
            onClick={(e) => e.stopPropagation()}
          >
            {p.text}
          </a>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
    </>
  );
}
