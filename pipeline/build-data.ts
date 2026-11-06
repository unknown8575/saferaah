// Build SafeRaah runtime data from an OpenStreetMap-derived GeoJSON.
//
//   npx tsx pipeline/build-data.ts <input.geojson> <outDir>
//
// Outputs:
//   graph.bin   routing graph with static per-edge safety features
//   pois.json   safe-haven places with category + opening_hours
//   search.json offline search index (places, POIs, named streets)

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { LocalProjection, GridIndex, pointInPolygon, ringAreaM2, type LonLat } from '../shared/geo.ts';
import { encodeGraph, type GraphArrays } from '../shared/graph.ts';
import { RC, roadClassOf, F_FOOT, F_VEHICLE, F_ONEWAY, F_ONEWAY_KNOWN, type RoadClass } from '../shared/modes.ts';
import { poiCategory, type Poi } from '../shared/places.ts';

const [, , inPath, outDir] = process.argv;
if (!inPath || !outDir) {
  console.error('usage: tsx pipeline/build-data.ts <input.geojson> <outDir>');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

interface Feature {
  geometry: { type: string; coordinates: any };
  properties: { kind: string; name?: string; tags?: Record<string, string>; center?: LonLat; snapshot?: string; id?: string };
}
const fc = JSON.parse(readFileSync(inPath, 'utf8')) as { features: Feature[] };
log('features', fc.features.length);

// ---------- bbox / projection ----------
let minLon = 180, minLat = 90, maxLon = -180, maxLat = -90;
let snapshot = '';
for (const f of fc.features) {
  if (f.properties.kind !== 'road') continue;
  snapshot ||= f.properties.snapshot ?? '';
  const lines: LonLat[][] = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const l of lines) for (const [x, y] of l) {
    if (x < minLon) minLon = x; if (x > maxLon) maxLon = x;
    if (y < minLat) minLat = y; if (y > maxLat) maxLat = y;
  }
}
const proj = new LocalProjection((minLat + maxLat) / 2);

// ---------- POIs ----------
const pois: Poi[] = [];
for (const f of fc.features) {
  const t = f.properties.tags ?? {};
  const cat = poiCategory(t, f.properties.kind);
  if (!cat) continue;
  let lon: number, lat: number;
  if (f.geometry.type === 'Point') [lon, lat] = f.geometry.coordinates;
  else if (f.properties.center) [lon, lat] = f.properties.center;
  else continue;
  if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) continue;
  const name = (t['name:en'] || t.name || f.properties.name || '').trim();
  const p: Poi = { id: pois.length, lon: +lon.toFixed(6), lat: +lat.toFixed(6), cat, name };
  if (t.opening_hours) p.oh = t.opening_hours;
  pois.push(p);
}
log('pois', pois.length);

// ---------- roads -> nodes/edges ----------
const nodeIndex = new Map<string, number>();
const nLon: number[] = [], nLat: number[] = [];
function nodeOf(lon: number, lat: number): number {
  const k = `${Math.round(lon * 1e6)},${Math.round(lat * 1e6)}`;
  let i = nodeIndex.get(k);
  if (i === undefined) {
    i = nLon.length;
    nodeIndex.set(k, i);
    nLon.push(Math.round(lon * 1e6));
    nLat.push(Math.round(lat * 1e6));
  }
  return i;
}
const names: string[] = [];
const nameIdx = new Map<string, number>();
function nameOf(s: string): number {
  if (!s) return -1;
  let i = nameIdx.get(s);
  if (i === undefined) { i = names.length; names.push(s); nameIdx.set(s, i); }
  return i;
}

const VEHICLE: Set<RoadClass> = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary',
  'unclassified', 'residential', 'living_street', 'service', 'track']);
const NO = new Set(['no', 'private']);
const YES = new Set(['yes', 'designated', 'permissive', 'destination']);
let onewayKnown = false;

