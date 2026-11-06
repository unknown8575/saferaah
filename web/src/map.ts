// MapLibre map on our own basemap: OpenMapTiles-schema vector tiles for Delhi, packed into
// one file per zoom-11 area and fetched only when that part of the city comes into view.
import * as maplibregl from 'maplibre-gl';
import type { Map as MLMap, StyleSpecification, GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre 6 loads its tile worker from a separate self-contained module
import mlWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { TIER_INFO, type Tier } from '../../shared/router.ts';
import { CAT_INFO, type Poi, type PoiCat } from '../../shared/places.ts';
import type { LonLat } from '../../shared/geo.ts';
import type { WorkerRoute } from './worker.ts';
import { icon } from './icons.ts';

maplibregl.setWorkerUrl(mlWorkerUrl);

interface Pack { tiles: Record<string, [number, number]>; data: Uint8Array }
const packs = new Map<string, Promise<Pack | null>>();
let packZoom = 11;
let available = new Set<string>();

function loadPack(base: string, key: string): Promise<Pack | null> {
  let p = packs.get(key);
  if (!p) {
    p = (async () => {
      if (!available.has(key)) return null;
      const r = await fetch(`${base}data/tiles/${key}.bin`);
      if (!r.ok) throw new Error(`map pack ${key}: ${r.status}`);
      const buf = new Uint8Array(await r.arrayBuffer());
      if (String.fromCharCode(...buf.subarray(0, 4)) !== 'SRT1') throw new Error('Bad map pack');
      const hlen = new DataView(buf.buffer, buf.byteOffset).getUint32(4, true);
      const head = JSON.parse(new TextDecoder().decode(buf.subarray(8, 8 + hlen)));
      return { tiles: head.tiles, data: buf.subarray(8 + hlen) };
    })();
    p.catch(() => packs.delete(key)); // let a failed download retry later
    packs.set(key, p);
  }
  return p;
}

export async function loadBasemap(base: string): Promise<{ bounds: [number, number, number, number] }> {
  const index = await (await fetch(base + 'data/tiles/index.json')).json();
  packZoom = index.packZoom ?? 11;
  available = new Set(index.packs);
  loadPack(base, 'low'); // small; covers the whole-city view
  maplibregl.addProtocol('srt', async (params: { url: string }) => {
    const [z, x, y] = params.url.replace('srt://', '').split('/').map(Number);
    const key = z < packZoom ? 'low' : `${packZoom}_${x >> (z - packZoom)}_${y >> (z - packZoom)}`;
    const pack = await loadPack(base, key);
    const e = pack?.tiles[`${z}/${x}/${y}`];
    if (!pack || !e) return { data: new ArrayBuffer(0) };
    return { data: pack.data.slice(e[0], e[0] + e[1]).buffer };
  });
  return { bounds: index.bounds };
}

type FeatureCollection = { type: 'FeatureCollection'; features: unknown[] };
export type Theme = 'day' | 'night';
const PAL = {
  // calm, Apple-Maps-like base so the safety colours are the only strong colour on screen
  day: { bg: '#f2f2ef', water: '#a9d1f2', green: '#cfe7c4', wood: '#c4e0b8', landuse: '#ecebe6', bldg: '#e5e4df', bldgLine: '#d8d6d0', rail: '#b9b8b3',
    major: '#ffffff', majorCase: '#d5d4cf', minor: '#ffffff', minorCase: '#e1e0db', path: '#c2c1bb', service: '#fbfbf9', label: '#3c3c43', halo: '#ffffff' },
  night: { bg: '#1c1c1e', water: '#1b2b40', green: '#1e2f22', wood: '#1b2a1f', landuse: '#222224', bldg: '#2a2a2d', bldgLine: '#333337', rail: '#48484c',
    major: '#5a5a60', majorCase: '#1c1c1e', minor: '#3d3d42', minorCase: '#1c1c1e', path: '#3a3a3f', service: '#38383d', label: '#d1d1d6', halo: '#1c1c1e' },
};
const NAME = ['coalesce', ['get', 'name:latin'], ['get', 'name_en'], ['get', 'name']];
const MAJOR = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'];

export function baseStyle(theme: Theme, base: string, bounds: [number, number, number, number]): StyleSpecification {
  const p = PAL[theme];
  const glyphBase = new URL('fonts/', new URL(base, location.href)).href;
  const width = (a: number, b: number, c: number) => ['interpolate', ['exponential', 1.6], ['zoom'], 10, a, 14, b, 18, c];
  return {
    version: 8,
    glyphs: glyphBase + '{fontstack}/{range}.pbf', // one bundled font stack, named "noto" (Noto Sans Regular)
    sources: {
      base: { type: 'vector', tiles: ['srt://{z}/{x}/{y}'], minzoom: 0, maxzoom: 14, bounds,
        attribution: '© <a href="https://openmaptiles.org/" target="_blank">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors' },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': p.bg } },
      { id: 'landuse', type: 'fill', source: 'base', 'source-layer': 'landuse',
        filter: ['in', ['get', 'class'], ['literal', ['industrial', 'cemetery', 'military', 'railway', 'hospital', 'school', 'university', 'college']]],
        paint: { 'fill-color': p.landuse } },
      { id: 'landcover', type: 'fill', source: 'base', 'source-layer': 'landcover',
        filter: ['in', ['get', 'class'], ['literal', ['wood', 'grass', 'farmland']]],
        paint: { 'fill-color': ['match', ['get', 'class'], 'wood', p.wood, p.green] } },
      { id: 'park', type: 'fill', source: 'base', 'source-layer': 'park', paint: { 'fill-color': p.green, 'fill-opacity': 0.8 } },
      { id: 'water', type: 'fill', source: 'base', 'source-layer': 'water', paint: { 'fill-color': p.water } },
      { id: 'waterway', type: 'line', source: 'base', 'source-layer': 'waterway', paint: { 'line-color': p.water, 'line-width': 1.2 } },
      { id: 'bldg', type: 'fill', source: 'base', 'source-layer': 'building', minzoom: 13,
        paint: { 'fill-color': p.bldg, 'fill-outline-color': p.bldgLine } },
      { id: 'rail', type: 'line', source: 'base', 'source-layer': 'transportation', filter: ['in', ['get', 'class'], ['literal', ['rail', 'transit']]],
        paint: { 'line-color': p.rail, 'line-width': 1.2, 'line-dasharray': [3, 2] } },
      { id: 'path', type: 'line', source: 'base', 'source-layer': 'transportation', minzoom: 14,
        filter: ['in', ['get', 'class'], ['literal', ['path', 'track']]],
        paint: { 'line-color': p.path, 'line-width': 1, 'line-dasharray': [2, 1.5] } },
      { id: 'minor-case', type: 'line', source: 'base', 'source-layer': 'transportation', minzoom: 12.5,
        filter: ['in', ['get', 'class'], ['literal', ['minor', 'service']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': p.minorCase, 'line-width': width(0.5, 3, 14) } },
      { id: 'minor', type: 'line', source: 'base', 'source-layer': 'transportation', minzoom: 12.5,
        filter: ['in', ['get', 'class'], ['literal', ['minor', 'service']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['match', ['get', 'class'], 'service', p.service, p.minor], 'line-width': width(0.3, 2, 11) } },
      { id: 'major-case', type: 'line', source: 'base', 'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', MAJOR]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': p.majorCase, 'line-width': width(1.2, 5, 18) } },
      { id: 'major', type: 'line', source: 'base', 'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', MAJOR]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': p.major, 'line-width': width(0.7, 3.5, 14), ...(theme === 'night' ? { 'line-blur': 0.6 } : {}) } },
      { id: 'road-label', type: 'symbol', source: 'base', 'source-layer': 'transportation_name', minzoom: 14,
        layout: { 'symbol-placement': 'line', 'text-field': NAME, 'text-font': ['noto'], 'text-size': 11.5, 'text-max-angle': 30 },
        paint: { 'text-color': p.label, 'text-halo-color': p.halo, 'text-halo-width': 1.6 } },
      { id: 'place-label', type: 'symbol', source: 'base', 'source-layer': 'place',
        filter: ['in', ['get', 'class'], ['literal', ['city', 'town', 'suburb', 'quarter', 'neighbourhood', 'village']]],
        layout: { 'text-field': NAME, 'text-font': ['noto'],
          'text-size': ['match', ['get', 'class'], 'city', 16, 'suburb', 13, 'town', 13, 11.5], 'text-max-width': 8, 'text-padding': 6 },
        paint: { 'text-color': p.label, 'text-halo-color': p.halo, 'text-halo-width': 1.8 } },
    ] as never,
  };
}

const TRAFFIC_KEY = (import.meta.env.VITE_TOMTOM_KEY as string | undefined) ?? '';
export const hasTraffic = () => !!TRAFFIC_KEY;

/** Street risk (0..1) to the same four colours the routes use. */
const RISK_COLOR = ['step', ['get', 'r'], TIER_INFO.green.color, 0.32, TIER_INFO.yellow.color, 0.46, TIER_INFO.red.color, 0.6, TIER_INFO.darkred.color];

function circlePolygon(lon: number, lat: number, radiusM: number, n = 48): LonLat[] {
  const out: LonLat[] = [];
  const dLat = radiusM / 111200, dLon = radiusM / (111200 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return out;
}

/** A point on route i that is far from the other routes, so its label doesn't sit on top of theirs. */
function calloutPoint(routes: { coords: LonLat[] }[], i: number): LonLat {
  const own = routes[i].coords;
  const step = Math.max(1, Math.floor(own.length / 60));
  const others: LonLat[] = [];
  routes.forEach((r, k) => { if (k !== i) for (let j = 0; j < r.coords.length; j += Math.max(1, Math.floor(r.coords.length / 120))) others.push(r.coords[j]); });
  let best = own[Math.floor(own.length / 2)], bestD = -1;
  const lo = Math.floor(own.length * 0.2), hi = Math.ceil(own.length * 0.8);
  for (let j = lo; j < hi; j += step) {
    const p = own[j];
    let d = Infinity;
    for (const q of others) { const dd = ((p[0] - q[0]) * 97.6) ** 2 + ((p[1] - q[1]) * 111.2) ** 2; if (dd < d) d = dd; }
    if (d > bestD + 1e-9) { bestD = d; best = p; }
  }
  return best;
}

/** Marker element: MapLibre owns the outer element's transform, so shapes that rotate go inside. */
function pinEl(cls: string, label: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'pin-wrap';
  el.setAttribute('aria-label', label);
  const inner = document.createElement('div');
  inner.className = `pin ${cls}`;
  el.appendChild(inner);
  return el;
}

export class SafeMap {
  map: MLMap;
  private markers: maplibregl.Marker[] = [];
  private callouts: maplibregl.Marker[] = [];
  private hitMarkers: maplibregl.Marker[] = [];
  private reportMarkers: maplibregl.Marker[] = [];
  private fromM?: maplibregl.Marker;
  private toM?: maplibregl.Marker;
  private placeM?: maplibregl.Marker;
  private meM?: maplibregl.Marker;
  private meEl?: HTMLElement;
  theme: Theme = 'day';
  ready: Promise<void>;
  private vis = { safety: true, traffic: false, pois: true };
  private safetyDim = false;
  private routeKey = '';
  private drawAnim = 0;

  constructor(el: HTMLElement, private base: string, private bounds: [number, number, number, number]) {
    this.map = new maplibregl.Map({
      container: el, style: baseStyle('day', base, bounds), center: [77.17, 28.63], zoom: 10.6,
      maxBounds: [[bounds[0] - 0.08, bounds[1] - 0.06], [bounds[2] + 0.08, bounds[3] + 0.06]],
      attributionControl: { compact: true }, pitchWithRotate: false, bearingSnap: 12, maxPitch: 50,
    });
    this.ready = new Promise((res) => this.map.once('load', () => { this.addOverlays(); res(); }));
  }

  private addOverlays() {
    const m = this.map;
    const empty = { type: 'FeatureCollection' as const, features: [] };
    if (TRAFFIC_KEY) {
      m.addSource('traffic', { type: 'raster', tileSize: 256,
        tiles: [`https://api.tomtom.com/traffic/map/4/tile/flow/relative0/{z}/{x}/{y}.png?key=${encodeURIComponent(TRAFFIC_KEY)}`],
        attribution: 'Traffic © TomTom' });
      m.addLayer({ id: 'traffic', type: 'raster', source: 'traffic', minzoom: 10, layout: { visibility: this.vis.traffic ? 'visible' : 'none' }, paint: { 'raster-opacity': 0.85 } });
    }
    m.addSource('safety', { type: 'geojson', data: empty });
    m.addLayer({ id: 'safety', type: 'line', source: 'safety', minzoom: 13.5,
      layout: { 'line-cap': 'round', 'line-join': 'round', visibility: this.vis.safety ? 'visible' : 'none' },
      paint: { 'line-color': RISK_COLOR as never, 'line-width': ['interpolate', ['linear'], ['zoom'], 13.5, 1, 16, 2.6, 18, 6],
        'line-opacity': this.safetyDim ? 0.25 : 0.55 } });
    m.addSource('acc', { type: 'geojson', data: empty });
    m.addLayer({ id: 'acc', type: 'fill', source: 'acc', paint: { 'fill-color': '#3d5afe', 'fill-opacity': 0.12 } });
    m.addLayer({ id: 'acc-line', type: 'line', source: 'acc', paint: { 'line-color': '#3d5afe', 'line-opacity': 0.35, 'line-width': 1 } });
    m.addSource('pois', { type: 'geojson', data: empty });
    m.addLayer({ id: 'pois', type: 'circle', source: 'pois',
      layout: { visibility: this.vis.pois ? 'visible' : 'none' },
      // the most important places first; shops and eateries only when zoomed right in
      filter: ['any', ['>=', ['zoom'], 17.2],
        ['all', ['>=', ['zoom'], 13], ['in', ['get', 'cat'], ['literal', ['police', 'hospital']]]],
        ['all', ['>=', ['zoom'], 15], ['in', ['get', 'cat'], ['literal', ['pharmacy', 'clinic', 'station', 'fuel', 'govt']]]]],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, ['match', ['get', 'cat'], ['police', 'hospital'], 3.5, 2], 17, 8],
        'circle-color': ['case', ['==', ['get', 'open'], 1], ['get', 'color'], this.theme === 'night' ? '#141433' : '#ffffff'],
        'circle-stroke-color': ['case', ['==', ['get', 'open'], 1], '#ffffff', '#8a89a8'],
        'circle-stroke-width': 1.4,
      } });
    m.addLayer({ id: 'poi-label', type: 'symbol', source: 'pois', minzoom: 16.2,
      filter: ['any', ['>=', ['zoom'], 17.5], ['in', ['get', 'cat'], ['literal', ['police', 'hospital', 'pharmacy', 'clinic', 'station', 'fuel', 'govt']]]],
      layout: { 'text-field': ['get', 'name'], 'text-font': ['noto'], 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-max-width': 9, 'text-optional': true,
        visibility: this.vis.pois ? 'visible' : 'none' },
      paint: { 'text-color': this.theme === 'night' ? '#c9c8ea' : '#3b3a5c', 'text-halo-color': this.theme === 'night' ? '#141433' : '#ffffff', 'text-halo-width': 1.5 } });
    m.addSource('routes', { type: 'geojson', data: empty });
    m.addLayer({ id: 'routes-casing', type: 'line', source: 'routes', layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['get', 'z'] },
      paint: { 'line-color': ['case', ['==', ['get', 'sel'], 1], '#ffffff', this.theme === 'night' ? '#2a2950' : '#ffffff'],
        'line-width': ['case', ['==', ['get', 'sel'], 1], 12, 8], 'line-opacity': ['case', ['==', ['get', 'sel'], 1], 1, 0.8] } });
    m.addLayer({ id: 'routes', type: 'line', source: 'routes', layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['get', 'z'] },
      paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['==', ['get', 'sel'], 1], 8, 5], 'line-opacity': ['case', ['==', ['get', 'sel'], 1], 1, 0.5] } });
    // a wide invisible line so routes are easy to tap with a finger
    m.addLayer({ id: 'routes-hit', type: 'line', source: 'routes', paint: { 'line-color': '#000', 'line-width': 26, 'line-opacity': 0.001 } });
    m.addSource('track', { type: 'geojson', data: empty });
    m.addLayer({ id: 'track', type: 'line', source: 'track', paint: { 'line-color': '#2E2A78', 'line-width': 3, 'line-dasharray': [1, 1.5] } });
  }

  /** Last data for each overlay, re-applied after a style (day/night) change. */
  private overlay: Record<string, FeatureCollection> = {};
  private setOverlay(id: 'pois' | 'routes' | 'track' | 'safety' | 'acc', data: FeatureCollection) {
    this.overlay[id] = data;
    this.ready.then(() => (this.map.getSource(id) as GeoJSONSource | undefined)?.setData(data as never));
  }

  setTheme(theme: Theme): Promise<void> {
    if (theme === this.theme) return this.ready;
    this.theme = theme;
    const prev = this.ready;
    this.ready = prev.then(async () => {
      const loaded = new Promise<void>((res) => this.map.once('style.load', () => res()));
      this.map.setStyle(baseStyle(theme, this.base, this.bounds), { diff: false });
      await loaded;
      this.addOverlays();
      for (const [id, data] of Object.entries(this.overlay)) (this.map.getSource(id) as GeoJSONSource).setData(data as never);
    });
    return this.ready;
  }

  setLayerVisible(id: 'safety' | 'traffic' | 'pois', on: boolean) {
    this.vis[id] = on;
    this.ready.then(() => {
      const ids = id === 'pois' ? ['pois', 'poi-label'] : [id];
      for (const l of ids) if (this.map.getLayer(l)) this.map.setLayoutProperty(l, 'visibility', on ? 'visible' : 'none');
    });
  }
  /** Fade the street-safety layer while routes are on screen, so the routes stand out. */
  dimSafety(dim: boolean) {
    if (this.safetyDim === dim) return;
    this.safetyDim = dim;
    this.ready.then(() => this.map.getLayer('safety') && this.map.setPaintProperty('safety', 'line-opacity', dim ? 0.25 : 0.55));
  }
  setSafety(fc: FeatureCollection) { this.setOverlay('safety', fc); }

  setPois(pois: Poi[], open?: Uint8Array) {
    const colorOf: Partial<Record<PoiCat, string>> = { police: '#2E2A78', hospital: '#C2185B', clinic: '#C2185B', pharmacy: '#00897B',
      station: '#5E35B1', fuel: '#6D4C41', govt: '#455A64', liquor: '#9E9E9E' };
    const feats = pois.filter((p) => CAT_INFO[p.cat].haven >= 0.4 || p.cat === 'liquor').map((p) => ({
      type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
      properties: { id: p.id, cat: p.cat, name: p.name, open: open ? open[p.id] : 1, color: colorOf[p.cat] ?? '#7E57C2' },
    }));
    this.setOverlay('pois', { type: 'FeatureCollection', features: feats });
  }

  onPoiClick(cb: (id: number) => void) {
    this.ready.then(() => {
      this.map.on('click', 'pois', (e) => { const f = e.features?.[0]; if (f) { (e as unknown as { handled?: boolean }).handled = true; cb(Number(f.properties.id)); } });
      this.map.on('mouseenter', 'pois', () => (this.map.getCanvas().style.cursor = 'pointer'));
      this.map.on('mouseleave', 'pois', () => (this.map.getCanvas().style.cursor = ''));
    });
  }

  showRoutes(routes: WorkerRoute[], selected: number, opts: { callouts?: boolean; onSelect?: (i: number) => void } = {}) {
    const build = (frac: number): FeatureCollection => ({ type: 'FeatureCollection', features: routes.map((r, i) => ({
      type: 'Feature' as const,
      geometry: { type: 'LineString' as const, coordinates: frac >= 1 ? r.coords : r.coords.slice(0, Math.max(2, Math.ceil(r.coords.length * frac))) },
      properties: { i, sel: i === selected ? 1 : 0, z: i === selected ? 10 : i, color: TIER_INFO[r.tier as Tier].color },
    })) });
    // new routes draw themselves from start to destination; changing the selection does not
    const key = routes.map((r) => `${r.coords.length}:${Math.round(r.timeS)}`).join('|');
    const animate = !!opts.callouts && key !== this.routeKey && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.routeKey = key;
    cancelAnimationFrame(this.drawAnim);
    if (animate) {
      const t0 = performance.now();
      const step = (t: number) => {
        const k = Math.min(1, (t - t0) / 800);
        this.setOverlay('routes', build(1 - Math.pow(1 - k, 3)));
        if (k < 1) this.drawAnim = requestAnimationFrame(step);
      };
      this.drawAnim = requestAnimationFrame(step);
    } else this.setOverlay('routes', build(1));
    this.clearMarkers();
    for (const c of this.callouts) c.remove();
    this.callouts = [];
    if (opts.callouts && routes.length) {
      routes.forEach((r, i) => {
        const el = document.createElement('button');
        el.className = `callout tier-${r.tier}${i === selected ? ' sel' : ''}${animate ? ' late' : ''}`;
        el.dataset.i = String(i);
        const ci = document.createElement('span');
        ci.className = 'ci';
        ci.appendChild(icon(r.tier === 'green' ? 'check' : 'alert', 11, 2.6));
        const b = document.createElement('b');
        b.textContent = fmtMin(r.timeS);
        el.append(ci, b);
        el.setAttribute('aria-label', `Route ${i + 1}: ${fmtMin(r.timeS)}, ${TIER_INFO[r.tier as Tier].label}`);
        el.addEventListener('click', (e) => { e.stopPropagation(); opts.onSelect?.(i); });
        const mk = new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -6] }).setLngLat(calloutPoint(routes, i)).addTo(this.map);
        if (i === selected) mk.getElement().style.zIndex = '3';
        this.callouts.push(mk);
      });
    }
    const r = routes[selected];
    if (r) for (const d of r.dangerSpots) {
      const el = document.createElement('button');
      el.className = 'danger-pin';
      el.setAttribute('aria-label', `Risky stretch, ${d.lengthM} metres: ${d.reasons.join(', ')}`);
      el.textContent = '!';
      const pop = new maplibregl.Popup({ offset: 14, closeButton: false })
        .setHTML(`<b>Risky stretch, ${d.lengthM} m${d.street ? ' on ' + escapeHtml(d.street) : ''}</b><br>${d.reasons.map(escapeHtml).join('<br>') || 'quiet at this hour'}`);
      this.markers.push(new maplibregl.Marker({ element: el }).setLngLat([d.lon, d.lat]).setPopup(pop).addTo(this.map));
    }
  }

  onRouteClick(cb: (i: number) => void) {
    this.ready.then(() => {
      this.map.on('click', 'routes-hit', (e) => { const f = e.features?.[0]; if (f) { (e as unknown as { handled?: boolean }).handled = true; cb(Number(f.properties.i)); } });
      this.map.on('mouseenter', 'routes-hit', () => (this.map.getCanvas().style.cursor = 'pointer'));
      this.map.on('mouseleave', 'routes-hit', () => (this.map.getCanvas().style.cursor = ''));
    });
  }

  clearRoutes() {
    cancelAnimationFrame(this.drawAnim);
    this.routeKey = '';
    this.setOverlay('routes', { type: 'FeatureCollection', features: [] });
    this.clearMarkers();
    for (const c of this.callouts) c.remove();
    this.callouts = [];
  }

  private clearMarkers() { for (const m of this.markers) m.remove(); this.markers = []; }

  setEndpoints(from?: LonLat, to?: LonLat) {
    const pin = (cls: string, label: string) => pinEl(cls, label);
    this.fromM?.remove(); this.toM?.remove();
    this.fromM = this.toM = undefined;
    if (from) this.fromM = new maplibregl.Marker({ element: pin('pin-from', 'Start') }).setLngLat(from).addTo(this.map);
    if (to) this.toM = new maplibregl.Marker({ element: pin('pin-to', 'Destination'), anchor: 'bottom' }).setLngLat(to).addTo(this.map);
  }

  /** The red pin for a place the user tapped or searched. */
  setPlacePin(p?: LonLat) {
    this.placeM?.remove(); this.placeM = undefined;
    if (!p) return;
    const el = pinEl('pin-to pin-drop', 'Selected place');
    this.placeM = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(p).addTo(this.map);
  }

  /** Results of a category search (police, hospitals…) as tappable pins. */
  setHits(hits: { lon: number; lat: number; icon: string; open: boolean; label: string }[], onClick?: (i: number) => void) {
    for (const m of this.hitMarkers) m.remove();
    this.hitMarkers = hits.map((x, i) => {
      const el = document.createElement('button');
      el.className = `hit-pin${x.open ? '' : ' closed'}`;
      el.appendChild(icon(x.icon, 16, 2));
      el.setAttribute('aria-label', x.label);
      el.addEventListener('click', (e) => { e.stopPropagation(); onClick?.(i); });
      return new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([x.lon, x.lat]).addTo(this.map);
    });
  }

  /** Live safety reports from other travellers. */
  setReports(list: { id: string; lon: number; lat: number; icon: string; label: string; danger: boolean }[], onClick: (id: string, el: HTMLElement) => void) {
    for (const m of this.reportMarkers) m.remove();
    this.reportMarkers = list.map((r) => {
      const el = document.createElement('button');
      el.className = `report-pin${r.danger ? '' : ' good'}`;
      el.appendChild(icon(r.icon, 16, 2.1));
      el.dataset.id = r.id;
      el.setAttribute('aria-label', `Live report: ${r.label}`);
      el.addEventListener('click', (e) => { e.stopPropagation(); onClick(r.id, el); });
      return new maplibregl.Marker({ element: el }).setLngLat([r.lon, r.lat]).addTo(this.map);
    });
  }

  popup(at: LonLat, content: HTMLElement): maplibregl.Popup {
    return new maplibregl.Popup({ offset: 18, maxWidth: '280px' }).setLngLat(at).setDOMContent(content).addTo(this.map);
  }

  /** Blue dot with accuracy circle and a heading cone (when we know which way you face). */
  setMe(p?: LonLat, accM = 0, heading: number | null = null, manual = false) {
    if (!p) {
      this.meM?.remove(); this.meM = undefined;
      this.setOverlay('acc', { type: 'FeatureCollection', features: [] });
      return;
    }
    if (!this.meM) {
      const el = document.createElement('div');
      el.className = 'me';
      el.innerHTML = '<div class="me-cone"></div><div class="me-dot"></div>';
      el.setAttribute('aria-label', 'You are here');
      this.meEl = el;
      this.meM = new maplibregl.Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'viewport' }).setLngLat(p).addTo(this.map);
    } else this.meM.setLngLat(p);
    this.meEl!.classList.toggle('manual', manual);
    this.meEl!.classList.toggle('has-heading', heading != null);
    if (heading != null) this.meM.setRotation(heading);
    this.setOverlay('acc', { type: 'FeatureCollection', features: accM > 15
      ? [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [circlePolygon(p[0], p[1], Math.min(accM, 2000))] }, properties: {} }] : [] });
  }

  setTrack(coords: LonLat[]) {
    this.setOverlay('track', {
      type: 'FeatureCollection', features: coords.length > 1 ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} }] : [] });
  }

  fit(coords: LonLat[], pad: maplibregl.PaddingOptions) {
    if (!coords.length) return;
    const b = new maplibregl.LngLatBounds(coords[0], coords[0]);
    for (const c of coords) b.extend(c);
    this.map.fitBounds(b, { padding: pad, maxZoom: 16.5, duration: 600, bearing: 0, pitch: 0 });
  }
}

const fmtMin = (s: number) => { const m = Math.max(1, Math.round(s / 60)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60 ? (m % 60) + ' m' : ''}`.trim(); };

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
