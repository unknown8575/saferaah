// Builds web/public/data/air.bin: per-street facts the clean-air router needs.
//
//   tsx pipeline/build-air.ts <delhi.geojson> <outDir>
//
// For every edge of graph.bin we store
//   indM   distance to the nearest industrial / quarry land (OSM landuse), metres
//   majM   distance to the nearest busy road (motorway/trunk/primary/secondary)
//   dumpM  distance to the nearest of Delhi's landfill sites (they burn and smoke)
//   area   index of the named industrial area or landfill the edge is near, or -1
// Distances come from a 50 m raster and a two-pass chamfer distance transform, so
// the whole city takes a couple of seconds.

import { readFileSync, writeFileSync } from 'node:fs';
import { Graph } from '../shared/graph.ts';
import { pointInPolygon, type LonLat } from '../shared/geo.ts';
import { ROAD_CLASSES } from '../shared/modes.ts';
import { encodeAir, AIR_CAP, type AirArrays } from '../shared/air.ts';

const [, , inPath, outDir] = process.argv;
if (!inPath || !outDir) {
  console.error('usage: tsx pipeline/build-air.ts <input.geojson> <outDir>');
  process.exit(1);
}
const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

const g = new Graph(readFileSync(`${outDir}/graph.bin`));
const [W, S, E, N] = g.meta.bbox;
const CELL = 50;
const kx = g.proj.kx, ky = g.proj.ky;
const NX = Math.ceil(((E - W) * kx) / CELL) + 1;
const NY = Math.ceil(((N - S) * ky) / CELL) + 1;
const cx = (lon: number) => Math.max(0, Math.min(NX - 1, Math.floor(((lon - W) * kx) / CELL)));
const cy = (lat: number) => Math.max(0, Math.min(NY - 1, Math.floor(((lat - S) * ky) / CELL)));
const lonOf = (i: number) => W + ((i + 0.5) * CELL) / kx;
const latOf = (j: number) => S + ((j + 0.5) * CELL) / ky;
log(`grid ${NX}×${NY}`);

/** Two-pass 8-neighbour chamfer distance transform (metres), seeded where src=1. */
function distanceField(src: Uint8Array): Float32Array {
  const d = new Float32Array(NX * NY).fill(1e9);
  for (let k = 0; k < src.length; k++) if (src[k]) d[k] = 0;
  const a = CELL, b = CELL * Math.SQRT2;
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const k = j * NX + i;
    let v = d[k];
    if (i > 0) v = Math.min(v, d[k - 1] + a);
    if (j > 0) {
      v = Math.min(v, d[k - NX] + a);
      if (i > 0) v = Math.min(v, d[k - NX - 1] + b);
      if (i < NX - 1) v = Math.min(v, d[k - NX + 1] + b);
    }
    d[k] = v;
  }
  for (let j = NY - 1; j >= 0; j--) for (let i = NX - 1; i >= 0; i--) {
    const k = j * NX + i;
    let v = d[k];
    if (i < NX - 1) v = Math.min(v, d[k + 1] + a);
    if (j < NY - 1) {
      v = Math.min(v, d[k + NX] + a);
      if (i < NX - 1) v = Math.min(v, d[k + NX + 1] + b);
      if (i > 0) v = Math.min(v, d[k + NX - 1] + b);
    }
    d[k] = v;
  }
  return d;
}

// ---------- industrial land ----------
interface Feature { geometry: { type: string; coordinates: any }; properties: { kind: string; tags?: Record<string, string> } }
const fc = JSON.parse(readFileSync(inPath, 'utf8')) as { features: Feature[] };
const ind = new Uint8Array(NX * NY);
let nPoly = 0;
for (const f of fc.features) {
  const lu = f.properties.tags?.landuse ?? '';
  if (!['industrial', 'quarry', 'construction', 'brownfield'].includes(lu)) continue;
  const polys: LonLat[][][] = f.geometry.type === 'Polygon' ? [f.geometry.coordinates]
    : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
  for (const rings of polys) {
    if (!rings.length || rings[0].length < 4) continue;
    nPoly++;
    let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
    for (const [x, y] of rings[0]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const i0 = cx(x0), i1 = cx(x1), j0 = cy(y0), j1 = cy(y1);
    let hit = false;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (pointInPolygon(lonOf(i), latOf(j), rings)) { ind[j * NX + i] = 1; hit = true; }
    }
    // slivers narrower than a cell still count
    if (!hit) ind[cy((y0 + y1) / 2) * NX + cx((x0 + x1) / 2)] = 1;
  }
}
const indD = distanceField(ind);
log('industrial polygons', nPoly);

