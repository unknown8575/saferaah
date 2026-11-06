// Build SafeRaah runtime data from an OpenStreetMap-derived GeoJSON.
//
//   npx tsx pipeline/build-data.ts <input.geojson> <outDir> [area name]
//
// Input features carry properties.kind (road | poi | station | place | building | green |
// landuse | water …) and OSM tags. Two inputs are supported:
//   data/raw/delhi-nct.geojson     all of Delhi NCT (pipeline/pack_to_geojson.py)
//   data/raw/central-delhi.geojson the earlier central-Delhi extract
//
// Outputs:
//   graph.bin    routing graph (junction nodes + edge geometry) with static safety features
//   pois.json    safe-haven places with category + opening_hours
//   search.json  offline search index (places, stations, POIs, streets)
//   version.json build info

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { LocalProjection, GridIndex, pointInPolygon, ringAreaM2, type LonLat } from '../shared/geo.ts';
import { encodeGraph, type GraphArrays } from '../shared/graph.ts';
import { RC, roadClassOf, F_FOOT, F_VEHICLE, F_ONEWAY, F_ONEWAY_KNOWN, type RoadClass } from '../shared/modes.ts';
import { poiCategory, type Poi } from '../shared/places.ts';

const [, , inPath, outDir, areaName = 'Delhi'] = process.argv;
if (!inPath || !outDir) {
  console.error('usage: tsx pipeline/build-data.ts <input.geojson> <outDir> [area name]');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

interface Feature {
  geometry: { type: string; coordinates: any };
  properties: { kind: string; name?: string; tags?: Record<string, string>; center?: LonLat; snapshot?: string };
}
const fc = JSON.parse(readFileSync(inPath, 'utf8')) as { features: Feature[]; bbox?: number[]; snapshot?: string; source?: string };
log('features', fc.features.length);

const MAX_EDGE_M = 150; // long roads are cut so risk can change along them

// ---------- bbox / projection ----------
let minLon = 180, minLat = 90, maxLon = -180, maxLat = -90;
let snapshot = fc.snapshot ?? '';
for (const f of fc.features) {
  if (f.properties.kind !== 'road') continue;
  snapshot ||= f.properties.snapshot ?? '';
  const lines: LonLat[][] = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const l of lines) for (const [x, y] of l) {
    if (x < minLon) minLon = x; if (x > maxLon) maxLon = x;
    if (y < minLat) minLat = y; if (y > maxLat) maxLat = y;
  }
}
if (fc.bbox) [minLon, minLat, maxLon, maxLat] = [Math.max(minLon, fc.bbox[0]), Math.max(minLat, fc.bbox[1]), Math.min(maxLon, fc.bbox[2]), Math.min(maxLat, fc.bbox[3])];
const proj = new LocalProjection((minLat + maxLat) / 2);
const inBox = (lon: number, lat: number) => lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat;

// ---------- POIs and activity points ----------
const pois: Poi[] = [];
const activity: LonLat[] = []; // anything that brings people: buildings, shops, stops, schools, offices…
for (const f of fc.features) {
  const k = f.properties.kind;
  const t = f.properties.tags ?? {};
  let lon: number, lat: number;
  if (f.geometry.type === 'Point') [lon, lat] = f.geometry.coordinates;
  else if (f.properties.center) [lon, lat] = f.properties.center;
  else continue;
  if (!inBox(lon, lat)) continue;
  if (k === 'building' || k === 'poi' || k === 'station') activity.push([lon, lat]);
  if (k === 'building' || k === 'place') continue;
  const cat = poiCategory(t, k);
  if (!cat) continue;
  const name = (t['name:en'] || t.name || f.properties.name || '').trim();
  const p: Poi = { id: pois.length, lon: +lon.toFixed(6), lat: +lat.toFixed(6), cat, name };
  if (t.opening_hours) p.oh = t.opening_hours;
  pois.push(p);
}
log('pois', pois.length, 'activity points', activity.length);

