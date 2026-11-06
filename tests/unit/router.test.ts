import { describe, it, expect } from 'vitest';
import { Router, ALPHAS, MAX_DETOUR, tierOf } from '../../shared/router.ts';
import { Graph, encodeGraph } from '../../shared/graph.ts';
import { computeRisk } from '../../shared/risk.ts';
import { buildSteps } from '../../shared/steps.ts';
import { adviseTrip } from '../../shared/advice.ts';
import { ROAD_CLASSES, RC, F_FOOT, F_VEHICLE, F_ONEWAY, type Mode } from '../../shared/modes.ts';
import { delhi, ist, TRIPS } from '../helpers.ts';

const { g, router, pois } = delhi();
const plan = (trip: keyof typeof TRIPS, mode: Mode, t: string, profile: 'woman' | 'child' = 'woman') => {
  const when = ist(t);
  return router.route({ ...TRIPS[trip], mode, when, ctx: { when, profile, pois } });
};
function overlap(a: number[], b: number[]) {
  const sa = new Set(a); let s = 0, la = 0, lb = 0;
  for (const e of a) la += g.a.edgeLen[e];
  for (const e of b) { lb += g.a.edgeLen[e]; if (sa.has(e)) s += g.a.edgeLen[e]; }
  return s / Math.min(la, lb);
}

