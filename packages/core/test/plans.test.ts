import { describe, expect, it } from 'vitest';
import {
  afterDay,
  can,
  checkPlans,
  earlyAccessEnd,
  effectivePlan,
  entitlementsFor,
  loadConfig,
  presetsFor,
  quota,
  usageMonth,
  type PlanGrant,
  type PlansConfig,
} from '../src';

const config = loadConfig();
const tz = 'Europe/Warsaw';
const promo = { plan: 'premium', until: '2026-11-30' } as const;
const at = (iso: string) => new Date(iso);
const grant = (g: Partial<PlanGrant>): PlanGrant => ({
  plan: 'premium',
  source: 'manual',
  startsAt: '2026-10-01T00:00:00Z',
  endsAt: null,
  ...g,
});
const plan = (
  now: string,
  grants: PlanGrant[] = [],
  earlyAccess: PlansConfig['earlyAccess'] = promo,
) => effectivePlan({ signedIn: true, grants, now: at(now), earlyAccess, timeZone: tz });

describe('plans config', () => {
  it('loads the plans and the promotion', () => {
    expect(quota(entitlementsFor(config.plans, 'account'), 'events.perMonth')).toBe(15);
    expect(quota(entitlementsFor(config.plans, 'premium'), 'autofill.perMonth')).toBe(300);
    expect(can(entitlementsFor(config.plans, 'anonymous'), 'atlas.export')).toBe(false);
    expect(can(entitlementsFor(config.plans, 'account'), 'atlas.export')).toBe(true);
    expect(config.plans.earlyAccess?.plan).toBe('premium');
  });

  it('rejects a higher plan that gives less, and an impossible date', () => {
    const plans = structuredClone(config.plans);
    plans.plans.premium['events.perMonth'] = 10;
    plans.plans.premium['atlas.export'] = false;
    plans.earlyAccess = { plan: 'premium', until: '2026-02-30' };
    expect(checkPlans(plans)).toEqual([
      'plan "premium" gives less "events.perMonth" than "account"',
      'plan "premium" gives less "atlas.export" than "account"',
      'earlyAccess.until "2026-02-30" is not a date',
    ]);
    expect(checkPlans(config.plans)).toEqual([]);
  });
});

