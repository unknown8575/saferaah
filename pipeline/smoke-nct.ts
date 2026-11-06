// Route timing and sanity on the whole-Delhi graph.
import { readFileSync } from 'node:fs';
import { Graph } from '../shared/graph.ts';
import { Router, TIER_INFO } from '../shared/router.ts';
import { computeRisk } from '../shared/risk.ts';
import type { Poi } from '../shared/places.ts';
import type { Mode } from '../shared/modes.ts';

const dir = process.argv[2] ?? 'web/public/data';
let t = performance.now();
const g = new Graph(readFileSync(`${dir}/graph.bin`));
const pois: Poi[] = JSON.parse(readFileSync(`${dir}/pois.json`, 'utf8'));
const router = new Router(g);
console.log('load', (performance.now() - t).toFixed(0), 'ms', g.n, 'nodes', g.m, 'edges');
const trips: [string, [number, number], [number, number], Mode][] = [
  ['Rohini Sec 18 metro -> Saket (25 km)', [77.1395, 28.7392], [77.2167, 28.5245], 'car'],
  ['Dwarka Sec 21 -> Laxmi Nagar (25 km)', [77.0583, 28.5523], [77.2776, 28.6304], 'auto'],
  ['Narela -> Najafgarh (30 km)', [77.093, 28.852], [76.98, 28.61], 'twowheeler'],
  ['Shahdara -> Seelampur walk (3 km)', [77.2895, 28.6731], [77.2669, 28.6704], 'walk'],
  ['Mangolpuri -> Sultanpuri walk (2 km)', [77.0853, 28.6977], [77.0634, 28.6927], 'walk'],
  ['Sangam Vihar -> Khanpur walk (2.5 km)', [77.2414, 28.4996], [77.2309, 28.5139], 'walk'],
  ['Uttam Nagar -> Janakpuri West walk (2 km)', [77.0592, 28.6215], [77.0784, 28.6293], 'walk'],
];
for (const iso of ['2026-11-06T13:00:00+05:30', '2026-11-06T22:30:00+05:30']) {
  const when = new Date(iso);
  t = performance.now();
  const risk = computeRisk(g, { when, profile: 'woman', pois });
  console.log(`\nrisk field ${iso.slice(11, 16)}: ${(performance.now() - t).toFixed(0)} ms`);
  for (const [name, from, to, mode] of trips) {
    const res = router.route({ from, to, mode, when, ctx: { when, profile: 'woman', pois } }, risk);
    console.log(`${name} | ${mode} | ${res.computeMs.toFixed(0)} ms ${res.error ?? ''} ${res.note ?? ''}`);
    for (const r of res.routes) console.log(`   ${TIER_INFO[r.tier].label.padEnd(9)} ${(r.timeS / 60).toFixed(0)} min ${(r.lengthM / 1000).toFixed(1)} km risk=${r.meanRisk.toFixed(2)} pts=${r.coords.length} havens=${r.havenIds.length} ${r.labels.join(',')}`);
  }
}