// ---------- busy roads ----------
const MAJOR = new Set(['motorway', 'trunk', 'primary', 'secondary']);
const maj = new Uint8Array(NX * NY);
for (let e = 0; e < g.m; e++) {
  if (!MAJOR.has(ROAD_CLASSES[g.a.edgeClass[e]])) continue;
  const pts = g.polyline(e);
  for (let k = 1; k < pts.length; k++) {
    const [ax, ay] = pts[k - 1], [bx, by] = pts[k];
    const steps = Math.max(1, Math.ceil(g.proj.dist(ax, ay, bx, by) / 20));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      maj[cy(ay + (by - ay) * t) * NX + cx(ax + (bx - ax) * t)] = 1;
    }
  }
}
const majD = distanceField(maj);
log('busy-road raster done');

// ---------- landfills ----------
// Delhi's three legacy dumpsites (approximate centres; each covers 20–30 ha). Fires and
// methane smoke are common, so they count as strong local sources.
const LANDFILLS: { name: string; lon: number; lat: number }[] = [
  { name: 'Ghazipur landfill', lon: 77.3268, lat: 28.6237 },
  { name: 'Bhalswa landfill', lon: 77.1615, lat: 28.7400 },
  { name: 'Okhla landfill', lon: 77.2845, lat: 28.5140 },
];

// ---------- names for industrial areas ----------
const search = JSON.parse(readFileSync(`${outDir}/search.json`, 'utf8')) as [string, number, number, string][];
const named: { name: string; lon: number; lat: number }[] = [];
const seen = new Set<string>();
for (const [name, lon, lat, type] of search) {
  if (!['locality', 'neighbourhood', 'suburb'].includes(type) || name.includes(',')) continue;
  if (!/industrial|udyog vihar|okhla phase/i.test(name)) continue;
  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (seen.has(key)) continue;
  seen.add(key);
  named.push({ name: name.replace(/\s+-\s+/g, ' '), lon, lat });
}
const areas = [...LANDFILLS.map((l) => l.name), ...named.map((n) => n.name)];
log('named areas', areas.length);

// ---------- per edge ----------
const M = g.m;
const A: AirArrays = {
  indM: new Uint8Array(M), majM: new Uint8Array(M), dumpM: new Uint8Array(M), area: new Int16Array(M),
};
const sample = (d: Float32Array, lon: number, lat: number) => d[cy(lat) * NX + cx(lon)];
let nearInd = 0, labelled = 0;
for (let e = 0; e < M; e++) {
  const pts = g.polyline(e);
  // the closest of the two ends and the middle: an edge touching an estate counts
  let di = 1e9, dm = 1e9;
  for (const [lon, lat] of [pts[0], g.pointAt(e, 0.5), pts[pts.length - 1]]) {
    di = Math.min(di, sample(indD, lon, lat));
    dm = Math.min(dm, sample(majD, lon, lat));
  }
  if (MAJOR.has(ROAD_CLASSES[g.a.edgeClass[e]])) dm = 0;
  const [mx, my] = g.pointAt(e, 0.5);
  let dd = 1e9, dumpIdx = -1;
  LANDFILLS.forEach((l, i) => { const d = g.proj.dist(mx, my, l.lon, l.lat); if (d < dd) { dd = d; dumpIdx = i; } });
  A.indM[e] = Math.min(255, Math.round(di / AIR_CAP.ind));
  A.majM[e] = Math.min(255, Math.round(dm / AIR_CAP.maj));
  A.dumpM[e] = Math.min(255, Math.round(dd / AIR_CAP.dump));
  let area = -1;
  if (dd < 1200) area = dumpIdx;
  else if (di <= 300) {
    nearInd++;
    let best = 2500;
    named.forEach((n, i) => { const d = g.proj.dist(mx, my, n.lon, n.lat); if (d < best) { best = d; area = LANDFILLS.length + i; } });
  }
  if (area >= 0) labelled++;
  A.area[e] = area;
}
log(`edges ${M}; within 300 m of industry ${nearInd}; with an area name ${labelled}`);

const out = encodeAir(A, { areas, cellM: CELL, source: 'OpenStreetMap landuse + road classes' });
writeFileSync(`${outDir}/air.bin`, out);
log('wrote', `${outDir}/air.bin`, (out.length / 1e6).toFixed(2), 'MB');
