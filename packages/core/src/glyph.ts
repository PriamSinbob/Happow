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
 * The glyph for one event: the first of its category's `glyphRules` whose words appear in the
 * text (title and venue), else the category's own glyph. Rules are tried in order, so a narrow
 * rule ("bar mleczny" → utensils) goes before a broad one ("bar" → beer).
 */
export function eventGlyph(
  category: Pick<Category, 'glyph' | 'glyphRules'> | undefined,
  text: string,
): string {
  if (!category) return 'dot';
  const folded = foldText(text);
  for (const rule of category.glyphRules ?? [])
    if (rule.words.some((w) => wordPattern(w).test(folded))) return rule.glyph;
  return category.glyph;
}
