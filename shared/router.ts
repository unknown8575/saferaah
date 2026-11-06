// Safety-aware routing: parametric A* producing up to four tiered routes.
//
// Edge cost:  c_α(e) = T(e) · (1 + α · E_mode · R(e))
//   T(e)  travel time for the chosen mode at departure time
//   R(e)  time-dependent risk score (risk.ts)
//   E_mode how exposed this mode is to the street (walk 1.0 … car 0.4)
//   α     safety penalty: 0 = pure fastest, 5 = strongly safety-first
//
// A* uses straight-line distance / top speed as heuristic. Since c_α ≥ T,
// the heuristic stays admissible for every α, so each search is exact.

import { Graph } from './graph.ts';
import { MODE_INFO, ROAD_CLASSES, F_FOOT, F_VEHICLE, F_ONEWAY, edgeSeconds, WALK_KMH, type Mode } from './modes.ts';
import { computeRisk, type RiskContext, type RiskField } from './risk.ts';
import { CAT_INFO, type PoiCat } from './places.ts';
import { isPeakIST, darkness } from './time.ts';
import type { LonLat } from './geo.ts';

export const ALPHAS = [0, 0.5, 1.5, 5] as const;
/** A slower route must lower mean risk at least this much to be shown. */
export const MIN_RISK_GAIN = 0.02;
/** …and may take at most this multiple of the fastest time. */
export const MAX_DETOUR = 1.6;

export type Tier = 'darkred' | 'red' | 'yellow' | 'green';
export const TIER_INFO: Record<Tier, { color: string; label: string; short: string }> = {
  darkred: { color: '#8b0000', label: 'High risk', short: 'Avoid if you can' },
  red: { color: '#e03131', label: 'Unsafe', short: 'Risky stretches' },
  yellow: { color: '#f2a900', label: 'Take care', short: 'Medium risk' },
  green: { color: '#1f9d55', label: 'Low risk', short: 'Busy, open, watched' },
};
/** Absolute thresholds on the route's time-weighted mean risk. */
export function tierOf(meanRisk: number, worstStretch: number): Tier {
  const r = 0.7 * meanRisk + 0.3 * worstStretch;
  if (r >= 0.60) return 'darkred';
  if (r >= 0.46) return 'red';
  if (r >= 0.32) return 'yellow';
  return 'green';
}

export interface Snapped { edge: number; t: number; lon: number; lat: number; distM: number }

export interface DangerSpot { lon: number; lat: number; lengthM: number; reasons: string[]; street: string }

export interface RouteResult {
  alpha: number;
  edges: number[];
  coords: LonLat[];
  /** edge travelled between coords[i] and coords[i+1] */
  segEdge: number[];
  timeS: number;
  lengthM: number;
  meanRisk: number;
  /** worst ~200 m stretch risk */
  worstStretch: number;
  tier: Tier;
  /** open safe havens within 50 m of the route, by category */
  havens: Partial<Record<PoiCat, number>>;
  havenIds: number[];
  mainRoadShare: number;
  litShare: number;
  policeShare: number;
  dangerSpots: DangerSpot[];
  warnings: string[];
  labels: string[];
}

export interface RouteRequest {
  from: LonLat;
  to: LonLat;
  mode: Mode;
  when: Date;
  ctx: RiskContext;
}

export interface RouteResponse {
  routes: RouteResult[];
  /** routes[0..rankedCount) are the fastest→safest front; the rest are alternatives */
  rankedCount?: number;
  from: Snapped;
  to: Snapped;
  risk: RiskField;
  note?: string;
  error?: string;
  computeMs: number;
}

class MinHeap {
  ids: Int32Array; keys: Float64Array; size = 0;
  constructor(cap: number) { this.ids = new Int32Array(cap); this.keys = new Float64Array(cap); }
  push(id: number, k: number) {
    if (this.size === this.ids.length) {
      const ni = new Int32Array(this.ids.length * 2); ni.set(this.ids); this.ids = ni;
      const nk = new Float64Array(this.keys.length * 2); nk.set(this.keys); this.keys = nk;
    }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= k) break;
      this.ids[i] = this.ids[p]; this.keys[i] = this.keys[p]; i = p;
    }
    this.ids[i] = id; this.keys[i] = k;
  }
  pop(): number {
    const top = this.ids[0];
    const lastId = this.ids[--this.size], lastK = this.keys[this.size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.keys[c + 1] < this.keys[c]) c++;
      if (this.keys[c] >= lastK) break;
      this.ids[i] = this.ids[c]; this.keys[i] = this.keys[c]; i = c;
    }
    this.ids[i] = lastId; this.keys[i] = lastK;
    return top;
  }
}

