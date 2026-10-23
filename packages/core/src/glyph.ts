import type { Category } from './types.js';

/** Lower case, no diacritics (ł too), so "Kawiarnia", "KAWIARNIA" and "kawiarnią" compare equal. */
export function foldText(s: string): string {
  return s.toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const cache = new Map<string, RegExp>();

/** "pub" matches the whole word; "kawiarni*" matches any word starting with it. */
function wordPattern(word: string): RegExp {
  let re = cache.get(word);
  if (!re) {
    const prefix = word.endsWith('*');
    const core = foldText(prefix ? word.slice(0, -1) : word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    re = new RegExp(`(^|[^a-z0-9])${core}${prefix ? '' : '(?![a-z0-9])'}`);
    cache.set(word, re);
  }
  return re;
}

/**
 * The glyph for one event: its category's own glyph, unless a `glyphRules` word appears in the
 * texts. Texts are tried in order (title first, then venue), so what the event is beats where it
 * is: "Festiwal food trucków" at "Browar Mieszczański" keeps the utensils. Within a text, rules
 * are tried in order, so a narrow rule ("bar mleczny" → utensils) goes before a broad one
 * ("bar" → beer).
 */
export function eventGlyph(
  category: Pick<Category, 'glyph' | 'glyphRules'> | undefined,
  texts: readonly string[],
): string {
  if (!category) return 'dot';
  for (const text of texts) {
    const folded = foldText(text);
    for (const rule of category.glyphRules ?? [])
      if (rule.words.some((w) => wordPattern(w).test(folded))) return rule.glyph;
  }
  return category.glyph;
}
