// Live safety reports (Waze-style): travellers mark a spot as unsafe right now, others
// confirm or dismiss it, and routing avoids it until it expires.

import type { Graph } from './graph.ts';

export const REPORT_KINDS = {
  dark: { label: 'No street lights', icon: '🌑', weight: 0.8, hours: 12, danger: true },
  deserted: { label: 'Deserted street', icon: '🚷', weight: 0.7, hours: 3, danger: true },
  harassment: { label: 'Harassment / eve-teasing', icon: '⚠️', weight: 1.2, hours: 6, danger: true },
  drunk: { label: 'Drunk group', icon: '🍺', weight: 0.9, hours: 3, danger: true },
  followed: { label: 'Someone following people', icon: '👣', weight: 1.2, hours: 2, danger: true },
  dogs: { label: 'Aggressive stray dogs', icon: '🐕', weight: 0.6, hours: 6, danger: true },
  police: { label: 'Police patrol here', icon: '👮', weight: -0.6, hours: 2, danger: false },
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
    if (!s) continue;
    const d = 0.3 * REPORT_KINDS[r.kind].weight * s;
    for (const e of g.edgesNear(r.lon, r.lat, 60)) {
      const v = (out.get(e) ?? 0) + d;
      out.set(e, Math.max(-0.25, Math.min(0.6, v)));
    }
  }
  return out;
}
