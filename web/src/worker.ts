// Runs the graph, risk model and router off the main thread.
import { Graph } from '../../shared/graph.ts';
import { Router, tierOf, type RouteResult } from '../../shared/router.ts';
import { computeRisk, type CrowdStat, type Profile, type RiskField } from '../../shared/risk.ts';
import { isOpenAt, CAT_INFO, type Poi } from '../../shared/places.ts';
import { buildSteps, type Step } from '../../shared/steps.ts';
import { adviseTrip, type Advice } from '../../shared/advice.ts';
import { MODES, type Mode } from '../../shared/modes.ts';
import { routePrecautions, type Precautions } from '../../shared/precautions.ts';
import { liveEdgeDeltas, type LiveReport } from '../../shared/live.ts';
import type { LonLat } from '../../shared/geo.ts';

let g: Graph, router: Router, pois: Poi[] = [];
const crowd = new Map<number, CrowdStat>();
let live = new Map<number, number>();
let liveVersion = 0;
let riskCache: { key: string; field: RiskField } | null = null;

export type WorkerRoute = Omit<RouteResult, 'edges'> & {
  edges: number[];
  steps: Step[];
  segTier: RouteResult['tier'][];
  havenList: { id: number; name: string; cat: Poi['cat']; lon: number; lat: number; verified: boolean }[];
  precautions: Precautions;
};
export interface RouteReply {
  routes: WorkerRoute[];
  rankedCount: number;
  note?: string;
  error?: string;
  advice: Advice | null;
  computeMs: number;
  snapped: { from: LonLat; to: LonLat };
}

function riskFor(whenISO: string, profile: Profile): RiskField {
  // cache per 5-minute bucket so changing mode doesn't recompute
  const when = new Date(whenISO);
  const key = `${Math.floor(when.getTime() / 300000)}|${profile}|${crowd.size}|${liveVersion}`;
  if (riskCache?.key === key) return riskCache.field;
  const field = computeRisk(g, { when, profile, pois, crowd, live });
  riskCache = { key, field };
  return field;
}

function routeOnce(from: LonLat, to: LonLat, mode: Mode, whenISO: string, profile: Profile) {
  const when = new Date(whenISO);
  const risk = riskFor(whenISO, profile);
  return router.route({ from, to, mode, when, ctx: { when, profile, pois, crowd, live } }, risk);
}