// ---------- routable ways ----------
const VEHICLE: Set<RoadClass> = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary',
  'unclassified', 'residential', 'living_street', 'service', 'track']);
const NO = new Set(['no', 'private']);
const YES = new Set(['yes', 'designated', 'permissive', 'destination']);
let onewayKnown = false;
const names: string[] = [];
const nameIdx = new Map<string, number>();
const nameOf = (s: string) => {
  if (!s) return -1;
  let i = nameIdx.get(s);
  if (i === undefined) { i = names.length; names.push(s); nameIdx.set(s, i); }
  return i;
};
interface Way { pts: [number, number][]; cls: number; flags: number; name: number; footOnly: boolean }
const ways: Way[] = [];
const micro = (v: number) => Math.round(v * 1e6);
for (const f of fc.features) {
  if (f.properties.kind !== 'road') continue;
  const t = f.properties.tags ?? {};
  const cls = roadClassOf(t.highway);
  if (!cls || t.area === 'yes') continue;
  let foot = cls !== 'motorway';
  if (NO.has(t.access ?? '') && !YES.has(t.foot ?? '')) foot = false;
  if (t.foot === 'no') foot = false;
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
    const pts: [number, number][] = [];
    for (const [x, y] of line) {
      const p: [number, number] = [micro(x), micro(y)];
      const last = pts[pts.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) pts.push(p);
    }
    if (pts.length < 2) continue;
    if (reverse) pts.reverse();
    ways.push({ pts, cls: RC[cls], flags, name: nm, footOnly: foot && !veh });
  }
}
log('ways', ways.length, 'onewayKnown', onewayKnown);

// ---------- connect footpaths cut from map tiles ----------
// Tile-derived paths don't share exact vertices with roads. Snap each path vertex to a
// road/other vertex within 1.5 m, and dangling path ends to any vertex within 4 m.
const key = (p: [number, number]) => p[0] * 1e8 + p[1];
{
  const vGrid = new GridIndex(proj, 10);
  const vPts: [number, number][] = [];
  const vWay: number[] = [];
  ways.forEach((w, wi) => { for (const p of w.pts) { vGrid.insertPoint(vPts.length, p[0] / 1e6, p[1] / 1e6); vPts.push(p); vWay.push(wi); } });
  const nearest = (p: [number, number], wi: number, maxM: number, roadsOnly: boolean): [number, number] | null => {
    let best: [number, number] | null = null, bd = maxM;
    for (const i of vGrid.near(p[0] / 1e6, p[1] / 1e6, maxM)) {
      if (vWay[i] === wi || (roadsOnly && ways[vWay[i]].footOnly)) continue;
      const d = proj.dist(p[0] / 1e6, p[1] / 1e6, vPts[i][0] / 1e6, vPts[i][1] / 1e6);
      if (d < bd) { bd = d; best = vPts[i]; }
    }
    return best;
  };
  const use = new Map<number, number>();
  for (const w of ways) for (const p of w.pts) use.set(key(p), (use.get(key(p)) ?? 0) + 1);
  let snapped = 0, ends = 0;
  ways.forEach((w, wi) => {
    if (!w.footOnly) return;
    w.pts = w.pts.map((p, i) => {
      const end = i === 0 || i === w.pts.length - 1;
      if ((use.get(key(p)) ?? 0) > 1) return p;
      const q = nearest(p, wi, 1.5, true) ?? (end ? nearest(p, wi, 4, false) : null);
      if (q) { if (end) ends++; else snapped++; return [q[0], q[1]]; }
      return p;
    });
  });
  log('footpath vertices snapped', snapped, 'ends joined', ends);
}

