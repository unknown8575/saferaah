// Time-dependent risk score R(e) in [0, 1] for every street segment.
//
//   R(e) = τ(t)·[ w_open·(1 − S_open) + w_auth·(1 − P_auth) + w_busy·(1 − C_busy)
//               + w_lit·darkness·(1 − L_lit) + w_iso·I_iso ] / Σw
//        + w_traffic·T_child + w_crowd·U_crowd             (then clamped to [0, 1])
//
//   τ(t) = 0.35 + 0.65·darkness — the hour scales environmental risk.
//
// S_open  open safe havens within 50 m (police, hospitals, medical stores, shops…)
// P_auth  police station / metro security nearby
// C_busy  how much activity the street has at this hour (road type, buildings, open shops)
// L_lit   lighting prior by road type (OSM lit=* is rarely mapped in Delhi)
// I_iso   isolation: inside/along large parks, industrial land, foot-only paths, steps
// T_child traffic exposure on big roads (only for the "child" profile)
// U_crowd verified traveller reviews, Bayesian-shrunk towards neutral

import { Graph } from './graph.ts';
import { ROAD_CLASSES, type RoadClass } from './modes.ts';
import { CAT_INFO, isOpenAt, type Poi } from './places.ts';
import { darkness, istTime, timeScale } from './time.ts';

export type Profile = 'woman' | 'child' | 'general';

export interface RiskWeights {
  open: number; auth: number; busy: number; lit: number; iso: number; traffic: number; crowd: number;
}
export const DEFAULT_WEIGHTS: RiskWeights = {
  open: 0.22, auth: 0.10, busy: 0.34, lit: 0.18, iso: 0.16, traffic: 0, crowd: 0.30,
};
export function weightsFor(profile: Profile): RiskWeights {
  if (profile === 'child') return { ...DEFAULT_WEIGHTS, traffic: 0.25 };
  return DEFAULT_WEIGHTS;
}

/** Activity prior by road type for each hour of the day (0..1, 1 = always people around). */
const ACTIVITY: Partial<Record<RoadClass, [number, number, number]>> = {
  //              day   evening night
  motorway: [0.30, 0.25, 0.10],
  trunk: [0.85, 0.85, 0.55],
  primary: [0.90, 0.90, 0.55],
  secondary: [0.85, 0.80, 0.45],
  tertiary: [0.75, 0.70, 0.30],
  unclassified: [0.55, 0.45, 0.12],
  residential: [0.60, 0.55, 0.10],
  living_street: [0.60, 0.50, 0.10],
  service: [0.40, 0.30, 0.05],
  pedestrian: [0.85, 0.75, 0.20],
  footway: [0.45, 0.30, 0.05],
  path: [0.25, 0.12, 0.02],
  steps: [0.40, 0.25, 0.05],
  track: [0.15, 0.08, 0.02],
  cycleway: [0.30, 0.20, 0.05],
};
/** Probability the street is lit at night, by road type (Delhi prior). */
const LIT: Partial<Record<RoadClass, number>> = {
  motorway: 0.9, trunk: 0.9, primary: 0.9, secondary: 0.85, tertiary: 0.75, unclassified: 0.5,
  residential: 0.6, living_street: 0.55, service: 0.4, pedestrian: 0.7, footway: 0.35,
  path: 0.15, steps: 0.3, track: 0.05, cycleway: 0.45,
};
const ISO_CLASS: Partial<Record<RoadClass, number>> = {
  path: 0.7, track: 0.9, steps: 0.5, footway: 0.35, service: 0.25, cycleway: 0.3,
};
const TRAFFIC: Partial<Record<RoadClass, number>> = {
  motorway: 1, trunk: 0.9, primary: 0.7, secondary: 0.5, tertiary: 0.3,
};

export interface CrowdStat {
  /** effective number of distinct verified travellers (older votes decay, 90-day half-life) */
  n: number;
  /** mean safety rating 1..5 */
  mean: number;
}

/**
 * Thresholds (distinct verified travellers per segment). Warnings count sooner
 * than "it's safe" votes, because a false "safe" is the more dangerous error.
 */
export const MIN_REVIEWS_WARN = 5;
export const MIN_REVIEWS_SAFE = 10;
/** Bayesian prior strength (pseudo-reviews at the neutral rating 3). */
export const PRIOR_REVIEWS = 10;

/**
 * Crowd danger U in [-1, 1]: positive = travellers felt unsafe, negative = felt safe.
 * Below the threshold the segment stays at the neutral baseline (0); above it the
 * Bayesian average lets the crowd take over gradually as reviews accumulate.
 */