export class Router {
  /** node is in the main connected network for walking / vehicles */
  private footComp: Uint8Array;
  private vehComp: Uint8Array;

  constructor(readonly g: Graph) {
    this.footComp = this.mainComponent(F_FOOT);
    this.vehComp = this.mainComponent(F_VEHICLE);
  }

  private mainComponent(flag: number): Uint8Array {
    const g = this.g;
    const comp = new Int32Array(g.n).fill(-1);
    let best = -1, bestSize = 0, cid = 0;
    const stack: number[] = [];
    for (let s = 0; s < g.n; s++) {
      if (comp[s] >= 0) continue;
      let size = 0;
      comp[s] = cid; stack.push(s);
      while (stack.length) {
        const u = stack.pop()!; size++;
        for (let k = g.adjOff[u]; k < g.adjOff[u + 1]; k++) {
          const e = g.adjEdge[k];
          if (!(g.a.edgeFlags[e] & flag)) continue;
          const v = g.other(e, u);
          if (comp[v] < 0) { comp[v] = cid; stack.push(v); }
        }
      }
      if (size > bestSize) { bestSize = size; best = cid; }
      cid++;
    }
    const out = new Uint8Array(g.n);
    for (let i = 0; i < g.n; i++) out[i] = comp[i] === best ? 1 : 0;
    return out;
  }

  usableFor(mode: Mode): (e: number) => boolean {
    const g = this.g;
    const flag = mode === 'walk' ? F_FOOT : F_VEHICLE;
    const comp = mode === 'walk' ? this.footComp : this.vehComp;
    return (e) => {
      if (!(g.a.edgeFlags[e] & flag)) return false;
      if (!comp[g.a.edgeU[e]] || !comp[g.a.edgeV[e]]) return false;
      return Number.isFinite(edgeSeconds(mode, g.a.edgeClass[e], g.a.edgeFlags[e], 1, false));
    };
  }

  edgeTimes(mode: Mode, when: Date, profile: string): Float32Array {
    const g = this.g, peak = isPeakIST(when);
    const out = new Float32Array(g.m);
    const childSlow = mode === 'walk' && profile === 'child' ? WALK_KMH / 3.8 : 1;
    for (let e = 0; e < g.m; e++)
      out[e] = edgeSeconds(mode, g.a.edgeClass[e], g.a.edgeFlags[e], g.a.edgeLen[e], peak) * childSlow;
    return out;
  }

  private topSpeed(mode: Mode): number {
    return mode === 'walk' ? WALK_KMH / 3.6 : 60 / 3.6;
  }

  private canTraverse(mode: Mode, e: number, from: number): boolean {
    if (mode === 'walk') return true;
    if (!(this.g.a.edgeFlags[e] & F_ONEWAY)) return true;
    return this.g.a.edgeU[e] === from;
  }

