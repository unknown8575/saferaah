import { describe, it, expect } from 'vitest';
import { computeRisk } from '../../shared/risk.ts';
import { liveEdgeDeltas, reportStrength, REPORT_KINDS, type LiveReport } from '../../shared/live.ts';
import { routePrecautions } from '../../shared/precautions.ts';
import { haversine } from '../../shared/geo.ts';
import { delhi, ist, TRIPS } from '../helpers.ts';

const { g, router, pois } = delhi();
const T0 = ist('22:00').getTime();
const rep = (o: Partial<LiveReport>): LiveReport => ({
  id: 'r1', kind: 'harassment', lon: 77.2197, lat: 28.6328, createdAt: T0, expiresAt: T0 + 6 * 3600000, confirms: 1, dismisses: 0, ...o,
});

describe('graph lookups for the live map', () => {
  it('TC-120 edgesNear returns only streets that pass within the radius', () => {
    const [lon, lat] = TRIPS.cpIndiaGate.from;
    const near = g.edgesNear(lon, lat, 60);
    expect(near.length).toBeGreaterThan(0);
    for (const e of near) {
      const d = Math.min(...g.polyline(e).map(([x, y]) => haversine(lon, lat, x, y)));
      expect(d).toBeLessThan(60 + 160); // closest vertex; the segment itself passes within 60 m
    }
    expect(g.edgesNear(lon, lat, 200).length).toBeGreaterThan(near.length);
  });
  it('TC-121 edgesInBox caps the count and keeps the bigger roads', () => {
    const box = [77.20, 28.62, 77.24, 28.645] as const;
    const all = g.edgesInBox(...box, 1e9);
    const few = g.edgesInBox(...box, 300);
    expect(all.length).toBeGreaterThan(300);
    expect(few.length).toBeLessThanOrEqual(300);
    const rank = (e: number) => g.a.edgeClass[e];
    const avg = (xs: number[]) => xs.reduce((a, e) => a + rank(e), 0) / xs.length;
    expect(avg(few)).toBeLessThan(avg(all)); // lower class index = more important road
  });
});

describe('live safety reports', () => {
  it('TC-122 a single report counts half until someone confirms it, and nothing once expired or dismissed', () => {
    expect(reportStrength(rep({}), T0)).toBeCloseTo(0.5, 5);
    expect(reportStrength(rep({ confirms: 2 }), T0)).toBeCloseTo(1, 5);
    expect(reportStrength(rep({ confirms: 2 }), T0 + 5.5 * 3600000)).toBeLessThan(1);
    expect(reportStrength(rep({}), T0 + 7 * 3600000)).toBe(0);
    expect(reportStrength(rep({ confirms: 1, dismisses: 2 }), T0)).toBe(0);
  });
  it('TC-123 danger reports raise street risk nearby, police patrols lower it', () => {
    const when = ist('22:00');
    const base = computeRisk(g, { when, profile: 'woman', pois });
    const bad = liveEdgeDeltas(g, [rep({ confirms: 3 })], T0);
    const good = liveEdgeDeltas(g, [rep({ kind: 'police', confirms: 3 })], T0);
    expect(bad.size).toBeGreaterThan(0);
    const withBad = computeRisk(g, { when, profile: 'woman', pois, live: bad });
    const withGood = computeRisk(g, { when, profile: 'woman', pois, live: good });
    for (const [e, d] of bad) {
      expect(d).toBeCloseTo(0.3 * REPORT_KINDS.harassment.weight, 5);
      expect(withBad.risk[e]).toBeGreaterThanOrEqual(base.risk[e]);
    }
    let lower = 0;
    for (const e of good.keys()) if (withGood.risk[e] < base.risk[e]) lower++;
    expect(lower).toBeGreaterThan(0);
    // far away streets are untouched
    const farEdge = g.snap(77.09, 28.85, () => true, 500)!.edge;
    expect(withBad.risk[farEdge]).toBe(base.risk[farEdge]);
  });
  it('TC-124 routes steer around a confirmed harassment report and say why', () => {
    const when = ist('21:30');
    const plain = router.route({ ...TRIPS.lajpatSoami, mode: 'walk', when, ctx: { when, profile: 'woman', pois } });
    const fast = plain.routes[0];
    const mid = fast.coords[Math.floor(fast.coords.length / 2)];
    const live = liveEdgeDeltas(g, [rep({ lon: mid[0], lat: mid[1], confirms: 4, createdAt: when.getTime(), expiresAt: when.getTime() + 6 * 3600000 })], when.getTime());
    const risk = computeRisk(g, { when, profile: 'woman', pois, live });
    const after = router.route({ ...TRIPS.lajpatSoami, mode: 'walk', when, ctx: { when, profile: 'woman', pois, live } }, risk);
    const sameLine = after.routes.find((r) => r.edges.length === fast.edges.length && r.edges.every((e, i) => e === fast.edges[i]));
    if (sameLine) expect(sameLine.meanRisk).toBeGreaterThan(fast.meanRisk);
    const reasons = after.routes.flatMap((r) => r.dangerSpots.flatMap((d) => d.reasons));
    const passes = after.routes.some((r) => r.edges.some((e) => live.has(e)));
    if (passes) expect(reasons).toContain('reported unsafe by travellers recently');
    // the safest route avoids the reported streets
    const safest = after.routes.reduce((a, b) => (b.meanRisk < a.meanRisk ? b : a));
    expect(safest.edges.filter((e) => live.has(e)).length).toBeLessThanOrEqual(fast.edges.filter((e) => live.has(e)).length);
  });
});

