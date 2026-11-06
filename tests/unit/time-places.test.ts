import { describe, it, expect } from 'vitest';
import { istTime, bandOf, darkness, timeScale } from '../../shared/time.ts';
import { isOpenAt, stripPublicHolidays, poiCategory } from '../../shared/places.ts';
import { ist } from '../helpers.ts';

describe('IST time (NFR-6)', () => {
  it('TC-01 converts UTC to IST regardless of machine timezone', () => {
    expect(process.env.TZ).toBe('UTC');
    const d = new Date('2026-11-06T18:00:00Z');
    expect(istTime(d).minutes).toBe(23 * 60 + 30);
    expect(bandOf(d)).toBe('night');
    expect(istTime(d).dow).toBe(5); // Friday
  });
  it('TC-02 darkness ramps at dusk and dawn', () => {
    expect(darkness(ist('12:00'))).toBe(0);
    expect(darkness(ist('23:00'))).toBe(1);
    const dusk = darkness(ist('18:15'));
    expect(dusk).toBeGreaterThan(0);
    expect(dusk).toBeLessThan(1);
    const dawn = darkness(ist('06:15'));
    expect(dawn).toBeGreaterThan(0);
    expect(dawn).toBeLessThan(1);
  });
  it('time scale is low by day, moderate in the evening, full at night', () => {
    expect(timeScale(ist('13:00'))).toBeCloseTo(0.35);
    expect(timeScale(ist('20:00'))).toBeGreaterThan(0.6);
    expect(timeScale(ist('20:00'))).toBeLessThan(0.8);
    expect(timeScale(ist('02:00'))).toBe(1);
  });
});

describe('opening hours (FR-7)', () => {
  const pharmacy = { cat: 'pharmacy' as const, oh: 'Mo-Sa 09:00-21:00' };
  it('TC-03 uses the mapped opening_hours tag', () => {
    const tue = '2026-11-10';
    expect(isOpenAt(pharmacy, ist('20:00', tue))).toEqual({ open: true, verified: true });
    expect(isOpenAt(pharmacy, ist('22:00', tue))).toEqual({ open: false, verified: true });
    expect(isOpenAt(pharmacy, ist('10:00', '2026-11-08')).open).toBe(false); // Sunday
  });
  it('TC-04 tolerates public-holiday (PH) rules', () => {
    for (const oh of ['Mo-Su,PH 09:00-23:00', 'Mo-Sa 10:00-20:00; PH off', 'Mo-Fr 10:00-17:00; Su closed PH closed', 'PH,Mo-Su 08:00-22:00']) {
      const s = isOpenAt({ cat: 'shop', oh }, ist('12:00'));
      expect(s.verified).toBe(true);
      expect(s.open).toBe(true);
    }
    expect(stripPublicHolidays('Mo-Su,PH 09:00-23:00')).toBe('Mo-Su 09:00-23:00');
    expect(stripPublicHolidays('PH off')).toBe('');
  });
  it('TC-05 malformed tags fall back to estimated hours', () => {
    const s = isOpenAt({ cat: 'shop', oh: 'open when we feel like it' }, ist('12:00'));
    expect(s).toEqual({ open: true, verified: false });
    expect(isOpenAt({ cat: 'shop', oh: 'nonsense' }, ist('23:00')).open).toBe(false);
  });
  it('TC-06 police and hospitals are always open', () => {
    expect(isOpenAt({ cat: 'police' }, ist('03:00')).open).toBe(true);
    expect(isOpenAt({ cat: 'hospital' }, ist('03:00')).open).toBe(true);
    expect(isOpenAt({ cat: 'shop' }, ist('03:00')).open).toBe(false);
  });
  it('TC-07 banks and govt offices are closed on Sunday', () => {
    expect(isOpenAt({ cat: 'bank' }, ist('12:00', '2026-11-08')).open).toBe(false);
    expect(isOpenAt({ cat: 'bank' }, ist('12:00', '2026-11-09')).open).toBe(true);
  });
  it('TC-08 overnight windows', () => {
    expect(isOpenAt({ cat: 'food', oh: 'Mo-Su 22:00-02:00' }, ist('01:00')).open).toBe(true);
    expect(isOpenAt({ cat: 'food', oh: 'Mo-Su 22:00-02:00' }, ist('03:00')).open).toBe(false);
  });
  it('categorises OSM tags, including liquor outlets', () => {
    expect(poiCategory({ amenity: 'police' })).toBe('police');
    expect(poiCategory({ shop: 'chemist' })).toBe('pharmacy');
    expect(poiCategory({ shop: 'alcohol' })).toBe('liquor');
    expect(poiCategory({ amenity: 'bar' })).toBe('liquor');
    expect(poiCategory({ amenity: 'bench' })).toBeNull();
  });
});
