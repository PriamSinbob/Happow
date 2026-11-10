import { describe, expect, it } from 'vitest';
import { openState, formatOpeningHours, parseOpeningHours } from '../src';

const tz = 'Europe/Warsaw';
/** A local wall-clock time in the week of Mon 9 Nov 2026 (CET, UTC+1). */
const at = (day: number, time: string) =>
  new Date(`2026-11-${String(9 + day).padStart(2, '0')}T${time}:00+01:00`);
const state = (hours: string, day: number, time: string) =>
  openState(parseOpeningHours(hours)!, at(day, time), tz);

describe('opening hours', () => {
  it('reads weekday ranges, lists and several spans a day', () => {
    const week = parseOpeningHours('Mo-Fr 10:00-14:00,16:00-22:00; Sa,Su 12:00-20:00')!;
    expect(week[0]).toEqual([
      [600, 840],
      [960, 1320],
    ]);
    expect(week[5]).toEqual([[720, 1200]]);
    expect(week[6]).toEqual([[720, 1200]]);
  });

  it('is open inside a span and says when it closes', () => {
    expect(state('Mo-Fr 10:00-22:00', 0, '21:15')).toEqual({
      open: true,
      closesAt: at(0, '22:00'),
    });
    expect(state('Mo-Fr 10:00-22:00', 0, '22:00')).toEqual({ open: false });
    expect(state('Mo-Fr 10:00-22:00', 5, '12:00')).toEqual({ open: false });
  });

  it('follows a span past midnight into the next day', () => {
    const hours = 'Fr,Sa 18:00-02:00';
    // Saturday 01:30 still belongs to Friday night.
    expect(state(hours, 5, '01:30')).toEqual({ open: true, closesAt: at(5, '02:00') });
    expect(state(hours, 5, '03:00')).toEqual({ open: false });
    // Sunday night's tail reaches Monday only for the days named.
    expect(state(hours, 0, '01:00')).toEqual({ open: false });
  });

  it('joins spans that meet at midnight, and wraps the week', () => {
    expect(state('Su 20:00-24:00; Mo 00:00-03:00', 6, '23:00')).toEqual({
      open: true,
      closesAt: at(7, '03:00'),
    });
  });

  it('a later rule replaces an earlier one, and "off" closes a day', () => {
    const hours = 'Mo-Su 10:00-22:00; Mo off; Su 12:00-18:00';
    expect(state(hours, 0, '12:00')).toEqual({ open: false });
    expect(state(hours, 6, '19:00')).toEqual({ open: false });
    expect(state(hours, 6, '13:00')).toMatchObject({ open: true });
  });

  it('reads a comma between rules, times without days and public-holiday rules', () => {
    expect(state('Mo-Fr 10:00-22:00, Sa 10:00-14:00', 5, '13:00')).toMatchObject({ open: true });
    expect(state('09:00-17:00', 3, '10:00')).toMatchObject({ open: true });
    expect(state('Mo-Su 09:00-17:00; PH off', 3, '10:00')).toMatchObject({ open: true });
  });

  it('24/7 never closes', () => {
    expect(state('24/7', 2, '04:00')).toEqual({ open: true, closesAt: null });
    expect(state('Mo-Su 00:00-24:00', 2, '04:00')).toEqual({ open: true, closesAt: null });
  });

  it('gives up on what it cannot read, so nothing is guessed', () => {
    for (const hours of [
      '',
      null,
      'Apr-Oct: Mo-Su 10:00-18:00',
      'Mo-Fr sunrise-sunset',
      'Mo-Fr 10:00-22:00 "kitchen until 21"',
      'week 1-52/2 Mo 10:00-12:00',
      'Mo-Fr 10:00+',
      'Xx 10:00-12:00',
    ])
      expect(parseOpeningHours(hours)).toBeNull();
  });

  it('writes a week back as opening hours it reads the same', () => {
    for (const hours of [
      'Mo-Fr 10:00-22:00; Sa,Su 12:00-02:00',
      'Mo,We,Fr-Su 08:00-12:00,14:00-18:00',
      'Tu-Su 16:00-24:00',
      '24/7',
    ]) {
      const week = parseOpeningHours(hours)!;
      expect(parseOpeningHours(formatOpeningHours(week))).toEqual(week);
    }
    expect(formatOpeningHours(parseOpeningHours('Mo-Fr 10:00-22:00; Sa,Su 12:00-02:00')!)).toBe(
      'Mo-Fr 10:00-22:00; Sa,Su 12:00-02:00',
    );
    expect(formatOpeningHours(parseOpeningHours('Mo-Su 00:00-24:00')!)).toBe('24/7');
    expect(formatOpeningHours(parseOpeningHours('Mo off')!)).toBe('off');
  });
});