self.onmessage = async (ev: MessageEvent) => {
  const m = ev.data;
  try {
    if (m.type === 'init') {
      const [gb, pj] = await Promise.all([
        // the graph may be split into parts for hosts that limit file size
        Promise.all(((m.graphParts as string[] | undefined) ?? ['graph.bin']).map((p) =>
          fetch(m.base + 'data/' + p).then((r) => { if (!r.ok) throw new Error(p + ' ' + r.status); return r.arrayBuffer(); })))
          .then((parts) => {
            if (parts.length === 1) return parts[0];
            const out = new Uint8Array(parts.reduce((a, b) => a + b.byteLength, 0));
            let o = 0;
            for (const b of parts) { out.set(new Uint8Array(b), o); o += b.byteLength; }
            return out.buffer;
          }),
        fetch(m.base + 'data/pois.json').then((r) => r.json()),
      ]);
      g = new Graph(gb);
      pois = pj;
      router = new Router(g);
      postMessage({ type: 'ready', id: m.id, meta: { bbox: g.meta.bbox, snapshot: g.meta.snapshot, onewayKnown: g.meta.onewayKnown, nodes: g.n, edges: g.m } });
      return;
    }
    if (m.type === 'crowd') {
      crowd.clear();
      for (const [e, n, mean] of m.stats as [number, number, number][]) crowd.set(e, { n, mean });
      riskCache = null;
      postMessage({ type: 'ok', id: m.id });
      return;
    }
    if (m.type === 'route') {
      const res = routeOnce(m.from, m.to, m.mode, m.when, m.profile);
      let vehicleAlt: { mode: Mode; timeS: number; tier: RouteResult['tier'] } | undefined;
      if (m.mode === 'walk' && res.routes.length) {
        const alt = routeOnce(m.from, m.to, 'auto', m.when, m.profile);
        const best = alt.routes.reduce<RouteResult | null>((a, b) => (!a || b.meanRisk < a.meanRisk ? b : a), null);
        if (best) vehicleAlt = { mode: 'auto', timeS: best.timeS, tier: best.tier };
      }
      const risk = riskFor(m.when, m.profile);
      const routes: WorkerRoute[] = res.routes.map((r) => ({
        ...r,
        steps: buildSteps(g, r.segEdge, r.coords),
        segTier: r.segEdge.map((e) => tierOf(risk.risk[e], risk.risk[e])),
        havenList: r.havenIds
          .map((id) => pois[id])
          .filter((p) => CAT_INFO[p.cat].haven >= 0.5)
          .sort((a, b) => CAT_INFO[b.cat].haven - CAT_INFO[a.cat].haven)
          .slice(0, 40)
          .map((p) => ({ id: p.id, name: p.name, cat: p.cat, lon: p.lon, lat: p.lat, verified: !!risk.poiVerified[p.id] })),
        precautions: routePrecautions(r, { mode: m.mode, profile: m.profile, when: new Date(m.when), pois }),
      }));
      const reply: RouteReply = {
        routes, rankedCount: res.rankedCount ?? routes.length, note: res.note, error: res.error, computeMs: res.computeMs,
        advice: adviseTrip({ mode: m.mode, profile: m.profile, when: new Date(m.when), routes: res.routes, vehicleAltS: vehicleAlt }),
        snapped: { from: res.from ? [res.from.lon, res.from.lat] : m.from, to: res.to ? [res.to.lon, res.to.lat] : m.to },
      };
      postMessage({ type: 'routes', id: m.id, reply });
      return;
    }
    if (m.type === 'reports') {
      // live safety reports from other travellers change street risk until they expire
      live = liveEdgeDeltas(g, m.reports as LiveReport[], m.now ?? Date.now());
      liveVersion++;
      riskCache = null;
      postMessage({ type: 'ok', id: m.id, affected: live.size });
      return;
    }
    if (m.type === 'modeTimes') {
      const when = new Date(m.when);
      const times: Partial<Record<Mode, number | null>> = {};
      for (const md of MODES) times[md] = router.fastestTime(m.from, m.to, md, when, m.profile);
      postMessage({ type: 'modeTimes', id: m.id, times });
      return;
    }
    if (m.type === 'whereis') {
      // the street at a tapped point, for the place card
      const [lon, lat] = m.at as LonLat;
      const s = g.snap(lon, lat, () => true, 400);
      let street = s ? g.name(s.edge) : '';
      if (s && !street) for (const e of g.edgesNear(lon, lat, 90)) { street = g.name(e); if (street) break; }
      // how that street feels right now (for the place card)
      const risk = s && m.when ? riskFor(m.when, m.profile ?? 'woman').risk[s.edge] : null;
      postMessage({ type: 'whereis', id: m.id, street, distM: s ? Math.round(s.distM) : null, onMap: !!s,
        risk: risk == null ? null : Math.round(risk * 100) / 100 });
      return;
    }
    if (m.type === 'safetyLines') {
      // every street in view coloured by its risk right now
      const [w, s, e, n] = m.bbox as number[];
      const risk = riskFor(m.when, m.profile);
      const edges = g.edgesInBox(w, s, e, n, m.limit ?? 6000);
      const feats = edges.map((ed) => ({
        type: 'Feature' as const,
        geometry: { type: 'LineString' as const, coordinates: g.polyline(ed).map(([x, y]) => [+x.toFixed(6), +y.toFixed(6)]) },
        properties: { r: Math.round(risk.risk[ed] * 100) / 100 },
      }));
      postMessage({ type: 'safetyLines', id: m.id, fc: { type: 'FeatureCollection', features: feats } });
      return;
    }
    if (m.type === 'open') {
      // open/closed state of every POI at a time (for the map layer)
      const when = new Date(m.when);
      const open = new Uint8Array(pois.length), verified = new Uint8Array(pois.length);
      pois.forEach((p, i) => { const s = isOpenAt(p, when); open[i] = s.open ? 1 : 0; verified[i] = s.verified ? 1 : 0; });
      postMessage({ type: 'open', id: m.id, open, verified }, { transfer: [open.buffer, verified.buffer] });
      return;
    }
    if (m.type === 'nearby') {
      const when = new Date(m.when);
      const [lon, lat] = m.at as LonLat;
      const out = [];
      for (const p of pois) {
        if (!m.cats.includes(p.cat)) continue;
        const d = g.proj.dist(lon, lat, p.lon, p.lat);
        if (d > m.radiusM) continue;
        const s = isOpenAt(p, when);
        out.push({ ...p, distM: Math.round(d), open: s.open, verified: s.verified });
      }
      if (m.sort === 'dist') out.sort((a, b) => a.distM - b.distM);
      else out.sort((a, b) => Number(b.open) - Number(a.open) || a.distM - b.distM);
      postMessage({ type: 'nearby', id: m.id, places: out.slice(0, m.limit ?? 40) });
      return;
    }
  } catch (err) {
    postMessage({ type: 'error', id: m.id, message: String((err as Error)?.message ?? err) });
  }
};
