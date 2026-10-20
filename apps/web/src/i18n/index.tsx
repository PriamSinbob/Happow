import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Language } from '@happow/core';
import { en, type MessageKey } from './en';
import { pl } from './pl';
import { storage } from '../storage';

const messages: Record<Language, Record<MessageKey, string>> = { en, pl };

type Params = Record<string, string | number>;

/**
 * Tiny ICU-ish formatter: {name} substitution and {n, plural, =0 {...} one {...} few {...} other {...}}
 * with `#`.
 * Enough for the PoC without pulling in a full i18n runtime.
 */
export function format(template: string, params: Params, lang: Language): string {
  const plural = new Intl.PluralRules(lang);
  return template.replace(
    /\{(\w+), plural,((?:\s*=?\w+\s*\{[^{}]*\})+)\s*\}|\{(\w+)\}/g,
    (_m, pName: string | undefined, branches: string | undefined, name: string | undefined) => {
      if (pName && branches) {
        const n = Number(params[pName]);
        const options = Object.fromEntries(
          [...branches.matchAll(/(=?\w+)\s*\{([^{}]*)\}/g)].map((b) => [b[1], b[2]]),
        );
        const branch = options[`=${n}`] ?? options[plural.select(n)] ?? options.other ?? '';
        return branch.replace(/#/g, new Intl.NumberFormat(lang).format(n));
      }
      return String(params[name!] ?? `{${name}}`);
    },
  );
}

export function translate(lang: Language, key: MessageKey, params: Params = {}): string {
  return format(messages[lang][key] ?? en[key], params, lang);
}

export function detectLanguage(supported: Language[], fallback: Language): Language {
  const saved = storage.get('lang');
  if (saved && (supported as string[]).includes(saved)) return saved as Language;
  for (const l of navigator.languages ?? [navigator.language]) {
    const base = l.slice(0, 2).toLowerCase();
    if ((supported as string[]).includes(base)) return base as Language;
  }
  return fallback;
}

interface I18n {
  lang: Language;
  setLang: (l: Language) => void;
  t: (key: MessageKey, params?: Params) => string;
}

const Ctx = createContext<I18n | null>(null);

export function I18nProvider(props: { initial: Language; children: ReactNode }) {
  const [lang, setLangState] = useState(props.initial);
  const setLang = useCallback((l: Language) => {
    storage.set('lang', l);
    document.documentElement.lang = l;
    setLangState(l);
  }, []);
  const value = useMemo<I18n>(
    () => ({ lang, setLang, t: (key, params) => translate(lang, key, params) }),
    [lang, setLang],
  );
  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useI18n outside I18nProvider');
  return ctx;
}

export type { MessageKey };