const eU: number[] = [], eV: number[] = [], eLen: number[] = [], eCls: number[] = [], eFlags: number[] = [], eName: number[] = [];
for (const f of fc.features) {
  if (f.properties.kind !== 'road') continue;
  const t = f.properties.tags ?? {};
  const cls = roadClassOf(t.highway);
  if (!cls) continue;
  if (t.area === 'yes') continue;
  let foot = cls !== 'motorway';
  if (NO.has(t.access ?? '') && !YES.has(t.foot ?? '')) foot = false;
  if (t.foot === 'no') foot = false;
  if (cls === 'cycleway' && t.foot !== 'yes' && t.foot !== 'designated') foot = true; // shared use in Delhi in practice
  let veh = VEHICLE.has(cls);
  if (NO.has(t.access ?? '') && !YES.has(t.motor_vehicle ?? '')) veh = false;
  if (t.motor_vehicle === 'no' || t.motorcar === 'no') veh = false;
  if (!foot && !veh) continue;
  let flags = (foot ? F_FOOT : 0) | (veh ? F_VEHICLE : 0);
  let reverse = false;
  if ('oneway' in t || 'junction' in t) onewayKnown = true;
  if (t.oneway === 'yes' || t.oneway === '1' || t.oneway === 'true' || t.junction === 'roundabout') flags |= F_ONEWAY;
  if (t.oneway === '-1') { flags |= F_ONEWAY; reverse = true; }
  const nm = nameOf((t['name:en'] || t.name || f.properties.name || '').trim());
  const lines: LonLat[][] = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      let a = nodeOf(line[i - 1][0], line[i - 1][1]);
      let b = nodeOf(line[i][0], line[i][1]);
      if (a === b) continue;
      if (reverse) [a, b] = [b, a];
      const len = proj.dist(line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]);
      eU.push(a); eV.push(b); eLen.push(len); eCls.push(RC[cls]); eFlags.push(flags); eName.push(nm);
    }
  }
}
if (onewayKnown) for (let i = 0; i < eFlags.length; i++) eFlags[i] |= F_ONEWAY_KNOWN;
log('raw nodes', nLon.length, 'raw edges', eU.length, 'onewayKnown', onewayKnown);

// ---------- keep largest connected component ----------
const N0 = nLon.length, M0 = eU.length;
const parent = new Int32Array(N0).map((_, i) => i);
const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
for (let e = 0; e < M0; e++) { const a = find(eU[e]), b = find(eV[e]); if (a !== b) parent[a] = b; }
const compSize = new Map<number, number>();
for (let i = 0; i < N0; i++) { const r = find(i); compSize.set(r, (compSize.get(r) ?? 0) + 1); }
let bestRoot = -1, bestSize = 0;
for (const [r, s] of compSize) if (s > bestSize) { bestRoot = r; bestSize = s; }
const remap = new Int32Array(N0).fill(-1);
let N = 0;
for (let i = 0; i < N0; i++) if (find(i) === bestRoot) remap[i] = N++;
const keepE: number[] = [];
for (let e = 0; e < M0; e++) if (remap[eU[e]] >= 0) keepE.push(e);
const M = keepE.length;
log('largest component nodes', N, 'edges', M, `(dropped ${N0 - N} nodes)`);

const A: GraphArrays = {
  nodeLon: new Int32Array(N), nodeLat: new Int32Array(N),
  edgeU: new Uint32Array(M), edgeV: new Uint32Array(M), edgeLen: new Float32Array(M),
  edgeClass: new Uint8Array(M), edgeFlags: new Uint8Array(M), edgeName: new Int32Array(M),
  edgePoliceM: new Uint16Array(M), edgeStationM: new Uint16Array(M),
  edgeBldg: new Uint8Array(M), edgeGreen: new Uint8Array(M),
  poiOff: new Uint32Array(M + 1), poiIdx: new Uint32Array(0),
};
for (let i = 0; i < N0; i++) if (remap[i] >= 0) { A.nodeLon[remap[i]] = nLon[i]; A.nodeLat[remap[i]] = nLat[i]; }
keepE.forEach((e, j) => {
  A.edgeU[j] = remap[eU[e]]; A.edgeV[j] = remap[eV[e]]; A.edgeLen[j] = eLen[e];
  A.edgeClass[j] = eCls[e]; A.edgeFlags[j] = eFlags[e]; A.edgeName[j] = eName[e];
});
const mid = (j: number): LonLat => [
  (A.nodeLon[A.edgeU[j]] + A.nodeLon[A.edgeV[j]]) / 2e6,
  (A.nodeLat[A.edgeU[j]] + A.nodeLat[A.edgeV[j]]) / 2e6,
];

