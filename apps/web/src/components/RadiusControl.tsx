import { radiusToSlider, sliderToRadius } from '@happow/core';
import { config } from '../config';
import { formatDistance } from '../format';
import { useI18n } from '../i18n';

const { minM, maxM } = config.app.radius;
const STEPS = 1000;

export function RadiusControl({
  radius,
  onChange,
}: {
  radius: number;
  onChange: (r: number) => void;
}) {
  const { t, lang } = useI18n();
  const value = Math.round(radiusToSlider(radius, minM, maxM) * STEPS);
  return (
    <label className="radius">
      <span className="radius__label">
        {t('radius.label')} <strong>{formatDistance(radius, lang)}</strong>
      </span>
      <input
        type="range"
        min={0}
        max={STEPS}
        step={1}
        value={value}
        style={{ ['--fill' as string]: `${(value / STEPS) * 100}%` }}
        aria-valuetext={formatDistance(radius, lang)}
        onChange={(e) => onChange(sliderToRadius(Number(e.target.value) / STEPS, minM, maxM))}
      />
      <span className="radius__scale" aria-hidden>
        <span>{formatDistance(minM, lang)}</span>
        <span>{formatDistance(maxM, lang)}</span>
      </span>
    </label>
  );
}
