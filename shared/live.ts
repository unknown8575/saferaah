// Live safety reports (Waze-style): travellers mark a spot as unsafe right now, others
// confirm or dismiss it, and routing avoids it until it expires.

import type { Graph } from './graph.ts';

export const REPORT_KINDS = {
  dark: { label: 'No street lights', icon: '🌑', weight: 0.8, hours: 12, danger: true, air: 0 },
  deserted: { label: 'Deserted street', icon: '🚷', weight: 0.7, hours: 3, danger: true, air: 0 },
  harassment: { label: 'Harassment / eve-teasing', icon: '⚠️', weight: 1.2, hours: 6, danger: true, air: 0 },
  drunk: { label: 'Drunk group', icon: '🍺', weight: 0.9, hours: 3, danger: true, air: 0 },
  followed: { label: 'Someone following people', icon: '👣', weight: 1.2, hours: 2, danger: true, air: 0 },
  dogs: { label: 'Aggressive stray dogs', icon: '🐕', weight: 0.6, hours: 6, danger: true, air: 0 },
  police: { label: 'Police patrol here', icon: '👮', weight: -0.6, hours: 2, danger: false, air: 0 },
  // air reports don't change safety; they make the clean-air route steer around them
  burning: { label: 'Garbage burning', icon: '🔥', weight: 0, hours: 6, danger: false, air: 0.6 },
  dust: { label: 'Construction dust', icon: '🏗️', weight: 0, hours: 24, danger: false, air: 0.4 },
  smoke: { label: 'Heavy smoke or fumes', icon: '💨', weight: 0, hours: 3, danger: false, air: 0.5 },
} as const;
export type ReportKind = keyof typeof REPORT_KINDS;
export const isReportKind = (k: unknown): k is ReportKind => typeof k === 'string' && k in REPORT_KINDS;

export interface LiveReport {
  id: string;
  kind: ReportKind;
  lon: number;
  lat: number;
  createdAt: number;
  expiresAt: number;
  confirms: number; // distinct devices that confirmed (reporter included)
  dismisses: number;
}

/** How strongly a report counts: half until a second traveller confirms it, fading near expiry. */
export function reportStrength(r: LiveReport, now: number): number {
  if (now >= r.expiresAt || r.dismisses > r.confirms) return 0;
  const corroboration = r.confirms >= 2 ? 1 : 0.5;
  const life = (r.expiresAt - now) / (r.expiresAt - r.createdAt);
  const fade = Math.min(1, 0.4 + life);
  return corroboration * fade;
}

/** Extra risk per edge from live reports within 60 m (positive = more dangerous). */
export function liveEdgeDeltas(g: Graph, reports: LiveReport[], now: number): Map<number, number> {
  const out = new Map<number, number>();
  for (const r of reports) {
    const s = reportStrength(r, now);
    if (!s || !REPORT_KINDS[r.kind].weight) continue;
    const d = 0.3 * REPORT_KINDS[r.kind].weight * s;
    for (const e of g.edgesNear(r.lon, r.lat, 60)) {
      const v = (out.get(e) ?? 0) + d;
      out.set(e, Math.max(-0.25, Math.min(0.6, v)));
    }
  }
  return out;
}

/** True for reports about the air (smoke, dust, burning) rather than safety. */
export const isAirReport = (k: ReportKind): boolean => REPORT_KINDS[k].air > 0;

/** Extra street pollution factor per edge from air reports: full within 80 m, fading to 250 m. */
export function airEdgeDeltas(g: Graph, reports: LiveReport[], now: number): Map<number, number> {
  const out = new Map<number, number>();
  for (const r of reports) {
    const k = REPORT_KINDS[r.kind];
    if (!k?.air) continue;
    const s = reportStrength(r, now);
    if (!s) continue;
    for (const e of g.edgesNear(r.lon, r.lat, 250)) {
      const [x, y] = g.pointAt(e, 0.5);
      const d = g.proj.dist(x, y, r.lon, r.lat);
      const fall = d <= 80 ? 1 : Math.max(0, 1 - (d - 80) / 170);
      if (!fall) continue;
      out.set(e, Math.min(1, (out.get(e) ?? 0) + k.air * s * fall));
    }
  }
  return out;
}
