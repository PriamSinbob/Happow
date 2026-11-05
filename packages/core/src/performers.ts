/** A performer as a source names them; `externalId` is the source's stable id (Ticketmaster). */
export interface Performer {
  name: string;
  externalId?: string | null;
}

/**
 * The form names are matched on (M7 §1): lowercase, without diacritics (NFD plus "ł" → "l",
 * which NFD leaves alone), whitespace collapsed. The SQL `f_norm` gives the same result.
 */
export function normName(name: string): string {
  return name
    .replace(/[łŁ]/g, 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Most performers kept per event; a festival line-up beyond this is left out. */
export const MAX_PERFORMERS = 30;

/**
 * Performers without duplicates (by `normName`), in the order given. When the same name comes
 * twice, the one with an external id wins.
 */
export function mergePerformers(...lists: (Performer[] | undefined | null)[]): Performer[] {
  const out = new Map<string, Performer>();
  for (const list of lists)
    for (const p of list ?? []) {
      const name = p.name.replace(/\s+/g, ' ').trim();
      const norm = normName(name);
      if (norm.length < 2 || name.length > 120) continue;
      const had = out.get(norm);
      if (!had) out.set(norm, p.externalId ? { name, externalId: p.externalId } : { name });
      else if (!had.externalId && p.externalId) out.set(norm, { ...had, externalId: p.externalId });
    }
  return [...out.values()].slice(0, MAX_PERFORMERS);
}

/** "A, B\nC" from the add form → names (comma, semicolon or new line). */
export function splitPerformers(text: string): Performer[] {
  return mergePerformers(
    text
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((name) => ({ name })),
  );
}
