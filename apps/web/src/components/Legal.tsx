import { useI18n } from '../i18n';

/** The full legal texts (M13 §1), static pages in Polish (the default) and English. */
export const LEGAL = ['terms', 'privacy', 'takedown', 'storage'] as const;
export const legalHref = (name: (typeof LEGAL)[number], lang: string) =>
  `/legal/${name}${lang === 'pl' ? '' : '.en'}`;

export function LegalLinks() {
  const { t, lang } = useI18n();
  return (
    <ul className="legal-links">
      {LEGAL.map((name) => (
        <li key={name}>
          <a href={legalHref(name, lang)} target="_blank" rel="noopener">
            {t(`legal.${name}`)}
          </a>
        </li>
      ))}
    </ul>
  );
}