  /** A* from a snapped start to a snapped end over per-edge costs. */
  astar(cost: Float32Array, mode: Mode, s: Snapped, t: Snapped, usable: (e: number) => boolean):
    { edges: number[]; cost: number; direct?: boolean } | null {
    const g = this.g;
    const n = g.n, VT = n; // virtual target node
    const gScore = new Float64Array(n + 1).fill(Infinity);
    const prev = new Int32Array(n + 1).fill(-1);
    const closed = new Uint8Array(n + 1);
    const heap = new MinHeap(4096);
    const vmax = this.topSpeed(mode);
    const h = (u: number) => g.proj.dist(g.lon(u), g.lat(u), t.lon, t.lat) / vmax;

    const se = s.edge, su = g.a.edgeU[se], sv = g.a.edgeV[se];
    const oneway = mode !== 'walk' && (g.a.edgeFlags[se] & F_ONEWAY) !== 0;
    // leave the start point towards u (backwards) or v (forwards)
    if (!oneway) { gScore[su] = s.t * cost[se]; heap.push(su, gScore[su] + h(su)); prev[su] = -2; }
    gScore[sv] = Math.min(gScore[sv], (1 - s.t) * cost[se]); heap.push(sv, gScore[sv] + h(sv)); prev[sv] = -2;

    const te = t.edge, tu = g.a.edgeU[te], tv = g.a.edgeV[te];
    const tOneway = mode !== 'walk' && (g.a.edgeFlags[te] & F_ONEWAY) !== 0;
    const extraU = t.t * cost[te]; // from tu along the edge to the point
    const extraV = tOneway ? Infinity : (1 - t.t) * cost[te];

    let direct = Infinity;
    if (se === te) {
      if (t.t >= s.t) direct = (t.t - s.t) * cost[se];
      else if (!oneway) direct = (s.t - t.t) * cost[se];
    }

    let lastNode = -1; // tu or tv: the node from which the destination point was reached
    while (heap.size) {
      const u = heap.pop();
      if (closed[u]) continue;
      closed[u] = 1;
      if (u === VT) break;
      if (gScore[u] >= direct) break;
      if (u === tu && gScore[u] + extraU < gScore[VT]) { gScore[VT] = gScore[u] + extraU; lastNode = tu; heap.push(VT, gScore[VT]); }
      if (u === tv && gScore[u] + extraV < gScore[VT]) { gScore[VT] = gScore[u] + extraV; lastNode = tv; heap.push(VT, gScore[VT]); }
      for (let k = g.adjOff[u]; k < g.adjOff[u + 1]; k++) {
        const e = g.adjEdge[k];
        if (!usable(e) || !this.canTraverse(mode, e, u)) continue;
        const v = g.other(e, u);
        if (closed[v]) continue;
        const ng = gScore[u] + cost[e];
        if (ng < gScore[v]) { gScore[v] = ng; prev[v] = e; heap.push(v, ng + h(v)); }
      }
    }
    if (direct <= gScore[VT]) return Number.isFinite(direct) ? { edges: [se], cost: direct, direct: true } : null;
    if (!Number.isFinite(gScore[VT])) return null;

    // reconstruct: the last node is tu or tv depending on how VT was reached
    let cur = lastNode;
    const edges: number[] = [te];
    while (prev[cur] >= 0) {
      const e = prev[cur];
      edges.push(e);
      cur = g.other(e, cur);
    }
    edges.push(se);
    edges.reverse();
    return { edges, cost: gScore[VT] };
  }