export function crowdDanger(s: CrowdStat | undefined): number {
  if (!s) return 0;
  const needed = s.mean < 3 ? MIN_REVIEWS_WARN : MIN_REVIEWS_SAFE;
  if (s.n < needed) return 0;
  const bayes = (PRIOR_REVIEWS * 3 + s.n * s.mean) / (PRIOR_REVIEWS + s.n);
  return Math.max(-1, Math.min(1, (3 - bayes) / 2));
}

export interface RiskContext {
  when: Date;
  profile: Profile;
  pois: Poi[];
  crowd?: Map<number, CrowdStat>;
  /** extra risk per edge from live safety reports (see live.ts) */
  live?: Map<number, number>;
  weights?: RiskWeights;
}

export interface RiskField {
  risk: Float32Array; // per edge, 0..1
  /** per POI: open at this time? (for UI) */
  poiOpen: Uint8Array;
  poiVerified: Uint8Array;
  darkness: number;
}

const BAND_IDX = (h: number) => (h >= 6 && h < 18 ? 0 : h >= 18 && h < 22 ? 1 : 2);

export function computeRisk(g: Graph, ctx: RiskContext): RiskField {
  const w = ctx.weights ?? weightsFor(ctx.profile);
  const dark = darkness(ctx.when);
  const hour = istTime(ctx.when).hour;
  const band = BAND_IDX(hour);
  const tau = timeScale(ctx.when);

  const poiOpen = new Uint8Array(ctx.pois.length);
  const poiVerified = new Uint8Array(ctx.pois.length);
  for (let i = 0; i < ctx.pois.length; i++) {
    const s = isOpenAt(ctx.pois[i], ctx.when);
    poiOpen[i] = s.open ? 1 : 0;
    poiVerified[i] = s.verified ? 1 : 0;
  }

  const risk = new Float32Array(g.m);
  const a = g.a;
  for (let e = 0; e < g.m; e++) {
    const cls = ROAD_CLASSES[a.edgeClass[e]];
    // S_open: open havens within 50 m
    let haven = 0, commerce = 0;
    for (const pid of g.edgePois(e)) {
      if (!poiOpen[pid]) continue;
      const p = ctx.pois[pid];
      haven += CAT_INFO[p.cat].haven;
      if (p.cat === 'shop' || p.cat === 'food' || p.cat === 'pharmacy' || p.cat === 'fuel') commerce++;
    }
    // liquor outlets can push this below 0 (worse than nothing open)
    const S = Math.max(-0.3, 1 - Math.exp(-haven / 1.5));
    // P_auth: police within ~150 m is full credit, fades out by 1 km; metro security helps while open
    const pm = a.edgePoliceM[e];
    let P = Math.max(0, Math.min(1, 1 - (pm - 150) / 850));
    const stationOpen = hour >= 5.5 && hour < 23.5;
    if (stationOpen && a.edgeStationM[e] < 250) P = Math.min(1, P + 0.4);
    // C_busy: road-type activity + buildings + open commerce
    const act = ACTIVITY[cls]?.[band] ?? 0.3;
    const C = 0.55 * act + 0.2 * Math.min(1, a.edgeBldg[e] / 30) + 0.25 * Math.min(1, commerce / 4);
    // L_lit
    const L = LIT[cls] ?? 0.4;
    // isolation
    const gb = a.edgeGreen[e];
    let I = ISO_CLASS[cls] ?? 0;
    if (gb & 1) I = Math.max(I, 0.9);
    if (gb & 4) I = Math.max(I, 0.8);
    if (gb & 2) I = Math.max(I, 0.5);
    // T_child traffic
    const T = TRAFFIC[cls] ?? 0;
    const U = crowdDanger(ctx.crowd?.get(e));

    // Environmental risk, scaled by how much the hour itself matters: a quiet lane at
    // 1 pm is a much smaller concern than the same lane at 11 pm.
    const base = w.open + w.auth + w.busy + w.lit + w.iso;
    const env =
      (w.open * (1 - S) + w.auth * (1 - P) + w.busy * (1 - C) +
        w.lit * dark * (1 - L) + w.iso * I) / base;
    let r = tau * env + w.traffic * T + w.crowd * U + (ctx.live?.get(e) ?? 0);
    risk[e] = Math.max(0, Math.min(1, r));
  }
  return { risk, poiOpen, poiVerified, darkness: dark };
}