// ---------- distance to nearest police / station ----------
function nearestDistField(points: { lon: number; lat: number }[], out: Uint16Array, maxM: number) {
  const g = new GridIndex(proj, 250);
  points.forEach((p, i) => g.insertPoint(i, p.lon, p.lat));
  for (let j = 0; j < M; j++) {
    const [x, y] = mid(j);
    let best = maxM;
    for (let r = 250; r <= maxM; r *= 2) {
      for (const i of g.near(x, y, r)) {
        const d = proj.dist(x, y, points[i].lon, points[i].lat);
        if (d < best) best = d;
      }
      if (best < r) break;
    }
    out[j] = Math.min(65535, Math.round(best));
  }
}
nearestDistField(pois.filter((p) => p.cat === 'police'), A.edgePoliceM, 4000);
nearestDistField(pois.filter((p) => p.cat === 'station'), A.edgeStationM, 4000);
log('police/station distances done');

// ---------- POIs within 50 m of each edge ----------
const poiGrid = new GridIndex(proj, 100);
pois.forEach((p) => poiGrid.insertPoint(p.id, p.lon, p.lat));
const poiLists: number[] = [];
for (let j = 0; j < M; j++) {
  A.poiOff[j] = poiLists.length;
  const [x, y] = mid(j);
  const u = A.edgeU[j], v = A.edgeV[j];
  const ax = A.nodeLon[u] / 1e6, ay = A.nodeLat[u] / 1e6, bx = A.nodeLon[v] / 1e6, by = A.nodeLat[v] / 1e6;
  for (const id of poiGrid.near(x, y, A.edgeLen[j] / 2 + 50)) {
    const p = pois[id];
    if (proj.pointSegDist(p.lon, p.lat, ax, ay, bx, by) <= 50) poiLists.push(id);
  }
}
A.poiOff[M] = poiLists.length;
A.poiIdx = Uint32Array.from(poiLists);
log('edge->poi links', poiLists.length);

// ---------- building density ----------
const bGrid = new GridIndex(proj, 60);
const bPts: LonLat[] = [];
for (const f of fc.features) {
  if (f.properties.kind !== 'building' || !f.properties.center) continue;
  bGrid.insertPoint(bPts.length, f.properties.center[0], f.properties.center[1]);
  bPts.push(f.properties.center);
}
for (let j = 0; j < M; j++) {
  const [x, y] = mid(j);
  let c = 0;
  for (const i of bGrid.near(x, y, 50)) if (proj.dist2(x, y, bPts[i][0], bPts[i][1]) <= 2500) c++;
  A.edgeBldg[j] = Math.min(255, c);
}
log('building density done', bPts.length, 'buildings');

