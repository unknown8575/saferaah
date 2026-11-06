import { readFileSync } from 'node:fs';
import { Graph } from '../shared/graph.ts';
import { Router } from '../shared/router.ts';
import { computeRisk } from '../shared/risk.ts';
import { ROAD_CLASSES, MODE_INFO } from '../shared/modes.ts';
import type { Poi } from '../shared/places.ts';

const g = new Graph(readFileSync('web/public/data/graph.bin'));
const pois: Poi[] = JSON.parse(readFileSync('web/public/data/pois.json', 'utf8'));
const router = new Router(g);
for (const iso of ['2026-11-06T13:00:00+05:30', '2026-11-06T20:00:00+05:30', '2026-11-06T23:30:00+05:30']) {
  const when = new Date(iso);
  const rf = computeRisk(g, { when, profile: 'woman', pois });
  console.log('\n', iso.slice(11, 16), 'open POIs', rf.poiOpen.reduce((a, b) => a + b, 0));
  const by: Record<string, number[]> = {};
  for (let e = 0; e < g.m; e++) (by[ROAD_CLASSES[g.a.edgeClass[e]]] ??= []).push(rf.risk[e]);
  for (const [k, v] of Object.entries(by)) {
    v.sort((a, b) => a - b);
    const q = (p: number) => v[Math.floor(p * (v.length - 1))].toFixed(2);
    console.log(k.padEnd(14), String(v.length).padStart(6), 'p10', q(0.1), 'p50', q(0.5), 'p90', q(0.9));
  }
}
// candidate routes before filtering
const when = new Date('2026-11-06T23:30:00+05:30');
const risk = computeRisk(g, { when, profile: 'woman', pois });
const usable = router.usableFor('walk');
const s = g.snap(77.1940, 28.5535, usable)!, t = g.snap(77.2070, 28.5596, usable)!;
const times = router.edgeTimes('walk', when, 'woman');
for (const alpha of [0, 0.5, 1.5, 5, 10]) {
  const cost = new Float32Array(g.m);
  for (let e = 0; e < g.m; e++) cost[e] = times[e] * (1 + alpha * MODE_INFO.walk.exposure * risk.risk[e]);
  const r = router.astar(cost, 'walk', s, t, usable)!;
  const d = router.describe(alpha, r.edges, s, t, times, risk, { from: [0, 0], to: [0, 0], mode: 'walk', when, ctx: { when, profile: 'woman', pois } });
  console.log('α', alpha, (d.timeS / 60).toFixed(1), 'min risk', d.meanRisk.toFixed(3), 'worst', d.worstStretch.toFixed(2), 'main', d.mainRoadShare.toFixed(2));
}