  /**
   * Turn an edge chain (first/last edges partial) into coordinates along the real
   * road geometry. segEdge[i] is the edge travelled between coords[i] and coords[i+1].
   */
  geometryOf(edges: number[], s: Snapped, t: Snapped, direct?: boolean): { coords: LonLat[]; segEdge: number[] } {
    const g = this.g;
    const coords: LonLat[] = [];
    const segEdge: number[] = [];
    const append = (pts: LonLat[], e: number) => {
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const last = coords[coords.length - 1];
        if (last && Math.abs(last[0] - p[0]) < 1e-9 && Math.abs(last[1] - p[1]) < 1e-9) continue;
        if (coords.length) segEdge.push(e);
        coords.push(p);
      }
    };
    if (direct || edges.length < 2) {
      append(g.cut(edges[0], s.t, t.t), edges[0]);
      if (coords.length < 2) { coords.push([t.lon, t.lat]); segEdge.push(edges[0]); }
      return { coords, segEdge };
    }
    const e0 = edges[0], e1 = edges[1];
    const u0 = g.a.edgeU[e0];
    let cur = u0 === g.a.edgeU[e1] || u0 === g.a.edgeV[e1] ? u0 : g.a.edgeV[e0];
    append(g.cut(e0, s.t, cur === u0 ? 0 : 1), e0);
    for (let i = 1; i < edges.length - 1; i++) {
      const e = edges[i];
      const fwd = g.a.edgeU[e] === cur;
      const pts = g.polyline(e);
      append(fwd ? pts : pts.reverse(), e);
      cur = g.other(e, cur);
    }
    const te = edges[edges.length - 1];
    append(g.cut(te, g.a.edgeU[te] === cur ? 0 : 1, t.t), te);
    if (coords.length < 2) { coords.push([t.lon, t.lat]); segEdge.push(te); }
    return { coords, segEdge };
  }

  /** Fastest travel time only (for the travel-mode tabs). */
  fastestTime(from: LonLat, to: LonLat, mode: Mode, when: Date, profile: string): number | null {
    const g = this.g;
    const usable = this.usableFor(mode);
    const s = g.snap(from[0], from[1], usable), t = g.snap(to[0], to[1], usable);
    if (!s || !t) return null;
    const times = this.edgeTimes(mode, when, profile);
    const r = this.astar(times, mode, s, t, usable);
    return r ? r.cost : null;
  }

  /** Main entry point: the up-to-four tiered routes. */
  route(req: RouteRequest, risk?: RiskField): RouteResponse {
    const t0 = performance.now();
    const g = this.g;
    const usable = this.usableFor(req.mode);
    const s = g.snap(req.from[0], req.from[1], usable);
    const t = g.snap(req.to[0], req.to[1], usable);
    risk ??= computeRisk(g, req.ctx);
    const base = { from: s!, to: t!, risk, routes: [] as RouteResult[] };
    if (!s || !t) {
      return { ...base, error: !s ? 'Start point is too far from any road we know.' : 'Destination is too far from any road we know.', computeMs: performance.now() - t0 };
    }
    const times = this.edgeTimes(req.mode, req.when, req.ctx.profile);
    const exposure = MODE_INFO[req.mode].exposure;

    const accepted: { alpha: number; edges: number[]; direct?: boolean }[] = [];
    const penalty = new Float32Array(g.m).fill(1);
    for (const alpha of ALPHAS) {
      let found: { edges: number[]; direct?: boolean } | null = null;
      for (let attempt = 0; attempt < 3 && !found; attempt++) {
        const cost = new Float32Array(g.m);
        for (let e = 0; e < g.m; e++) {
          cost[e] = times[e] * (1 + alpha * exposure * risk.risk[e]) * (attempt > 0 ? penalty[e] : 1);
        }
        const r = this.astar(cost, req.mode, s, t, usable);
        if (!r) break;
        const dup = accepted.some((a) => this.overlap(a.edges, r.edges) > 0.85);
        if (!dup) found = r;
        else for (const e of r.edges) penalty[e] *= 1.5; // push the next attempt off this path
      }
      if (found) {
        accepted.push({ alpha, edges: found.edges, direct: found.direct });
        for (const e of found.edges) penalty[e] *= 1.25;
      }
    }
    if (!accepted.length) {
      return { ...base, error: 'No route found for this travel mode between these points.', computeMs: performance.now() - t0 };
    }

    // Keep a slower route only if it is clearly safer than every faster route we kept,
    // and not absurdly long. This yields a Pareto front: time ↑ ⇒ risk ↓.
    const front = (cands: RouteResult[]): RouteResult[] => {
      const sorted = [...cands].sort((a, b) => a.timeS - b.timeS || b.meanRisk - a.meanRisk);
      const out: RouteResult[] = [];
      for (const r of sorted) {
        if (!out.length) { out.push(r); continue; }
        // nearly the same path and time, but safer: show only the safer one
        const twin = out.findIndex((k) => this.overlap(k.edges, r.edges) > 0.75 && r.timeS <= k.timeS * 1.05);
        if (twin >= 0) {
          if (r.meanRisk < out[twin].meanRisk) out[twin] = r;
          continue;
        }
        const fastestT = out[0].timeS;
        const clearlySafer = out.every((k) =>
          r.meanRisk <= k.meanRisk - MIN_RISK_GAIN || r.worstStretch <= k.worstStretch - 0.08);
        const notWorse = out.every((k) => r.meanRisk < k.meanRisk);
        if (clearlySafer && notWorse && r.timeS <= Math.max(fastestT * MAX_DETOUR, fastestT + 240)) out.push(r);
      }
      return out;
    };
    const swept = front(accepted.map((a) => this.describe(a.alpha, a.edges, s, t, times, risk!, req, a.direct)));
    const fastestT = swept[0].timeS;

    // Look for genuinely different alternatives (penalty method, ≤70% shared road).
    const alts: RouteResult[] = [];
    const altPenalty = new Float32Array(g.m).fill(1);
    for (const r of swept) for (const e of r.edges) altPenalty[e] = 2.5;
    for (let attempt = 0; attempt < 5 && swept.length + alts.length < 4; attempt++) {
      const cost = new Float32Array(g.m);
      for (let e = 0; e < g.m; e++) cost[e] = times[e] * (1 + 1.5 * exposure * risk.risk[e]) * altPenalty[e];
      const r = this.astar(cost, req.mode, s, t, usable);
      if (!r) break;
      for (const e of r.edges) altPenalty[e] *= 2;
      if ([...swept, ...alts].some((k) => this.overlap(k.edges, r.edges) > 0.7)) continue;
      const d = this.describe(1.5, r.edges, s, t, times, risk, req, r.direct);
      if (d.timeS > Math.max(fastestT * MAX_DETOUR, fastestT + 240)) continue;
      alts.push(d);
    }
    // An alternative that turns out clearly safer joins the fastest→safest front.
    const ranked = front([...swept, ...alts]);
    const others = [...swept, ...alts].filter((r) => !ranked.includes(r) &&
      !ranked.some((k) => this.overlap(k.edges, r.edges) > 0.75 && Math.abs(r.timeS - k.timeS) <= k.timeS * 0.05))
      .sort((a, b) => a.timeS - b.timeS)
      .slice(0, Math.max(0, 4 - ranked.length));
    for (const r of [...ranked, ...others]) r.labels = [];
    const fastest = ranked[0];
    const safest = ranked.reduce((a, b) => (b.meanRisk < a.meanRisk ? b : a));
    fastest.labels.push('Fastest');
    if (safest !== fastest) safest.labels.push('Safest');
    else fastest.labels.push('Also safest');
    for (const r of others) r.labels.push('Alternative');
    const routes = [...ranked, ...others];
    let note: string | undefined;
    if (ranked.length === 1) note = 'The fastest route is already the safest one here.';
    if (routes.length < 4) {
      note = (note ? note + ' ' : '') + (routes.length === 1
        ? 'No other sensible route exists between these points.'
        : `Only ${routes.length} meaningfully different routes exist here.`);
    }
    return { ...base, routes, rankedCount: ranked.length, note, computeMs: performance.now() - t0 };
  }

  private overlap(a: number[], b: number[]): number {
    const g = this.g;
    const sa = new Set(a);
    let shared = 0, la = 0, lb = 0;
    for (const e of a) la += g.a.edgeLen[e];
    for (const e of b) { lb += g.a.edgeLen[e]; if (sa.has(e)) shared += g.a.edgeLen[e]; }
    return shared / Math.max(1, Math.min(la, lb));
  }

  describe(alpha: number, edges: number[], s: Snapped, t: Snapped, times: Float32Array,
    risk: RiskField, req: RouteRequest, direct?: boolean): RouteResult {
    const g = this.g;
    const dark = darkness(req.when);
    // fraction of each edge actually travelled (first/last are partial)
    const frac = (i: number) => {
      if (direct) return Math.abs(t.t - s.t);
      if (i === 0) {
        const e = edges[0], next = edges[1];
        const sharedU = g.a.edgeU[e] === g.a.edgeU[next] || g.a.edgeU[e] === g.a.edgeV[next];
        return sharedU ? s.t : 1 - s.t;
      }
      if (i === edges.length - 1) {
        const e = edges[i], prevE = edges[i - 1];
        const sharedU = g.a.edgeU[e] === g.a.edgeU[prevE] || g.a.edgeU[e] === g.a.edgeV[prevE];
        return sharedU ? t.t : 1 - t.t;
      }
      return 1;
    };
    let T = 0, L = 0, RT = 0, main = 0, lit = 0, police = 0;
    const havenSet = new Set<number>();
    const reasonsOf = (e: number): string[] => {
      const r: string[] = [];
      if ((req.ctx.live?.get(e) ?? 0) > 0.1) r.push('reported unsafe by travellers recently');
      const cls = ROAD_CLASSES[g.a.edgeClass[e]];
      const gb = g.a.edgeGreen[e];
      if (gb & 1) r.push('through a park');
      else if (gb & 2) r.push('beside a large park');
      if (gb & 4) r.push('industrial / empty land');
      if (cls === 'path' || cls === 'track') r.push('unpaved lonely path');
      if (cls === 'steps') r.push('steps / underpass');
      if (dark > 0.5 && (cls === 'service' || cls === 'footway' || cls === 'path' || cls === 'track')) r.push('probably poorly lit');
      let open = 0;
      for (const p of g.edgePois(e)) if (risk.poiOpen[p]) open++;
      if (open === 0) r.push('nothing open nearby');
      if (g.a.edgePoliceM[e] > 1200) r.push('far from police');
      return r;
    };
    const perEdge: { e: number; len: number; r: number }[] = [];
    edges.forEach((e, i) => {
      const f = frac(i);
      const len = g.a.edgeLen[e] * f, tm = times[e] * f;
      T += tm; L += len; RT += tm * risk.risk[e];
      const cls = ROAD_CLASSES[g.a.edgeClass[e]];
      if (['motorway', 'trunk', 'primary', 'secondary', 'tertiary'].includes(cls)) main += len;
      if (['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'pedestrian'].includes(cls)) lit += len;
      if (g.a.edgePoliceM[e] < 500) police += len;
      for (const p of g.edgePois(e)) if (risk.poiOpen[p]) havenSet.add(p);
      perEdge.push({ e, len, r: risk.risk[e] });
    });
    // worst ~200 m stretch (sliding window by length)
    let worst = 0, wl = 0, wr = 0, lo = 0;
    for (let hi = 0; hi < perEdge.length; hi++) {
      wl += perEdge[hi].len; wr += perEdge[hi].len * perEdge[hi].r;
      while (wl - perEdge[lo].len >= 200 && lo < hi) { wl -= perEdge[lo].len; wr -= perEdge[lo].len * perEdge[lo].r; lo++; }
      if (wl >= 120) worst = Math.max(worst, wr / wl);
    }
    if (L < 120) worst = T > 0 ? RT / T : 0;
    // danger spots: contiguous stretches >= 120 m with risk >= 0.55
    const dangerSpots: DangerSpot[] = [];
    let runLen = 0, runStart = -1;
    const flush = (endIdx: number) => {
      if (runStart >= 0 && runLen >= 120) {
        const midIdx = Math.floor((runStart + endIdx) / 2);
        const e = perEdge[midIdx].e;
        const reasons = new Set<string>();
        for (let k = runStart; k <= endIdx; k++) for (const r of reasonsOf(perEdge[k].e)) reasons.add(r);
        const [dlon, dlat] = g.pointAt(e, 0.5);
        // the street most of this stretch runs along
        const byName = new Map<string, number>();
        for (let k = runStart; k <= endIdx; k++) {
          const nm = g.name(perEdge[k].e);
          if (nm) byName.set(nm, (byName.get(nm) ?? 0) + perEdge[k].len);
        }
        const street = [...byName].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
        dangerSpots.push({
          lon: dlon, lat: dlat, street,
          lengthM: Math.round(runLen), reasons: [...reasons].slice(0, 3),
        });
      }
      runLen = 0; runStart = -1;
    };
    perEdge.forEach((p, i) => {
      if (p.r >= 0.55) { if (runStart < 0) runStart = i; runLen += p.len; }
      else flush(i - 1);
    });
    flush(perEdge.length - 1);

    const havens: Partial<Record<PoiCat, number>> = {};
    for (const p of havenSet) { const c = req.ctx.pois[p].cat; havens[c] = (havens[c] ?? 0) + 1; }
    const meanRisk = T > 0 ? RT / T : 0;
    const warnings: string[] = [];
    if (dangerSpots.length) warnings.push(`${dangerSpots.length} risky stretch${dangerSpots.length > 1 ? 'es' : ''} (${dangerSpots.reduce((a, d) => a + d.lengthM, 0)} m)`);
    if (dark > 0.5 && L > 0 && lit / L < 0.4) warnings.push('Mostly side streets after dark');
    if (L > 0 && police / L < 0.2) warnings.push('Little police presence nearby');
    const havenTotal = havenSet.size;
    if (dark > 0.5 && L > 300 && havenTotal < L / 400) warnings.push('Few places open along the way');
    const geo = this.geometryOf(edges, s, t, direct);
    return {
      alpha, edges, coords: geo.coords, segEdge: geo.segEdge, timeS: T, lengthM: L, meanRisk,
      worstStretch: worst, tier: tierOf(meanRisk, worst), havens, havenIds: [...havenSet],
      mainRoadShare: L ? main / L : 0, litShare: L ? lit / L : 0, policeShare: L ? police / L : 0,
      dangerSpots, warnings, labels: [],
    };
  }
}

export function havenSummary(h: Partial<Record<PoiCat, number>>): string {
  const order: PoiCat[] = ['police', 'hospital', 'pharmacy', 'clinic', 'station', 'fuel', 'shop', 'food'];
  return order.filter((c) => h[c]).map((c) => `${CAT_INFO[c].icon} ${h[c]}`).join('  ');
}