describe('tiered routes (FR-3, FR-4)', () => {
  const res = plan('lajpatSoami', 'walk', '21:30');
  const ranked = res.routes.slice(0, res.rankedCount);

  it('TC-20 a night walk gets a fastest→safest front', () => {
    expect(res.error).toBeUndefined();
    expect(ranked.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i].timeS).toBeGreaterThanOrEqual(ranked[i - 1].timeS);
      expect(ranked[i].meanRisk).toBeLessThan(ranked[i - 1].meanRisk);
    }
    expect(ranked[0].labels).toContain('Fastest');
    expect(ranked[ranked.length - 1].labels).toContain('Safest');
  });

  it('TC-21 at most four routes and no near-duplicates', () => {
    for (const [trip, mode, t] of [['lajpatSoami', 'walk', '21:30'], ['cpIndiaGate', 'car', '23:30'], ['hkvGreenPark', 'twowheeler', '20:00']] as const) {
      const r = plan(trip, mode, t);
      expect(r.routes.length).toBeLessThanOrEqual(4);
      for (let i = 0; i < r.routes.length; i++)
        for (let j = i + 1; j < r.routes.length; j++) expect(overlap(r.routes[i].edges, r.routes[j].edges)).toBeLessThanOrEqual(0.85);
    }
  });

  it('TC-22 no route is an absurd detour', () => {
    const fastest = res.routes[0].timeS;
    for (const r of res.routes) expect(r.timeS).toBeLessThanOrEqual(Math.max(fastest * MAX_DETOUR, fastest + 240) + 1);
  });

  it('TC-23 colours follow absolute risk; a daytime main-road walk is all green', () => {
    for (const r of res.routes) expect(r.tier).toBe(tierOf(r.meanRisk, r.worstStretch));
    const day = plan('chandniNdls', 'walk', '12:00');
    expect(day.routes.every((r) => r.tier === 'green')).toBe(true);
    expect(tierOf(0.1, 0.1)).toBe('green');
    expect(tierOf(0.7, 0.8)).toBe('darkred');
  });

  it('TC-24 start equal to destination', () => {
    const when = ist('12:00');
    const r = router.route({ from: TRIPS.cpIndiaGate.from, to: TRIPS.cpIndiaGate.from, mode: 'walk', when, ctx: { when, profile: 'woman', pois } });
    expect(r.error).toBeUndefined();
    expect(r.routes.length).toBe(1);
    expect(r.routes[0].lengthM).toBeLessThan(1);
  });

  it('TC-25 points outside coverage give a clear error', () => {
    const when = ist('12:00');
    const far = router.route({ from: [77.5, 28.9], to: TRIPS.cpIndiaGate.to, mode: 'walk', when, ctx: { when, profile: 'woman', pois } });
    expect(far.routes).toHaveLength(0);
    expect(far.error).toMatch(/too far from any road/);
  });

  it('TC-26 modes stay on roads they may use', () => {
    const banned: Record<Mode, string[]> = {
      walk: ['motorway'], car: ['footway', 'steps', 'path', 'pedestrian', 'track'],
      auto: ['footway', 'steps', 'path', 'pedestrian', 'motorway'], twowheeler: ['footway', 'steps', 'path', 'pedestrian'],
    };
    for (const mode of ['walk', 'car', 'auto', 'twowheeler'] as Mode[]) {
      for (const trip of ['lajpatSoami', 'hkvGreenPark'] as const) {
        for (const r of plan(trip, mode, '22:00').routes)
          for (const e of r.edges) expect(banned[mode]).not.toContain(ROAD_CLASSES[g.a.edgeClass[e]]);
      }
    }
  });

  it('TC-27 one-way streets: cars obey, pedestrians do not care', () => {
    // a 2x2 grid where the short side a→b is one-way b→a
    //   a ---- b
    //   |      |
    //   c ---- d
    const nodes = [[77.2, 28.6], [77.202, 28.6], [77.2, 28.598], [77.202, 28.598]];
    const E = [[1, 0, F_ONEWAY], [0, 2, 0], [2, 3, 0], [3, 1, 0]];
    const arr = {
      nodeLon: Int32Array.from(nodes.map((n) => n[0] * 1e6)), nodeLat: Int32Array.from(nodes.map((n) => n[1] * 1e6)),
      edgeU: Uint32Array.from(E.map((e) => e[0])), edgeV: Uint32Array.from(E.map((e) => e[1])),
      edgeLen: Float32Array.from(E.map(() => 200)), edgeClass: Uint8Array.from(E.map(() => RC.residential)),
      edgeFlags: Uint8Array.from(E.map((e) => F_FOOT | F_VEHICLE | e[2])), edgeName: Int32Array.from(E.map(() => -1)),
      edgePoliceM: Uint16Array.from(E.map(() => 300)), edgeStationM: Uint16Array.from(E.map(() => 3000)),
      edgeBldg: Uint8Array.from(E.map(() => 10)), edgeGreen: new Uint8Array(4), poiOff: new Uint32Array(5), poiIdx: new Uint32Array(0),
    };
    const tiny = new Graph(encodeGraph(arr, { bbox: [77.199, 28.597, 77.203, 28.601], snapshot: 't', source: 't', onewayKnown: true, names: [] }));
    const rt = new Router(tiny);
    const when = ist('12:00');
    const go = (mode: Mode) => rt.route({ from: [77.2, 28.6], to: [77.202, 28.6], mode, when, ctx: { when, profile: 'woman', pois: [] } });
    expect(go('walk').routes[0].lengthM).toBeLessThan(250); // straight along a→b
    expect(go('car').routes[0].lengthM).toBeGreaterThan(550); // around the block
  });

  it('TC-28 four routes in well under 500 ms', () => {
    plan('cpIndiaGate', 'walk', '22:00');
    const t = performance.now();
    const r = plan('lajpatSoami', 'walk', '22:30');
    const ms = performance.now() - t;
    expect(r.routes.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(500);
  });

  it('TC-29 routes explain themselves', () => {
    const r = ranked[0];
    expect(r.havenIds.length).toBeGreaterThan(0);
    expect(r.policeShare).toBeGreaterThanOrEqual(0);
    expect(r.mainRoadShare).toBeLessThanOrEqual(1);
    for (const d of r.dangerSpots) { expect(d.lengthM).toBeGreaterThanOrEqual(120); expect(Array.isArray(d.reasons)).toBe(true); }
  });

  it('TC-30 suggests an auto when every walk is risky late at night', () => {
    const when = ist('23:30');
    const walk = plan('hkvGreenPark', 'walk', '23:30');
    const auto = plan('hkvGreenPark', 'auto', '23:30');
    const best = auto.routes.reduce((a, b) => (b.meanRisk < a.meanRisk ? b : a));
    const adv = adviseTrip({ mode: 'walk', profile: 'woman', when, routes: walk.routes, vehicleAltS: { mode: 'auto', timeS: best.timeS, tier: best.tier } });
    expect(adv?.level).toBe('warn');
    expect(adv?.suggestMode).toBe('auto');
    const dayAdv = adviseTrip({ mode: 'walk', profile: 'woman', when: ist('12:00'), routes: plan('chandniNdls', 'walk', '12:00').routes });
    expect(dayAdv?.level).toBe('ok');
  });

  it('TC-31 turn-by-turn steps cover the route', () => {
    const r = ranked[0];
    const steps = buildSteps(g, r.segEdge, r.coords);
    expect(steps[0].turn).toBe('start');
    expect(steps[steps.length - 1].turn).toBe('arrive');
    expect(steps.length).toBeGreaterThan(3);
    const sum = steps.reduce((a, s) => a + s.distM, 0);
    expect(Math.abs(sum - r.lengthM) / r.lengthM).toBeLessThan(0.02);
  });

  it('TC-32 whole Delhi: long trips in outer districts route quickly', () => {
    for (const [trip, mode] of [['narelaNajafgarh', 'twowheeler'], ['dwarkaLaxmi', 'auto'], ['mangolSultan', 'walk']] as const) {
      const t = performance.now();
      const r = plan(trip, mode, '21:00');
      const ms = performance.now() - t;
      expect(r.error).toBeUndefined();
      expect(r.routes.length).toBeGreaterThanOrEqual(1);
      expect(ms).toBeLessThan(4000);
      const crow = Math.hypot((TRIPS[trip].from[0] - TRIPS[trip].to[0]) * 97.6, (TRIPS[trip].from[1] - TRIPS[trip].to[1]) * 111.2) * 1000;
      expect(r.routes[0].lengthM).toBeGreaterThan(crow);
      expect(r.routes[0].lengthM).toBeLessThan(crow * 2.2);
    }
  });

  it('TC-33 vehicles never go the wrong way on real one-way streets', () => {
    let checked = 0;
    for (const [trip, mode] of [['cpIndiaGate', 'car'], ['dwarkaLaxmi', 'auto'], ['chandniNdls', 'twowheeler'], ['lajpatSoami', 'car']] as const) {
      for (const r of plan(trip, mode, '10:00').routes) {
        const E = r.edges;
        let cur = g.a.edgeU[E[0]] === g.a.edgeU[E[1]] || g.a.edgeU[E[0]] === g.a.edgeV[E[1]] ? g.a.edgeU[E[0]] : g.a.edgeV[E[0]];
        for (let i = 1; i < E.length - 1; i++) {
          const e = E[i];
          if (g.a.edgeFlags[e] & F_ONEWAY) { expect(g.a.edgeU[e]).toBe(cur); checked++; }
          cur = g.other(e, cur);
        }
      }
    }
    expect(g.meta.onewayKnown).toBe(true);
    expect(checked).toBeGreaterThan(20);
  });

  it('routes follow real road geometry', () => {
    const r = plan('cpIndiaGate', 'walk', '12:00').routes[0];
    expect(r.coords.length).toBeGreaterThan(r.edges.length);
    expect(r.segEdge.length).toBe(r.coords.length - 1);
    let len = 0;
    for (let i = 1; i < r.coords.length; i++) len += g.proj.dist(r.coords[i - 1][0], r.coords[i - 1][1], r.coords[i][0], r.coords[i][1]);
    expect(Math.abs(len - r.lengthM) / r.lengthM).toBeLessThan(0.02);
  });

  it('runs one search per safety level', () => { expect(ALPHAS).toEqual([0, 0.5, 1.5, 5]); });
  it('risk field is reused when passed in', () => {
    const when = ist('22:00');
    const risk = computeRisk(g, { when, profile: 'woman', pois });
    const r = router.route({ ...TRIPS.cpIndiaGate, mode: 'walk', when, ctx: { when, profile: 'woman', pois } }, risk);
    expect(r.risk).toBe(risk);
  });
});
