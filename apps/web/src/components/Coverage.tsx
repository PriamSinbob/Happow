import { useCallback, useEffect, useState } from 'react';
import { loadCoverage, type Coverage as CoverageData, type Metrics } from '../admin';
import { config, region } from '../config';
import { errorText } from '../errors';
import { formatDay } from '../format';
import { useI18n } from '../i18n';

/** How many categories a district line names, busiest first. */
const TOP = 3;

/**
 * The admin's coverage view (M12 §3, slice O): the five metrics now and week by week, then every
 * district with its events today and this week, the emptiest first, so the next source is chosen
 * by data. Picking a category counts only its events.
 */
export function Coverage({ reload }: { reload: number }) {
  const { t, lang } = useI18n();
  const [data, setData] = useState<CoverageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<string>('');

  const load = useCallback(async () => {
    try {
      setData(await loadCoverage());
      setError(null);
    } catch (err) {
      setError(errorText(t, err, lang));
    }
  }, [t, lang]);
  useEffect(() => {
    void load();
  }, [load, reload]);

  if (error)
    return (
      <p className="form-error" role="alert">
        {error}
      </p>
    );
  if (!data) return <p className="muted">{t('event.loading')}</p>;

  const label = (id: string) => config.categories.find((c) => c.id === id)?.labels[lang] ?? id;
  const count = (d: CoverageData['districts'][number]) =>
    category ? (d.byCategory[category] ?? { today: 0, week: 0 }) : d;
  const districts = [...data.districts].sort(
    (a, b) =>
      count(a).week - count(b).week ||
      count(a).today - count(b).today ||
      a.name.localeCompare(b.name, lang),
  );
  const empty = districts.filter((d) => count(d).week === 0).length;
  const share = (m: Metrics) => `${Math.round(m.communityShare * 100)}%`;
  const row = (m: Metrics) => [
    m.eventsToday,
    m.events7d,
    `${m.districtsTonight}/${m.districts}`,
    share(m),
    m.accountsAdded7d,
  ];

  return (
    <div className="coverage">
      <section className="mod-section" aria-labelledby="coverage-metrics">
        <h2 id="coverage-metrics">{t('coverage.metrics')}</h2>
        <div className="coverage__scroll">
          <table className="coverage__table">
            <thead>
              <tr>
                <th scope="col">{t('coverage.week')}</th>
                <th scope="col">{t('coverage.m.today')}</th>
                <th scope="col">{t('coverage.m.week')}</th>
                <th scope="col">{t('coverage.m.tonight')}</th>
                <th scope="col">{t('coverage.m.community')}</th>
                <th scope="col">{t('coverage.m.accounts')}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="is-now">
                <th scope="row">{t('coverage.now')}</th>
                {row(data.now).map((v, i) => (
                  <td key={i}>{v}</td>
                ))}
              </tr>
              {[...data.weeks].reverse().map((w) => (
                <tr key={w.week}>
                  <th scope="row">{formatDay(`${w.week}T12:00:00Z`, 'UTC', lang)}</th>
                  {row(w.metrics).map((v, i) => (
                    <td key={i}>{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.weeks.length === 0 && <p className="muted">{t('coverage.noWeeks')}</p>}
      </section>

      <section className="mod-section" aria-labelledby="coverage-districts">
        <h2 id="coverage-districts">
          {t('coverage.districts', { empty, count: districts.length })}
        </h2>
        <label className="field">
          <span className="field__label">{t('coverage.category')}</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">{t('coverage.allCategories')}</option>
            {config.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.labels[lang]}
              </option>
            ))}
          </select>
        </label>
        <ul className="my-events coverage__list">
          {districts.map((d) => {
            const n = count(d);
            const top = Object.entries(d.byCategory)
              .sort((a, b) => b[1].week - a[1].week)
              .slice(0, TOP);
            return (
              <li key={d.id}>
                <div className="my-events__row">
                  <span className="my-events__title">{d.name}</span>
                  <span className={`my-events__meta${n.week === 0 ? ' is-warn' : ''}`}>
                    {t('coverage.counts', { today: n.today, week: n.week })}
                    {!category &&
                      top.length > 0 &&
                      ` · ${top.map(([c, v]) => `${label(c)} ${v.week}`).join(', ')}`}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
        <p className="muted">{t('coverage.region', { region: region.name[lang] })}</p>
      </section>
    </div>
  );
}