// ---------- junctions and edges ----------
const usage = new Map<number, number>();
for (const w of ways) {
  w.pts.forEach((p, i) => {
    const k = key(p);
    usage.set(k, (usage.get(k) ?? 0) + (i === 0 || i === w.pts.length - 1 ? 2 : 1));
  });
}
const nodeId = new Map<number, number>();
const nLon: number[] = [], nLat: number[] = [];
const node = (p: [number, number]) => {
  const k = key(p);
  let i = nodeId.get(k);
  if (i === undefined) { i = nLon.length; nodeId.set(k, i); nLon.push(p[0]); nLat.push(p[1]); }
  return i;
};
interface RawEdge { u: number; v: number; shape: [number, number][]; len: number; cls: number; flags: number; name: number }
const raw: RawEdge[] = [];
const segLen = (a: [number, number], b: [number, number]) => proj.dist(a[0] / 1e6, a[1] / 1e6, b[0] / 1e6, b[1] / 1e6);
for (const w of ways) {
  let start = 0, len = 0;
  for (let i = 1; i < w.pts.length; i++) {
    len += segLen(w.pts[i - 1], w.pts[i]);
    const last = i === w.pts.length - 1;
    const junction = (usage.get(key(w.pts[i])) ?? 0) > 1;
    if (last || junction || len >= MAX_EDGE_M) {
      const u = node(w.pts[start]), v = node(w.pts[i]);
      if (u !== v || i - start > 1) {
        if (u !== v && len > 0.05) raw.push({ u, v, shape: w.pts.slice(start + 1, i), len, cls: w.cls, flags: w.flags, name: w.name });
      }
      start = i; len = 0;
    }
  }
}
log('raw nodes', nLon.length, 'raw edges', raw.length);

// ---------- keep the largest connected network ----------
const N0 = nLon.length;
const parent = new Int32Array(N0).map((_, i) => i);
const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
for (const e of raw) { const a = find(e.u), b = find(e.v); if (a !== b) parent[a] = b; }
const compSize = new Map<number, number>();
for (let i = 0; i < N0; i++) { const r = find(i); compSize.set(r, (compSize.get(r) ?? 0) + 1); }
let bestRoot = -1, bestSize = 0;
for (const [r, s] of compSize) if (s > bestSize) { bestRoot = r; bestSize = s; }
const remap = new Int32Array(N0).fill(-1);
let N = 0;
for (let i = 0; i < N0; i++) if (find(i) === bestRoot) remap[i] = N++;
const kept = raw.filter((e) => remap[e.u] >= 0);
const M = kept.length;
log('largest network nodes', N, 'edges', M, `(dropped ${N0 - N} nodes in ${compSize.size - 1} islands)`);

let shapeCount = 0;
for (const e of kept) shapeCount += e.shape.length;
const A: GraphArrays = {
  nodeLon: new Int32Array(N), nodeLat: new Int32Array(N),
  edgeU: new Uint32Array(M), edgeV: new Uint32Array(M), edgeLen: new Float32Array(M),
  edgeClass: new Uint8Array(M), edgeFlags: new Uint8Array(M), edgeName: new Int32Array(M),
  edgePoliceM: new Uint16Array(M), edgeStationM: new Uint16Array(M),
  edgeBldg: new Uint8Array(M), edgeGreen: new Uint8Array(M),
  poiOff: new Uint32Array(M + 1), poiIdx: new Uint32Array(0),
  shapeOff: new Uint32Array(M + 1), shapeLon: new Int32Array(shapeCount), shapeLat: new Int32Array(shapeCount),
};
for (let i = 0; i < N0; i++) if (remap[i] >= 0) { A.nodeLon[remap[i]] = nLon[i]; A.nodeLat[remap[i]] = nLat[i]; }
let so = 0;
kept.forEach((e, j) => {
  A.edgeU[j] = remap[e.u]; A.edgeV[j] = remap[e.v]; A.edgeLen[j] = e.len;
  A.edgeClass[j] = e.cls; A.edgeFlags[j] = e.flags | (onewayKnown ? F_ONEWAY_KNOWN : 0); A.edgeName[j] = e.name;
  A.shapeOff[j] = so;
  for (const p of e.shape) { A.shapeLon[so] = p[0]; A.shapeLat[so] = p[1]; so++; }
});
A.shapeOff[M] = so;