describe('fastest time per mode and precautions', () => {
  it('TC-125 fastestTime gives a time for every mode, walking slowest', () => {
    const when = ist('18:00');
    const t = (m: 'walk' | 'twowheeler' | 'auto' | 'car') => router.fastestTime(TRIPS.lajpatSoami.from, TRIPS.lajpatSoami.to, m, when, 'woman')!;
    expect(t('walk')).toBeGreaterThan(t('auto'));
    expect(t('walk')).toBeGreaterThan(t('car'));
    expect(t('twowheeler')).toBeGreaterThan(0);
    const routed = router.route({ ...TRIPS.lajpatSoami, mode: 'walk', when, ctx: { when, profile: 'woman', pois } }).routes[0].timeS;
    expect(Math.abs(t('walk') - routed) / routed).toBeLessThan(0.05);
    expect(router.fastestTime([70, 20], TRIPS.lajpatSoami.to, 'walk', when, 'woman')).toBeNull();
  });
  it('TC-126 every route gets a precaution headline; risky night walks suggest an auto', () => {
    const when = ist('22:30');
    const res = router.route({ ...TRIPS.lajpatSoami, mode: 'walk', when, ctx: { when, profile: 'woman', pois } });
    for (const r of res.routes) {
      const p = routePrecautions(r, { mode: 'walk', profile: 'woman', when, pois });
      expect(p.headline.length).toBeGreaterThan(5);
      if (r.tier === 'red' || r.tier === 'darkred') {
        expect(p.items[0]).toMatch(/auto or cab/);
        expect(p.items.some((x) => x.startsWith('Share your live trip'))).toBe(true);
      }
      for (const s of r.dangerSpots.slice(0, 3)) expect(p.items.join('\n')).toContain(s.reasons[0] ?? 'quiet');
    }
    const day = ist('12:30');
    const dres = router.route({ ...TRIPS.cpIndiaGate, mode: 'walk', when: day, ctx: { when: day, profile: 'woman', pois } });
    const green = dres.routes.find((r) => r.tier === 'green');
    if (green) expect(routePrecautions(green, { mode: 'walk', profile: 'woman', when: day, pois }).headline).toMatch(/Busy|Mostly busy/);
  });
});
