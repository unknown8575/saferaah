import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { matchIntent, kindLabel, kindCat } from '../../shared/kinds.ts';
import { setPlaces, nearbyFor, knownSubs } from '../../web/src/browse.ts';
import { ist, TRIPS } from '../helpers.ts';

setPlaces(JSON.parse(readFileSync('web/public/data/places.json', 'utf8')));
const CP = TRIPS.cpIndiaGate.from;

describe('search by kind of place', () => {
  it('TC-140 everyday words find the right kind, including Hinglish and partial typing', () => {
    expect(matchIntent('gym')?.exact).toContain('fitness_centre');
    expect(matchIntent('Gym near me')?.exact).toContain('fitness_centre');
    expect(matchIntent('kirana')?.exact).toContain('convenience');
    expect(matchIntent('groc')?.title).toBe('Grocery stores');
    expect(matchIntent('parlour')?.exact).toContain('beauty');
    expect(matchIntent('chemist')?.exact).toContain('pharmacy');
    expect(matchIntent('xerox')?.exact).toContain('copyshop');
    expect(matchIntent('gy')).toBeNull(); // too short to guess
    expect(matchIntent('India Gate')).toBeNull(); // a place name, not a kind
    expect(matchIntent('tattoo', knownSubs())?.exact).toEqual(['tattoo']); // a mapped type typed directly
  });
  it('TC-141 "gym" near Connaught Place lists 5–7 real gyms, nearest first, with open state', () => {
    const res = nearbyFor(matchIntent('gym')!, CP, ist('19:00'));
    expect(res.length).toBeGreaterThanOrEqual(5);
    expect(res.length).toBeLessThanOrEqual(7);
    const ex = res.filter((p) => !p.similar);
    for (let i = 1; i < ex.length; i++) expect(ex[i].distM).toBeGreaterThanOrEqual(ex[i - 1].distM);
    expect(ex[0].label).toBe('Gym');
    for (const p of res) expect(typeof p.open).toBe('boolean');
  });
  it('TC-142 when the exact kind is not nearby, similar places fill the list', () => {
    // swimming pools are rare: a request for them falls back to similar sports places
    const rare = { title: 'Pools', one: 'pool', exact: ['swimming_pool'], similar: ['fitness_centre', 'sports_centre'], words: [] };
    const res = nearbyFor(rare, CP, ist('19:00'));
    expect(res.length).toBeGreaterThanOrEqual(5);
    expect(res.some((p) => p.similar)).toBe(true);
    // exact matches always come before similar ones
    const firstSim = res.findIndex((p) => p.similar);
    expect(res.slice(firstSim).every((p) => p.similar)).toBe(true);
  });
  it('TC-143 labels and categories for every kind', () => {
    expect(kindLabel('fitness_centre')).toBe('Gym');
    expect(kindLabel('some_new_kind')).toBe('Some new kind');
    expect(kindCat('cafe')).toBe('food');
    expect(kindCat('pharmacy')).toBe('pharmacy');
    expect(kindCat('clothes')).toBe('shop');
  });
});