// geometry helpers on the final arrays
const poly = (j: number): LonLat[] => {
  const pts: LonLat[] = [[A.nodeLon[A.edgeU[j]] / 1e6, A.nodeLat[A.edgeU[j]] / 1e6]];
  for (let k = A.shapeOff[j]; k < A.shapeOff[j + 1]; k++) pts.push([A.shapeLon[k] / 1e6, A.shapeLat[k] / 1e6]);
  pts.push([A.nodeLon[A.edgeV[j]] / 1e6, A.nodeLat[A.edgeV[j]] / 1e6]);
  return pts;
};
const mid = (j: number): LonLat => {
  const pts = poly(j);
  let half = A.edgeLen[j] / 2;
  for (let i = 1; i < pts.length; i++) {
    const d = proj.dist(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
    if (half <= d || i === pts.length - 1) {
      const f = d > 0 ? Math.min(1, half / d) : 0;
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f];
    }
    half -= d;
  }
  return pts[0];
};
const distToPoly = (pts: LonLat[], x: number, y: number) => {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) best = Math.min(best, proj.pointSegDist(x, y, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
  return best;
};
const mids: LonLat[] = new Array(M);
for (let j = 0; j < M; j++) mids[j] = mid(j);

// ---------- distance to nearest police / station ----------
function nearestDistField(points: { lon: number; lat: number }[], out: Uint16Array, maxM: number) {
  const g = new GridIndex(proj, 250);
  points.forEach((p, i) => g.insertPoint(i, p.lon, p.lat));
  for (let j = 0; j < M; j++) {
    const [x, y] = mids[j];
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

// ---------- POIs and activity within 50 m of each edge ----------
const poiGrid = new GridIndex(proj, 100);
pois.forEach((p) => poiGrid.insertPoint(p.id, p.lon, p.lat));
const actGrid = new GridIndex(proj, 60);
activity.forEach((p, i) => actGrid.insertPoint(i, p[0], p[1]));
const poiLists: number[] = [];
for (let j = 0; j < M; j++) {
  A.poiOff[j] = poiLists.length;
  const [x, y] = mids[j];
  const pts = poly(j);
  const r = A.edgeLen[j] / 2 + 50;
  for (const id of poiGrid.near(x, y, r)) {
    const p = pois[id];
    if (distToPoly(pts, p.lon, p.lat) <= 50) poiLists.push(id);
  }
  let c = 0;
  for (const i of actGrid.near(x, y, r)) if (distToPoly(pts, activity[i][0], activity[i][1]) <= 50) c++;
  A.edgeBldg[j] = Math.min(255, c);
}
A.poiOff[M] = poiLists.length;
A.poiIdx = Uint32Array.from(poiLists);
log('edge->poi links', poiLists.length);

// ---------- parks / forest / industrial / cemetery ----------
interface Area { rings: LonLat[][]; large: boolean; industrial: boolean }
const areas: Area[] = [];
const aGrid = new GridIndex(proj, 200);
for (const f of fc.features) {
  const t = f.properties.tags ?? {};
  const isGreen = f.properties.kind === 'green';
  const industrial = ['industrial', 'construction', 'brownfield', 'quarry', 'cemetery', 'military'].includes(t.landuse ?? '') || t.amenity === 'grave_yard';
  if (!isGreen && !industrial) continue;
  const polys: LonLat[][][] = f.geometry.type === 'Polygon' ? [f.geometry.coordinates]
    : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
  for (const rings of polys) {
    if (!rings.length || rings[0].length < 4) continue;
    const area = ringAreaM2(proj, rings[0]);
    if (area < 2000) continue; // small lawns aren't isolating
    const id = areas.length;
    areas.push({ rings, large: area > 20000, industrial });
    let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
    for (const [x, y] of rings[0]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    aGrid.insertBBox(id, x0 - 0.0004, y0 - 0.0004, x1 + 0.0004, y1 + 0.0004);
  }
}
for (let j = 0; j < M; j++) {
  const [x, y] = mids[j];
  let bits = 0;
  for (const id of aGrid.near(x, y, 1)) {
    const a = areas[id];
    if (pointInPolygon(x, y, a.rings)) bits |= a.industrial ? 4 : 1;
    else if (a.large && !a.industrial && !(bits & 2)) {
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
const source = fc.source ?? 'OpenStreetMap contributors (ODbL)';
const bin = encodeGraph(A, { bbox, snapshot, source, onewayKnown, names, area: areaName });
writeFileSync(join(outDir, 'graph.bin'), bin);
writeFileSync(join(outDir, 'pois.json'), JSON.stringify(pois));
const version = createHash('sha1').update(bin).digest('hex').slice(0, 12);
writeFileSync(join(outDir, 'version.json'), JSON.stringify({
  version, snapshot, bbox, area: areaName, builtAt: new Date().toISOString(),
  nodes: N, edges: M, pois: pois.length, source,
}));

// search index: named places, stations, named POIs, named streets (one entry per name per ~1 km)
type Entry = [string, number, number, string]; // name, lon, lat, type
const search: Entry[] = [];
const seen = new Set<string>();
const add = (name: string, lon: number, lat: number, type: string) => {
  const k = `${name.toLowerCase()}|${lon.toFixed(3)}|${lat.toFixed(3)}`;
  if (!name || seen.has(k)) return;
  seen.add(k);
  search.push([name, +lon.toFixed(5), +lat.toFixed(5), type]);
};
for (const f of fc.features) {
  if (f.properties.kind === 'place' || f.properties.kind === 'station') {
    const t = f.properties.tags ?? {};
    const nm = (t['name:en'] || t.name || f.properties.name || '').trim();
    if (f.geometry.type !== 'Point') continue;
    const [lon, lat] = f.geometry.coordinates as LonLat;
    if (inBox(lon, lat))
      add(nm, lon, lat, f.properties.kind === 'station' ? 'station' : (poiCategory(t) ?? t.place ?? t.tourism ?? 'place'));
  }
}
for (const p of pois) add(p.name, p.lon, p.lat, p.cat);
// every other named place people search for: landmarks, markets, parks, colleges, malls, offices…
const searchType = (t: Record<string, string>): string => {
  if (t.tourism === 'attraction' || t.tourism === 'museum' || t.historic || t.tourism === 'viewpoint') return 'landmark';
  if (t.leisure === 'park' || t.leisure === 'garden') return 'park';
  if (t.amenity === 'marketplace' || t.shop === 'mall' || t.shop === 'department_store') return 'market';
  if (t.amenity === 'school' || t.amenity === 'college' || t.amenity === 'university' || t.amenity === 'kindergarten') return 'school';
  if (t.office || t.amenity === 'townhall') return 'office';
  return 'place';
};
for (const f of fc.features) {
  if (f.properties.kind !== 'poi' || f.geometry.type !== 'Point') continue;
  const t = f.properties.tags ?? {};
  if (poiCategory(t, 'poi')) continue; // already added as a safe place
  const nm = (t['name:en'] || t.name || f.properties.name || '').trim();
  const [lon, lat] = f.geometry.coordinates as LonLat;
  if (nm && inBox(lon, lat)) add(nm, lon, lat, searchType(t));
}
const streetSeen = new Set<number>();
for (let j = 0; j < M; j++) {
  const k = A.edgeName[j];
  if (k < 0) continue;
  const [x, y] = mids[j];
  const cell = Math.round(x * 100) * 1000 + Math.round(y * 100);
  const sk = k * 1e7 + cell;
  if (streetSeen.has(sk)) continue;
  streetSeen.add(sk);
  add(names[k], x, y, 'street');
}
writeFileSync(join(outDir, 'search.json'), JSON.stringify(search));
log(`wrote graph.bin ${(bin.length / 1e6).toFixed(1)} MB (${N} nodes, ${M} edges, ${shapeCount} shape points), pois ${pois.length}, search ${search.length}`);
