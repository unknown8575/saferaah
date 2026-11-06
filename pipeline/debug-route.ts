import { readFileSync } from 'node:fs';
import { Graph } from '../shared/graph.ts';
import { Router } from '../shared/router.ts';
import { computeRisk } from '../shared/risk.ts';
import type { Poi } from '../shared/places.ts';

const g = new Graph(readFileSync('web/public/data/graph.bin'));
const pois: Poi[] = JSON.parse(readFileSync('web/public/data/pois.json', 'utf8'));
let t = performance.now();
const router = new Router(g);
console.log('router init', (performance.now() - t).toFixed(0));
t = performance.now();
const usable = router.usableFor('walk');
const s = g.snap(77.2195, 28.6315, usable);
console.log('snap', (performance.now() - t).toFixed(0), s);
t = performance.now();
const when = new Date('2026-11-06T13:00:00+05:30');
const risk = computeRisk(g, { when, profile: 'woman', pois });
console.log('risk', (performance.now() - t).toFixed(0), risk.risk.slice(0, 5));
