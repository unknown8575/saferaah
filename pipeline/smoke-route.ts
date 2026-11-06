import { readFileSync } from 'node:fs';
import { Graph } from '../shared/graph.ts';
import { Router, TIER_INFO } from '../shared/router.ts';
import type { Poi } from '../shared/places.ts';
import type { Mode } from '../shared/modes.ts';

const dir = process.argv[2] ?? 'web/public/data';
let t = performance.now();
const g = new Graph(readFileSync(`${dir}/graph.bin`));
const pois: Poi[] = JSON.parse(readFileSync(`${dir}/pois.json`, 'utf8'));
const router = new Router(g);
console.log('load', (performance.now() - t).toFixed(0), 'ms', g.n, 'nodes', g.m, 'edges');

const trips: [string, [number, number], [number, number]][] = [
  ['Connaught Place -> India Gate', [77.2195, 28.6315], [77.2295, 28.6129]],
  ['Hauz Khas Village -> Green Park metro', [77.1940, 28.5535], [77.2070, 28.5596]],
  ['Lajpat Nagar -> Nizamuddin stn', [77.2373, 28.5677], [77.2507, 28.5888]],
  ['Chandni Chowk -> New Delhi stn', [77.2303, 28.6506], [77.2190, 28.6430]],
];
const times = ['2026-11-06T13:00:00+05:30', '2026-11-06T23:30:00+05:30'];
for (const [name, from, to] of trips) for (const iso of times) for (const mode of ['walk', 'car'] as Mode[]) {
  const when = new Date(iso);
  const res = router.route({ from, to, mode, when, ctx: { when, profile: 'woman', pois } });
  console.log(`\n${name} | ${mode} | ${iso.slice(11, 16)} | ${res.computeMs.toFixed(0)} ms ${res.error ?? ''} ${res.note ?? ''}`);
  for (const r of res.routes) {
    console.log(`  α=${r.alpha} ${TIER_INFO[r.tier].label.padEnd(9)} ${(r.timeS / 60).toFixed(1)} min ${(r.lengthM / 1000).toFixed(2)} km risk=${r.meanRisk.toFixed(3)} worst=${r.worstStretch.toFixed(2)} main=${(r.mainRoadShare * 100).toFixed(0)}% havens=${r.havenIds.length} spots=${r.dangerSpots.length} ${r.labels.join(',')} | ${r.warnings.join('; ')}`);
  }
}
