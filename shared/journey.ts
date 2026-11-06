// Live journey monitoring: arrival geofence, off-route, stopped-too-long,
// overdue, and trajectory checks that unlock the post-journey review.
// Pure logic (no timers, no GPS APIs) so it runs identically in the app,
// the server and the tests.

import { LocalProjection, pointPolylineDist, haversine, type LonLat } from './geo.ts';
import type { Mode } from './modes.ts';
import type { Tier } from './router.ts';

export interface Fix {
  lon: number;
  lat: number;
  /** horizontal accuracy in metres (GPS 1-sigma) */
  acc: number;
  /** epoch ms */
  t: number;
}

export type JourneyEvent =
  | { type: 'arrived'; at: number }
  | { type: 'off_route'; distM: number }
  | { type: 'back_on_route' }
  | { type: 'stopped'; minutes: number; onRiskySegment: boolean }
  | { type: 'overdue'; minutesLate: number }
  | { type: 'gps_jump'; speedKmh: number };

export const ARRIVAL_TARGET_M = 10;
/** Geofence radius: 10 m target, widened for urban GPS drift up to 40 m. */
export function arrivalRadius(accM: number): number {
  return Math.max(15, Math.min(40, ARRIVAL_TARGET_M + accM));
}

const MAX_KMH: Record<Mode, number> = { walk: 15, twowheeler: 90, auto: 70, car: 110 };

export interface JourneyPlan {
  mode: Mode;
  route: LonLat[];
  /** tier per route vertex-segment (length route.length-1), used for stop alerts */
  segTier?: Tier[];
  dest: LonLat;
  etaS: number;
  startedAt: number;
  /** minutes stationary before asking "are you OK?" (on red/yellow vs green parts) */
  stopMinRisky?: number;
  stopMinSafe?: number;
  /** grace after ETA before the overdue check-in */
  overdueGraceMin?: number;
}

export class JourneyMonitor {
  readonly fixes: Fix[] = [];
  arrivedAt: number | null = null;
  private proj: LocalProjection;
  private offCount = 0;
  private isOff = false;
  private stopAnchor: Fix | null = null;
  private stopAlerted = false;
  private overdueAlerted = false;
  jumps = 0;

  constructor(readonly plan: JourneyPlan) {
    this.proj = new LocalProjection(plan.dest[1]);
  }

  /** Feed one GPS fix; returns any events it triggers. */
  feed(f: Fix): JourneyEvent[] {
    const ev: JourneyEvent[] = [];
    const prev = this.fixes[this.fixes.length - 1];
    if (prev && f.t <= prev.t) return ev; // out-of-order / duplicate
    if (f.acc > 150) { this.fixes.push(f); return this.timeChecks(f.t, ev); } // too vague to judge position
    if (prev) {
      const dt = (f.t - prev.t) / 3600000;
      const kmh = dt > 0 ? haversine(prev.lon, prev.lat, f.lon, f.lat) / 1000 / dt : 0;
      if (kmh > MAX_KMH[this.plan.mode] * 1.6 && haversine(prev.lon, prev.lat, f.lon, f.lat) > 80) {
        this.jumps++;
        ev.push({ type: 'gps_jump', speedKmh: Math.round(kmh) });
      }
    }
    this.fixes.push(f);
    if (this.arrivedAt) return ev;

    // arrival
    const dDest = this.proj.dist(f.lon, f.lat, this.plan.dest[0], this.plan.dest[1]);
    if (dDest <= arrivalRadius(f.acc)) {
      this.arrivedAt = f.t;
      ev.push({ type: 'arrived', at: f.t });
      return ev;
    }

    // off route: 3 consecutive fixes beyond 50 m (+ accuracy)
    const dRoute = pointPolylineDist(this.proj, [f.lon, f.lat], this.plan.route);
    if (dRoute > 50 + Math.min(f.acc, 50)) {
      this.offCount++;
      if (this.offCount >= 3 && !this.isOff) { this.isOff = true; ev.push({ type: 'off_route', distM: Math.round(dRoute) }); }
    } else {
      this.offCount = 0;
      if (this.isOff) { this.isOff = false; ev.push({ type: 'back_on_route' }); }
    }

    // stationary detection: stayed within 30 m of an anchor
    if (!this.stopAnchor || this.proj.dist(f.lon, f.lat, this.stopAnchor.lon, this.stopAnchor.lat) > 30 + Math.min(f.acc, 30)) {
      this.stopAnchor = f;
      this.stopAlerted = false;
    } else if (!this.stopAlerted) {
      const minutes = (f.t - this.stopAnchor.t) / 60000;
      const risky = this.onRiskySegment(f);
      const limit = risky ? (this.plan.stopMinRisky ?? 4) : (this.plan.stopMinSafe ?? 10);
      if (minutes >= limit) {
        this.stopAlerted = true;
        ev.push({ type: 'stopped', minutes: Math.round(minutes), onRiskySegment: risky });
      }
    }
    return this.timeChecks(f.t, ev);
  }