// ---------- parks / green / industrial ----------
interface Area { rings: LonLat[][]; large: boolean; industrial: boolean }
const areas: Area[] = [];
const aGrid = new GridIndex(proj, 200);
for (const f of fc.features) {
  const t = f.properties.tags ?? {};
  const isGreen = f.properties.kind === 'green';
  const industrial = ['industrial', 'construction', 'brownfield', 'quarry'].includes(t.landuse ?? '');
  const cemetery = t.landuse === 'cemetery' || t.amenity === 'grave_yard';
  if (!isGreen && !industrial && !cemetery) continue;
  const polys: LonLat[][][] = f.geometry.type === 'Polygon' ? [f.geometry.coordinates]
    : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
  for (const rings of polys) {
    const area = ringAreaM2(proj, rings[0]);
    if (area < 2000) continue; // small lawns/roundabout greens aren't isolating
    const id = areas.length;
    areas.push({ rings, large: area > 20000, industrial: industrial || cemetery });
    let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
    for (const [x, y] of rings[0]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    aGrid.insertBBox(id, x0 - 0.0004, y0 - 0.0004, x1 + 0.0004, y1 + 0.0004);
  }
}
for (let j = 0; j < M; j++) {
  const [x, y] = mid(j);
  let bits = 0;
  for (const id of aGrid.near(x, y, 1)) {
    const a = areas[id];
    if (pointInPolygon(x, y, a.rings)) bits |= a.industrial ? 4 : 1;
    else if (a.large && !(bits & 2)) {
      // beside a large park: within 30 m of its boundary
      const ring = a.rings[0];
      for (let k = 1; k < ring.length; k++) {
        if (proj.pointSegDist(x, y, ring[k - 1][0], ring[k - 1][1], ring[k][0], ring[k][1]) < 30) { bits |= 2; break; }
      }
    }
  }
  A.edgeGreen[j] = bits;
}
log('green/industrial areas', areas.length);

// ---------- write ----------
const bbox: [number, number, number, number] = [minLon, minLat, maxLon, maxLat].map((v) => +v.toFixed(5)) as never;
const bin = encodeGraph(A, { bbox, snapshot, source: 'OpenStreetMap contributors (ODbL)', onewayKnown, names });
writeFileSync(join(outDir, 'graph.bin'), bin);
// same hash the server computes, so crowd reviews are tied to this exact graph build
const version = createHash('sha1').update(bin).digest('hex').slice(0, 12);
writeFileSync(join(outDir, 'version.json'), JSON.stringify({
  version, snapshot, bbox, builtAt: new Date().toISOString(),
  nodes: N, edges: M, pois: pois.length, source: 'OpenStreetMap contributors (ODbL)',
}));
writeFileSync(join(outDir, 'pois.json'), JSON.stringify(pois));

// search index: named places, named POIs, named streets (one entry per name+area)
type Entry = [string, number, number, string]; // name, lon, lat, type
const search: Entry[] = [];
const seen = new Set<string>();
const add = (name: string, lon: number, lat: number, type: string) => {
  const key = `${name.toLowerCase()}|${lon.toFixed(3)}|${lat.toFixed(3)}`;
  if (!name || seen.has(key)) return;
  seen.add(key);
  search.push([name, +lon.toFixed(5), +lat.toFixed(5), type]);
};
for (const f of fc.features) {
  if (f.properties.kind === 'place' || f.properties.kind === 'station') {
    const t = f.properties.tags ?? {};
    const nm = (t['name:en'] || t.name || f.properties.name || '').trim();
    const [lon, lat] = f.geometry.coordinates as LonLat;
    if (lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat)
      add(nm, lon, lat, f.properties.kind === 'station' ? 'station' : (poiCategory(t) ?? t.place ?? t.tourism ?? 'place'));
  }
}
for (const p of pois) add(p.name, p.lon, p.lat, p.cat);
const streetSeen = new Map<number, number>();
for (let j = 0; j < M; j++) {
  const k = A.edgeName[j];
  if (k < 0) continue;
  const [x, y] = mid(j);
  const cell = Math.round(x * 100) * 1000 + Math.round(y * 100); // ~1 km cells per name
  const key = k * 1e7 + cell;
  if (streetSeen.has(key)) continue;
  streetSeen.set(key, j);
  add(names[k], x, y, 'street');
}
writeFileSync(join(outDir, 'search.json'), JSON.stringify(search));
log(`wrote graph.bin ${(bin.length / 1e6).toFixed(1)} MB, pois ${pois.length}, search ${search.length}`);
