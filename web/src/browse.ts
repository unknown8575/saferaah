// "Gym near me": nearby places of a kind, with similar places when that exact kind
// is not close by. Data: data/places.json (every mapped place with its precise type).

import { isOpenAt } from '../../shared/places.ts';
import { kindCat, kindLabel, type Intent } from '../../shared/kinds.ts';
import { haversine, type LonLat } from '../../shared/geo.ts';

export interface BrowsePlace {
  name: string;
  label: string; // "Gym", "Sports centre"
  sub: string;
  lon: number;
  lat: number;
  oh?: string;
  distM: number;
  open: boolean;
  verified: boolean;
  /** not the kind asked for, but close to it */
  similar: boolean;
}

type Row = [string, number, number, number, string?];
let data: { subs: string[]; rows: Row[] } | null = null;
let loading: Promise<void> | null = null;
let subSet = new Set<string>();

export function loadPlaces(base: string): Promise<void> {
  loading ??= fetch(base + 'data/places.json').then((r) => r.json()).then((d) => { data = d; subSet = new Set(d.subs); })
    .catch(() => { loading = null; });
  return loading;
}
export const placesReady = () => !!data;
/** for tests and for apps that ship the index another way */
export function setPlaces(d: { subs: string[]; rows: Row[] }) { data = d; subSet = new Set(d.subs); }
export const knownSubs = () => subSet;

/**
 * Nearest places for an intent. Shows up to `max` of the exact kind within `radiusM`;
 * if fewer than `min`, fills up with similar kinds; if still short, looks further for
 * the exact kind.
 */
export function nearbyFor(intent: Intent, at: LonLat, when: Date, opts: { min?: number; max?: number; radiusM?: number } = {}): BrowsePlace[] {
  if (!data) return [];
  const { min = 5, max = 7, radiusM = 5000 } = opts;
  const exact = new Set(intent.exact), similar = new Set(intent.similar);
  const ex: BrowsePlace[] = [], sim: BrowsePlace[] = [];
  const dLat = 15000 / 111200, dLon = 15000 / (111200 * Math.cos((at[1] * Math.PI) / 180));
  for (const r of data.rows) {
    const sub = data.subs[r[3]];
    const isEx = exact.has(sub);
    if (!isEx && !similar.has(sub)) continue;
    if (Math.abs(r[1] - at[0]) > dLon || Math.abs(r[2] - at[1]) > dLat) continue;
    const distM = haversine(at[0], at[1], r[1], r[2]);
    const st = isOpenAt({ cat: kindCat(sub), oh: r[4] }, when);
    const p: BrowsePlace = { name: r[0] || kindLabel(sub), label: kindLabel(sub), sub, lon: r[1], lat: r[2], oh: r[4], distM,
      open: st.open, verified: st.verified, similar: !isEx };
    (isEx ? ex : sim).push(p);
  }
  ex.sort((a, b) => a.distM - b.distM);
  sim.sort((a, b) => a.distM - b.distM);
  const near = ex.filter((p) => p.distM <= radiusM).slice(0, max);
  if (near.length >= min) return near;
  const fill = sim.filter((p) => p.distM <= radiusM).slice(0, max - near.length);
  const out = [...near, ...fill];
  if (out.length < min) out.push(...ex.filter((p) => p.distM > radiusM).slice(0, min - out.length));
  return out.sort((a, b) => Number(a.similar) - Number(b.similar) || a.distM - b.distM);
}