  /** Call periodically even without GPS (e.g. every 30 s) for the overdue check. */
  tick(now: number): JourneyEvent[] {
    return this.timeChecks(now, []);
  }

  private timeChecks(now: number, ev: JourneyEvent[]): JourneyEvent[] {
    if (this.arrivedAt || this.overdueAlerted) return ev;
    const grace = (this.plan.overdueGraceMin ?? 10) * 60000;
    const due = this.plan.startedAt + this.plan.etaS * 1000 * 1.25 + grace;
    if (now > due) {
      this.overdueAlerted = true;
      ev.push({ type: 'overdue', minutesLate: Math.round((now - (this.plan.startedAt + this.plan.etaS * 1000)) / 60000) });
    }
    return ev;
  }

  /** Re-arm the stop / overdue checks after the user answers "I'm OK". */
  acknowledge(kind: 'stopped' | 'overdue', now: number): void {
    if (kind === 'stopped') { this.stopAnchor = null; this.stopAlerted = false; }
    if (kind === 'overdue') { this.overdueAlerted = false; this.plan.startedAt = now - this.plan.etaS * 1000; }
  }

  private onRiskySegment(f: Fix): boolean {
    const tiers = this.plan.segTier;
    if (!tiers?.length) return true;
    let best = Infinity, bi = 0;
    for (let i = 1; i < this.plan.route.length; i++) {
      const a = this.plan.route[i - 1], b = this.plan.route[i];
      const d = this.proj.pointSegDist(f.lon, f.lat, a[0], a[1], b[0], b[1]);
      if (d < best) { best = d; bi = i - 1; }
    }
    return tiers[bi] !== 'green';
  }

  coverage(): number {
    return routeCoverage(this.plan.route, this.fixes);
  }
}

/**
 * Fraction of the planned route (by length) that the GPS track actually
 * passed within a corridor of max(35 m, accuracy). Sampled every 15 m.
 */
export function routeCoverage(route: LonLat[], fixes: Fix[]): number {
  if (route.length < 2 || fixes.length === 0) return 0;
  const proj = new LocalProjection(route[0][1]);
  const good = fixes.filter((f) => f.acc <= 100);
  if (!good.length) return 0;
  let total = 0, covered = 0;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i];
    const len = proj.dist(a[0], a[1], b[0], b[1]);
    const n = Math.max(1, Math.ceil(len / 15));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
      const piece = len / n;
      total += piece;
      for (const f of good) {
        if (proj.dist(x, y, f.lon, f.lat) <= Math.max(35, f.acc)) { covered += piece; break; }
      }
    }
  }
  return total > 0 ? covered / total : 0;
}

export interface ReviewEligibility {
  eligible: boolean;
  coverage: number;
  reasons: string[];
}

/** Reviews unlock only for journeys that verifiably followed the route and arrived. */
export function reviewEligibility(m: JourneyMonitor): ReviewEligibility {
  const reasons: string[] = [];
  const coverage = m.coverage();
  if (!m.arrivedAt) reasons.push('did not reach the destination geofence');
  if (coverage < 0.8) reasons.push(`followed only ${Math.round(coverage * 100)}% of the route (80% needed)`);
  if (m.fixes.length < 5) reasons.push('too few GPS points');
  if (m.jumps > 2) reasons.push('GPS track has impossible jumps');
  const dur = m.arrivedAt ? (m.arrivedAt - m.plan.startedAt) / 1000 : 0;
  if (m.arrivedAt && dur < m.plan.etaS * 0.35) reasons.push('arrived implausibly fast for this mode');
  return { eligible: reasons.length === 0, coverage, reasons };
}
