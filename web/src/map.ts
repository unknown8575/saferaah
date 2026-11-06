// MapLibre map on our own basemap (served from basemap.bin via a custom protocol).
import * as maplibregl from 'maplibre-gl';
import type { Map as MLMap, StyleSpecification, GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre 6 loads its tile worker from a separate self-contained module
import mlWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { TIER_INFO, type Tier } from '../../shared/router.ts';
import { CAT_INFO, type Poi, type PoiCat } from '../../shared/places.ts';
import type { LonLat } from '../../shared/geo.ts';
import type { WorkerRoute } from './worker.ts';

maplibregl.setWorkerUrl(mlWorkerUrl);

let tileIndex: Record<string, [number, number]> = {};
let tileData: Uint8Array | null = null;

export async function loadBasemap(base: string): Promise<{ bounds: [number, number, number, number] }> {
  const buf = new Uint8Array(await (await fetch(base + 'data/basemap.bin')).arrayBuffer());
  if (String.fromCharCode(...buf.subarray(0, 4)) !== 'SRT1') throw new Error('Bad basemap file');
  const hlen = new DataView(buf.buffer, buf.byteOffset).getUint32(4, true);
  const head = JSON.parse(new TextDecoder().decode(buf.subarray(8, 8 + hlen)));
  tileIndex = head.tiles;
  tileData = buf.subarray(8 + hlen);
  maplibregl.addProtocol('srt', async (params: { url: string }) => {
    const key = params.url.replace('srt://', '');
    const e = tileIndex[key];
    if (!e || !tileData) return { data: new ArrayBuffer(0) };
    return { data: tileData.slice(e[0], e[0] + e[1]).buffer };
  });
  return { bounds: head.bounds };
}

export type Theme = 'day' | 'night';
const PAL = {
  day: { bg: '#e9ebf1', water: '#b7cbe6', green: '#cfe3c8', bldg: '#d9dae2', bldgLine: '#cbccd6', rail: '#9a9cb0',
    major: '#ffffff', majorCase: '#b9bccb', minor: '#ffffff', minorCase: '#cfd1db', path: '#9ea2b6', service: '#f6f6f9', label: '#3b3a5c', halo: '#ffffff' },
  night: { bg: '#141433', water: '#1d2a52', green: '#152a25', bldg: '#1c1c40', bldgLine: '#242452', rail: '#3e3e6e',
    major: '#f5c76b', majorCase: '#6a5320', minor: '#5d5b84', minorCase: '#141433', path: '#3a3963', service: '#3c3b62', label: '#c9c8ea', halo: '#141433' },
};

export function baseStyle(theme: Theme, base: string, bounds: [number, number, number, number]): StyleSpecification {
  const p = PAL[theme];
  const glyphBase = new URL('fonts/', new URL(base, location.href)).href;
  return {
    version: 8,
    glyphs: glyphBase + '{fontstack}/{range}.pbf',
    sources: {
      base: { type: 'vector', tiles: ['srt://{z}/{x}/{y}'], minzoom: 11, maxzoom: 15, bounds,
        attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors' },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': p.bg } },
      { id: 'water', type: 'fill', source: 'base', 'source-layer': 'water', paint: { 'fill-color': p.water } },
      { id: 'green', type: 'fill', source: 'base', 'source-layer': 'green', paint: { 'fill-color': p.green } },
      { id: 'bldg', type: 'fill', source: 'base', 'source-layer': 'buildings', minzoom: 14,
        paint: { 'fill-color': p.bldg, 'fill-outline-color': p.bldgLine } },
      { id: 'rail', type: 'line', source: 'base', 'source-layer': 'rail', paint: { 'line-color': p.rail, 'line-width': 1.2, 'line-dasharray': [3, 2] } },
      { id: 'path', type: 'line', source: 'base', 'source-layer': 'roads', minzoom: 14, filter: ['==', ['get', 'cls'], 'path'],
        paint: { 'line-color': p.path, 'line-width': 1, 'line-dasharray': [2, 1.5] } },
      { id: 'minor-case', type: 'line', source: 'base', 'source-layer': 'roads', filter: ['in', ['get', 'cls'], ['literal', ['minor', 'service']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': p.minorCase, 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 1.5, 16, 7, 18, 14] } },
      { id: 'minor', type: 'line', source: 'base', 'source-layer': 'roads', filter: ['in', ['get', 'cls'], ['literal', ['minor', 'service']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['match', ['get', 'cls'], 'service', p.service, p.minor], 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.6, 16, 5, 18, 11] } },
      ...(['roads_major', 'roads'] as const).flatMap((src) => [
        { id: `major-case-${src}`, type: 'line' as const, source: 'base', 'source-layer': src,
          filter: ['in', ['get', 'cls'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary']]] as never,
          layout: { 'line-cap': 'round' as const, 'line-join': 'round' as const },
          paint: { 'line-color': p.majorCase, 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.5, 14, 5, 17, 14] as never } },
        { id: `major-${src}`, type: 'line' as const, source: 'base', 'source-layer': src,
          filter: ['in', ['get', 'cls'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary']]] as never,
          layout: { 'line-cap': 'round' as const, 'line-join': 'round' as const },
          paint: { 'line-color': p.major, 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.8, 14, 3.5, 17, 11] as never,
            ...(theme === 'night' ? { 'line-blur': 0.6 } : {}) } },
      ]),
      { id: 'road-label', type: 'symbol', source: 'base', 'source-layer': 'roads', minzoom: 15,
        filter: ['!=', ['get', 'name'], ''],
        layout: { 'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 11.5, 'text-max-angle': 30 },
        paint: { 'text-color': p.label, 'text-halo-color': p.halo, 'text-halo-width': 1.6 } },
      { id: 'area-label', type: 'symbol', source: 'base', 'source-layer': 'labels',
        filter: ['<=', ['get', 'rank'], 3],
        layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'],
          'text-size': ['match', ['get', 'kind'], 'area', 13, 11.5], 'text-max-width': 8, 'text-padding': 6 },
        paint: { 'text-color': p.label, 'text-halo-color': p.halo, 'text-halo-width': 1.8 } },
    ] as never,
  };
}

export class SafeMap {
  map: MLMap;
  private markers: maplibregl.Marker[] = [];
  private fromM?: maplibregl.Marker;
  private toM?: maplibregl.Marker;
  private meM?: maplibregl.Marker;
  theme: Theme = 'day';
  ready: Promise<void>;

  constructor(el: HTMLElement, private base: string, private bounds: [number, number, number, number]) {
    this.map = new maplibregl.Map({
      container: el, style: baseStyle('day', base, bounds), center: [77.215, 28.6], zoom: 12.4,
      maxBounds: [[bounds[0] - 0.08, bounds[1] - 0.06], [bounds[2] + 0.08, bounds[3] + 0.06]],
      attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false,
    });
    this.map.touchZoomRotate.disableRotation();
    this.ready = new Promise((res) => this.map.once('load', () => { this.addOverlays(); res(); }));
  }

  private addOverlays() {
    const m = this.map;
    m.addSource('pois', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    m.addLayer({ id: 'pois', type: 'circle', source: 'pois',
      filter: ['any', ['>=', ['zoom'], 15], ['in', ['get', 'cat'], ['literal', ['police', 'hospital']]]],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, ['match', ['get', 'cat'], ['police', 'hospital'], 3.5, 2], 17, 7],
        'circle-color': ['case', ['==', ['get', 'open'], 1], ['get', 'color'], this.theme === 'night' ? '#141433' : '#ffffff'],
        'circle-stroke-color': ['case', ['==', ['get', 'open'], 1], '#ffffff', '#8a89a8'],
        'circle-stroke-width': 1.2,
      } });
    m.addSource('routes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    m.addLayer({ id: 'routes-casing', type: 'line', source: 'routes', layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['get', 'z'] },
      paint: { 'line-color': '#ffffff', 'line-width': ['case', ['==', ['get', 'sel'], 1], 11, 7], 'line-opacity': ['case', ['==', ['get', 'sel'], 1], 1, 0.7] } });
    m.addLayer({ id: 'routes', type: 'line', source: 'routes', layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['get', 'z'] },
      paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['==', ['get', 'sel'], 1], 7, 4], 'line-opacity': ['case', ['==', ['get', 'sel'], 1], 1, 0.55] } });
    m.addSource('track', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    m.addLayer({ id: 'track', type: 'line', source: 'track', paint: { 'line-color': '#2E2A78', 'line-width': 3, 'line-dasharray': [1, 1.5] } });
  }

  /** Last data for each overlay, re-applied after a style (day/night) change. */
  private overlay: Record<string, GeoJSON.FeatureCollection> = {};
  private setOverlay(id: 'pois' | 'routes' | 'track', data: GeoJSON.FeatureCollection) {
    this.overlay[id] = data;
    this.ready.then(() => (this.map.getSource(id) as GeoJSONSource | undefined)?.setData(data));
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
      for (const [id, data] of Object.entries(this.overlay)) (this.map.getSource(id) as GeoJSONSource).setData(data);
    });
    return this.ready;
  }

  setPois(pois: Poi[], open?: Uint8Array) {
    const colorOf: Partial<Record<PoiCat, string>> = { police: '#2E2A78', hospital: '#C2185B', clinic: '#C2185B', pharmacy: '#00897B',
      station: '#5E35B1', fuel: '#6D4C41', govt: '#455A64', liquor: '#9E9E9E' };
    const feats = pois.filter((p) => CAT_INFO[p.cat].haven >= 0.4 || p.cat === 'liquor').map((p) => ({
      type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
      properties: { id: p.id, cat: p.cat, name: p.name, open: open ? open[p.id] : 1, color: colorOf[p.cat] ?? '#7E57C2' },
    }));
    this.setOverlay('pois', { type: 'FeatureCollection', features: feats });
  }

  showRoutes(routes: WorkerRoute[], selected: number) {
    const feats = routes.map((r, i) => ({
      type: 'Feature' as const,
      geometry: { type: 'LineString' as const, coordinates: r.coords },
      properties: { i, sel: i === selected ? 1 : 0, z: i === selected ? 10 : i, color: TIER_INFO[r.tier as Tier].color },
    }));
    this.setOverlay('routes', { type: 'FeatureCollection', features: feats });
    this.clearMarkers();
    const r = routes[selected];
    if (r) for (const d of r.dangerSpots) {
      const el = document.createElement('button');
      el.className = 'danger-pin';
      el.setAttribute('aria-label', `Risky stretch, ${d.lengthM} metres: ${d.reasons.join(', ')}`);
      el.textContent = '!';
      const pop = new maplibregl.Popup({ offset: 14, closeButton: false })
        .setHTML(`<b>Risky stretch, ${d.lengthM} m</b><br>${d.reasons.map(escapeHtml).join('<br>') || 'quiet at this hour'}`);
      this.markers.push(new maplibregl.Marker({ element: el }).setLngLat([d.lon, d.lat]).setPopup(pop).addTo(this.map));
    }
  }

  onRouteClick(cb: (i: number) => void) {
    this.ready.then(() => {
      this.map.on('click', 'routes', (e) => { const f = e.features?.[0]; if (f) cb(Number(f.properties.i)); });
      this.map.on('mouseenter', 'routes', () => (this.map.getCanvas().style.cursor = 'pointer'));
      this.map.on('mouseleave', 'routes', () => (this.map.getCanvas().style.cursor = ''));
    });
  }

  clearRoutes() {
    this.setOverlay('routes', { type: 'FeatureCollection', features: [] });
    this.clearMarkers();
  }

  private clearMarkers() { for (const m of this.markers) m.remove(); this.markers = []; }

  setEndpoints(from?: LonLat, to?: LonLat) {
    const pin = (cls: string, label: string) => { const el = document.createElement('div'); el.className = `pin ${cls}`; el.setAttribute('aria-label', label); return el; };
    this.fromM?.remove(); this.toM?.remove();
    if (from) this.fromM = new maplibregl.Marker({ element: pin('pin-from', 'Start') }).setLngLat(from).addTo(this.map);
    if (to) this.toM = new maplibregl.Marker({ element: pin('pin-to', 'Destination'), anchor: 'bottom' }).setLngLat(to).addTo(this.map);
  }

  setMe(p?: LonLat) {
    if (!p) { this.meM?.remove(); this.meM = undefined; return; }
    if (!this.meM) {
      const el = document.createElement('div'); el.className = 'me-dot'; el.setAttribute('aria-label', 'You are here');
      this.meM = new maplibregl.Marker({ element: el }).setLngLat(p).addTo(this.map);
    } else this.meM.setLngLat(p);
  }

  setTrack(coords: LonLat[]) {
    this.setOverlay('track', {
      type: 'FeatureCollection', features: coords.length > 1 ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} }] : [] });
  }

  fit(coords: LonLat[], pad: maplibregl.PaddingOptions) {
    if (!coords.length) return;
    const b = new maplibregl.LngLatBounds(coords[0], coords[0]);
    for (const c of coords) b.extend(c);
    this.map.fitBounds(b, { padding: pad, maxZoom: 16.5, duration: 600 });
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
