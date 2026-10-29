import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { activeSeasons, fitsSeason, plainText, weekendWindow } from '../src/seasons';

/** M12 slice N: season collections and the district goal's weekend. */
const config = loadConfig();
const tz = 'Europe/Warsaw';
const season = (id: string) => config.seasons.find((s) => s.id === id)!;
const ev = (title: string, startAt: string, endAt: string, categoryIds = ['other']) => ({
  title,
  categoryIds,
  startAt,
  endAt,
});

describe('season collections', () => {
  it('match keywords without case or diacritics, within the season’s days only', () => {
    expect(plainText('Świąteczny JARMARK Łódź')).toBe('swiateczny jarmark lodz');
    const xmas = season('christmas');
    expect(
      fitsSeason(
        ev('Jarmark Bożonarodzeniowy', '2026-11-28T10:00:00Z', '2026-11-28T18:00:00Z'),
        xmas,
        tz,
      ),
    ).toBe(true);
    expect(
      fitsSeason(ev('Koncert kolęd', '2026-12-20T17:00:00Z', '2026-12-20T19:00:00Z'), xmas, tz),
    ).toBe(true);
    // A mass is not Christmas just for being święta.
    expect(
      fitsSeason(ev('Msza święta', '2026-12-06T08:00:00Z', '2026-12-06T09:00:00Z'), xmas, tz),
    ).toBe(false);
    // 24 Dec ends at midnight Warsaw time, which is 23:00 UTC.
    expect(
      fitsSeason(ev('Wigilia miejska', '2026-12-24T22:30:00Z', '2026-12-25T01:00:00Z'), xmas, tz),
    ).toBe(true);
    expect(
      fitsSeason(ev('Jarmark', '2026-12-24T23:00:00Z', '2026-12-25T02:00:00Z'), xmas, tz),
    ).toBe(false);
  });

  it('match by category when a season has no keywords', () => {
    const ferie = season('winter-break');
    expect(
      fitsSeason(
        ev('Warsztaty', '2027-01-20T09:00:00Z', '2027-01-20T11:00:00Z', ['kids']),
        ferie,
        tz,
      ),
    ).toBe(true);
    expect(
      fitsSeason(
        ev('Warsztaty', '2027-01-20T09:00:00Z', '2027-01-20T11:00:00Z', ['talk']),
        ferie,
        tz,
      ),
    ).toBe(false);
  });

  it('run on their days in the region', () => {
    const ids = (at: string) => activeSeasons(config.seasons, new Date(at), tz).map((s) => s.id);
    expect(ids('2026-10-29T12:00:00Z')).toEqual(['halloween']);
    expect(ids('2026-11-10T12:00:00Z')).toEqual([]);
    expect(ids('2026-12-31T20:00:00Z')).toEqual(['new-year']);
  });

  it('are checked when config loads: categories exist, and each has a way to match', () => {
    for (const s of config.seasons) {
      expect(s.categories.length + s.keywords.length).toBeGreaterThan(0);
      for (const c of s.categories) expect(config.categories.some((x) => x.id === c)).toBe(true);
    }
  });
});

describe('the weekend a district goal counts', () => {
  it('is the coming Saturday and Sunday, or the rest of it on the weekend', () => {
    // Thu 29 Oct 2026, winter time: Sat 31 Oct 00:00 is 30 Oct 23:00 UTC.
    expect(weekendWindow(new Date('2026-10-29T12:00:00Z'), tz)).toEqual({
      from: new Date('2026-10-30T23:00:00Z'),
      to: new Date('2026-11-01T23:00:00Z'),
    });
    const sunday = new Date('2026-11-01T15:00:00Z');
    expect(weekendWindow(sunday, tz)).toEqual({
      from: sunday,
      to: new Date('2026-11-01T23:00:00Z'),
    });
    // Across the end of summer time (Sun 25 Oct): Saturday starts at 22:00 UTC, Monday at 23:00.
    expect(weekendWindow(new Date('2026-10-21T12:00:00Z'), tz)).toEqual({
      from: new Date('2026-10-23T22:00:00Z'),
      to: new Date('2026-10-25T23:00:00Z'),
    });
  });
});
