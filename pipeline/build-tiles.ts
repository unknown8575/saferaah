// Cut our own vector-tile basemap from the OSM GeoJSON into ONE file.
//
//   npx tsx pipeline/build-tiles.ts <input.geojson> <outDir>
//
// Output: basemap.bin  =  "SRT1" | u32 headerLen | header JSON | tile bytes...
// header.tiles["z/x/y"] = [offset, length]  (offsets relative to the data start)
// The app registers a MapLibre custom protocol that serves tiles from this blob,
// so the map works offline and needs no third-party tile server.

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';

const [, , inPath, outDir] = process.argv;
mkdirSync(outDir, { recursive: true });
const fc = JSON.parse(readFileSync(inPath, 'utf8'));

const MAJOR = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);
type F = { type: 'Feature'; geometry: any; properties: Record<string, unknown> };
const layers: Record<string, { feats: F[]; minzoom: number }> = {
  water: { feats: [], minzoom: 11 },
  green: { feats: [], minzoom: 11 },
  rail: { feats: [], minzoom: 12 },
  roads_major: { feats: [], minzoom: 11 },
  roads: { feats: [], minzoom: 13 },
  buildings: { feats: [], minzoom: 14 },
  labels: { feats: [], minzoom: 12 },
};

for (const f of fc.features) {
  const p = f.properties, t = p.tags ?? {};
  const name = String(t['name:en'] || t.name || p.name || '');
  switch (p.kind) {
    case 'water': layers.water.feats.push({ type: 'Feature', geometry: f.geometry, properties: {} }); break;
    case 'green': layers.green.feats.push({ type: 'Feature', geometry: f.geometry, properties: { name } }); break;
    case 'rail': layers.rail.feats.push({ type: 'Feature', geometry: f.geometry, properties: { metro: t.railway === 'subway' || t.railway === 'light_rail' ? 1 : 0 } }); break;
    case 'building': case 'buildingpart':
      if (p.kind === 'building') layers.buildings.feats.push({ type: 'Feature', geometry: f.geometry, properties: {} });
      break;
    case 'road': {
      const hw = String(t.highway ?? '').replace(/_link$/, '');
      const cls = MAJOR.has(hw) ? hw : ['footway', 'path', 'steps', 'pedestrian', 'track', 'cycleway', 'corridor'].includes(hw) ? 'path'
        : hw === 'service' ? 'service' : 'minor';
      const feat: F = { type: 'Feature', geometry: f.geometry, properties: { cls, name } };
      if (MAJOR.has(hw)) layers.roads_major.feats.push(feat);
      layers.roads.feats.push(feat);
      break;
    }
    case 'place': case 'station': {
      if (!name || f.geometry.type !== 'Point') break;
      const kind = p.kind === 'station' ? 'station' : (t.place ? 'area' : t.tourism ? 'landmark' : 'poi');
      if (kind === 'poi') break; // POIs are drawn live (open/closed) by the app
      const rank = kind === 'area' ? (t.place === 'suburb' ? 1 : t.place === 'neighbourhood' ? 2 : 3) : kind === 'station' ? 2 : 3;
      layers.labels.feats.push({ type: 'Feature', geometry: f.geometry, properties: { name, kind, rank } });
      break;
    }
  }
}

const MINZ = 11, MAXZ = 15;
// geojson-vt v5 exports a class
const GeoJSONVT = geojsonvt as unknown as new (data: unknown, o: unknown) => { getTile(z: number, x: number, y: number): { features: unknown[] } | null };
const indexes: Record<string, InstanceType<typeof GeoJSONVT>> = {};
for (const [k, l] of Object.entries(layers)) {
  indexes[k] = new GeoJSONVT({ type: 'FeatureCollection', features: l.feats },
    { maxZoom: MAXZ, indexMaxZoom: 5, tolerance: 3, extent: 4096, buffer: 64 });
  console.log(k, l.feats.length);
}

const [minLon, minLat, maxLon, maxLat] = [77.17, 28.515, 77.285, 28.68];
const lon2x = (lon: number, z: number) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2y = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

const tiles: Record<string, [number, number]> = {};
const chunks: Buffer[] = [];
let off = 0, count = 0;
for (let z = MINZ; z <= MAXZ; z++) {
  for (let x = lon2x(minLon, z); x <= lon2x(maxLon, z); x++) {
    for (let y = lat2y(maxLat, z); y <= lat2y(minLat, z); y++) {
      const layerTiles: Record<string, unknown> = {};
      for (const [k, l] of Object.entries(layers)) {
        if (z < l.minzoom) continue;
        if (k === 'roads_major' && z >= 13) continue; // full roads layer takes over
        const t = indexes[k].getTile(z, x, y);
        if (t && t.features.length) layerTiles[k] = t;
      }
      if (!Object.keys(layerTiles).length) continue;
      const buf = Buffer.from(vtpbf.fromGeojsonVt(layerTiles as never, { version: 2 }));
      tiles[`${z}/${x}/${y}`] = [off, buf.length];
      chunks.push(buf);
      off += buf.length;
      count++;
    }
  }
}
const header = Buffer.from(JSON.stringify({ minzoom: MINZ, maxzoom: MAXZ, bounds: [minLon, minLat, maxLon, maxLat], tiles }));
const pre = Buffer.alloc(8);
pre.write('SRT1', 0, 'ascii');
pre.writeUInt32LE(header.length, 4);
writeFileSync(join(outDir, 'basemap.bin'), Buffer.concat([pre, header, ...chunks]));
console.log(`basemap.bin: ${count} tiles, ${(off / 1e6).toFixed(1)} MB`);

// Latin font glyphs for labels (Noto Sans, OFL) — served locally, works offline
const require = createRequire(import.meta.url);
const glyphDir = join(dirname(require.resolve('smp-noto-glyphs/package.json')), 'fixtures/glyphs');
const fontOut = join(outDir, '..', 'fonts', 'noto'); // one font, so no {fontstack} folder (no spaces in URLs)
mkdirSync(fontOut, { recursive: true });
for (const f of readdirSync(glyphDir)) {
  const range = f.replace('.pbf.gz', '');
  if (!['0-255', '256-511', '8192-8447'].includes(range)) continue;
  writeFileSync(join(fontOut, `${range}.pbf`), gunzipSync(readFileSync(join(glyphDir, f))));
}
void copyFileSync;
