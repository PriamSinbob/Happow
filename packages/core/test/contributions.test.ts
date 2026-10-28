import { describe, expect, it } from 'vitest';
import {
  checkPlans,
  effectivePlan,
  higherLevel,
  levelFor,
  loadConfig,
  premiumDaysFor,
  type PlanGrant,
} from '../src';

const config = loadConfig();
const cfg = config.plans.contributions;
const tz = 'Europe/Warsaw';
const promo = { plan: 'premium', until: '2026-11-30' } as const;
const days = (startsAt: string, n: number): PlanGrant => ({
  plan: 'premium',
  source: 'contribution',
  startsAt,
  endsAt: new Date(Date.parse(startsAt) + n * 86_400_000).toISOString(),
});
const plan = (grants: PlanGrant[], now: string, earlyAccess: typeof promo | null = promo) =>
  effectivePlan({ signedIn: true, grants, now: new Date(now), earlyAccess, timeZone: tz });

describe('premium days for verified events (M12 §5.2)', () => {
  it('gives the configured days, never past the monthly cap', () => {
    expect([cfg.premiumDaysPerEvent, cfg.premiumDaysPerMonth]).toEqual([3, 30]);
    expect(premiumDaysFor(0, cfg)).toBe(3);
    expect(premiumDaysFor(28, cfg)).toBe(2);
    expect(premiumDaysFor(30, cfg)).toBe(0);
    expect(premiumDaysFor(45, cfg)).toBe(0);
  });

  it('shows premium until the end of days banked behind the promotion', () => {
    // Earned in November, starting when the promotion ends (midnight, 1 Dec, Warsaw).
    const banked = [days('2026-11-30T23:00:00.000Z', 3), days('2026-12-03T23:00:00.000Z', 3)];
    const p = plan(banked, '2026-11-05T12:00:00Z');
    expect(p.source).toBe('early_access');
    expect(p.endsAt?.toISOString()).toBe('2026-12-06T23:00:00.000Z');
    // A gap ends the chain: days that start later don't count yet.
    const gap = [days('2026-12-10T23:00:00.000Z', 3)];
    expect(plan(gap, '2026-11-05T12:00:00Z').endsAt?.toISOString()).toBe(
      '2026-11-30T23:00:00.000Z',
    );
  });

  it('runs contribution days as premium once the promotion is over', () => {
    const p = plan([days('2026-12-01T10:00:00.000Z', 3)], '2026-12-02T12:00:00Z');
    expect(p).toMatchObject({ plan: 'premium', source: 'contribution' });
    expect(p.endsAt?.toISOString()).toBe('2026-12-04T10:00:00.000Z');
    // Without the promotion, a lone future grant is not premium yet.
    expect(plan([days('2026-12-10T10:00:00.000Z', 3)], '2026-12-02T12:00:00Z', null).plan).toBe(
      'account',
    );
  });
});

describe('levels (M12 §5.4)', () => {
  it('needs both thresholds, in config order', () => {
    expect(levelFor(0, 0, cfg)).toBeNull();
    expect(levelFor(1, 0, cfg)).toBe('neighbour');
    expect(levelFor(5, 0, cfg)).toBe('local');
    expect(levelFor(25, 150, cfg)).toBe('local');
    expect(levelFor(25, 200, cfg)).toBe('guide');
    expect(levelFor(60, 5000, cfg)).toBe('cityGuide');
  });

  it('only goes up', () => {
    expect(higherLevel('guide', 'local', cfg)).toBe('guide');
    expect(higherLevel('local', 'guide', cfg)).toBe('guide');
    expect(higherLevel(null, 'neighbour', cfg)).toBe('neighbour');
    expect(higherLevel('local', null, cfg)).toBe('local');
  });

  it('are checked to ascend, with unique ids', () => {
    expect(checkPlans(config.plans)).toEqual([]);
    const bad = {
      ...config.plans,
      contributions: {
        ...cfg,
        levels: [
          { id: 'a', events: 5, opens: 0 },
          { id: 'b', events: 1, opens: 0 },
          { id: 'a', events: 9, opens: 0 },
        ],
      },
    };
    expect(checkPlans(bad)).toEqual([
      'contributions level "b" needs less than "a"',
      'duplicate contributions level "a"',
    ]);
  });
});