describe('effectivePlan', () => {
  it('is anonymous when signed out, whatever else applies', () => {
    expect(
      effectivePlan({
        signedIn: false,
        grants: [grant({})],
        now: at('2026-10-24T12:00:00Z'),
        earlyAccess: promo,
        timeZone: tz,
      }),
    ).toEqual({ plan: 'anonymous', source: null, endsAt: null });
  });

  it('gives the promotion through the whole until day, local time', () => {
    // 1 Dec 00:00 in Warsaw (CET, UTC+1) is 30 Nov 23:00 UTC.
    const end = at('2026-11-30T23:00:00Z');
    expect(earlyAccessEnd(promo, tz)).toEqual(end);
    expect(plan('2026-11-30T22:59:59Z')).toEqual({
      plan: 'premium',
      source: 'early_access',
      endsAt: end,
    });
    expect(plan('2026-11-30T23:00:00Z')).toEqual({
      plan: 'account',
      source: 'account',
      endsAt: null,
    });
  });

  it('ends the promotion at local midnight across the DST change', () => {
    // Clocks go back on 25 Oct 2026: that day is 25 hours long, and the 26th starts at 23:00 UTC.
    const p = { plan: 'premium', until: '2026-10-25' } as const;
    expect(earlyAccessEnd(p, tz)).toEqual(at('2026-10-25T23:00:00Z'));
    expect(earlyAccessEnd({ plan: 'premium', until: '2026-10-24' }, tz)).toEqual(
      at('2026-10-24T22:00:00Z'),
    );
  });

  it('afterDay: midnight after a last day, across the year and DST (admin grants, slice F)', () => {
    expect(afterDay('2026-12-31', tz)).toEqual(at('2026-12-31T23:00:00Z'));
    expect(afterDay('2026-10-25', tz)).toEqual(at('2026-10-25T23:00:00Z'));
    expect(afterDay('2027-03-28', tz)).toEqual(at('2027-03-28T22:00:00Z'));
    expect(afterDay('31.12.2026', tz)).toBeNull();
  });

  it('is the account when there is no promotion and no grant', () => {
    expect(plan('2026-10-24T12:00:00Z', [], null)).toEqual({
      plan: 'account',
      source: 'account',
      endsAt: null,
    });
  });

  it('takes the grant that lasts longest when it outlives the promotion', () => {
    const g = grant({ endsAt: '2027-03-01T00:00:00Z', source: 'purchase' });
    expect(plan('2026-10-24T12:00:00Z', [g])).toEqual({
      plan: 'premium',
      source: 'purchase',
      endsAt: at('2027-03-01T00:00:00Z'),
    });
    // A shorter grant than the promotion: the promotion's end is shown.
    const short = grant({ endsAt: '2026-11-01T00:00:00Z' });
    expect(plan('2026-10-24T12:00:00Z', [short]).source).toBe('early_access');
  });

  it('treats an open-ended grant as lasting longest', () => {
    const open = grant({ endsAt: null });
    const dated = grant({ endsAt: '2030-01-01T00:00:00Z', source: 'purchase' });
    expect(plan('2026-10-24T12:00:00Z', [dated, open])).toEqual({
      plan: 'premium',
      source: 'manual',
      endsAt: null,
    });
  });

  it('ignores grants that have ended or not started', () => {
    const ended = grant({ endsAt: '2026-12-05T00:00:00Z' });
    const future = grant({ startsAt: '2027-01-01T00:00:00Z' });
    expect(plan('2026-12-05T00:00:00Z', [ended, future]).plan).toBe('account');
    expect(plan('2026-12-04T23:59:59Z', [ended, future])).toEqual({
      plan: 'premium',
      source: 'manual',
      endsAt: at('2026-12-05T00:00:00Z'),
    });
  });

  it('keeps the higher plan over a lower grant that lasts longer', () => {
    const low = grant({ plan: 'account', endsAt: null });
    expect(plan('2026-10-24T12:00:00Z', [low]).plan).toBe('premium');
  });
});

describe('usageMonth', () => {
  it('counts calendar months in Warsaw time, not UTC', () => {
    // 31 Oct 23:30 UTC is already 1 Nov 00:30 in Warsaw.
    expect(usageMonth(at('2026-10-31T22:59:59Z'), tz)).toEqual({
      month: '2026-10-01',
      resetsAt: at('2026-10-31T23:00:00Z'),
    });
    expect(usageMonth(at('2026-10-31T23:30:00Z'), tz)).toEqual({
      month: '2026-11-01',
      resetsAt: at('2026-11-30T23:00:00Z'),
    });
  });

  it('rolls over the year, and resets at local midnight in summer time', () => {
    expect(usageMonth(at('2026-12-31T23:00:00Z'), tz).month).toBe('2027-01-01');
    // 1 July 00:00 in Warsaw (CEST, UTC+2) is 30 June 22:00 UTC.
    expect(usageMonth(at('2027-06-15T12:00:00Z'), tz).resetsAt).toEqual(at('2027-06-30T22:00:00Z'));
  });
});

describe('presetsFor', () => {
  it('offers presets by tier', () => {
    const ids = (p: 'anonymous' | 'account' | 'premium') =>
      presetsFor(entitlementsFor(config.plans, p), config.theme.presets).map((x) => x.tier);
    expect(new Set(ids('anonymous'))).toEqual(new Set(['anonymous']));
    expect(new Set(ids('account'))).toEqual(new Set(['anonymous', 'account']));
    expect(new Set(ids('premium'))).toEqual(new Set(['anonymous', 'account', 'premium']));
  });
});
