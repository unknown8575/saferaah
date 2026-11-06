// Find trips whose fastest→safest front has several distinct routes (for demos/tests).
import { readFileSync } from 'node:fs';
import { Graph } from '../shared/graph.ts';
import { Router } from '../shared/router.ts';
import { computeRisk } from '../shared/risk.ts';
import type { Poi } from '../shared/places.ts';
import type { Mode } from '../shared/modes.ts';

const g = new Graph(readFileSync('web/public/data/graph.bin'));
const pois: Poi[] = JSON.parse(readFileSync('web/public/data/pois.json', 'utf8'));
const search: [string, number, number, string][] = JSON.parse(readFileSync('web/public/data/search.json', 'utf8'));
const router = new Router(g);
const mode = (process.argv[2] ?? 'walk') as Mode;
const iso = process.argv[3] ?? '2026-11-06T21:30:00+05:30';
const when = new Date(iso);
const risk = computeRisk(g, { when, profile: 'woman', pois });
const named = search.filter((s) => ['station', 'suburb', 'neighbourhood', 'police', 'hospital', 'quarter'].includes(s[3]));
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const found: string[] = [];
for (let k = 0; k < 400 && found.length < 12; k++) {
  const a = named[Math.floor(rnd() * named.length)], b = named[Math.floor(rnd() * named.length)];
  const d = Math.hypot((a[1] - b[1]) * 97.6, (a[2] - b[2]) * 111.2);
  if (d < 1.5 || d > 4) continue;
  const res = router.route({ from: [a[1], a[2]], to: [b[1], b[2]], mode, when, ctx: { when, profile: 'woman', pois } }, risk);
  if ((res.rankedCount ?? 0) >= 3) {
    found.push(`${a[0]} -> ${b[0]} | from=${a[1]},${a[2]}&to=${b[1]},${b[2]} | ` +
      res.routes.map((r) => `${r.tier}:${(r.timeS / 60).toFixed(0)}m/${r.meanRisk.toFixed(2)}${r.labels.includes('Alternative') ? '(alt)' : ''}`).join(' '));
  }
}
console.log(found.join('\n'));
