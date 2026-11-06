import { describe, it, expect } from 'vitest';
import { JourneyMonitor, arrivalRadius, routeCoverage, reviewEligibility, type Fix, type JourneyEvent } from '../../shared/journey.ts';
import type { LonLat } from '../../shared/geo.ts';

// a straight 1 km walk east along latitude 28.6 (1° lon ≈ 97.6 km here)
const A: LonLat = [77.2, 28.6];
const B: LonLat = [77.2 + 1000 / 97630, 28.6];
const route: LonLat[] = [A, [77.2 + 500 / 97630, 28.6], B];
const at = (m: number, offN = 0): LonLat => [77.2 + m / 97630, 28.6 + offN / 111195];
const T0 = Date.UTC(2026, 10, 6, 16, 0);
const mk = (segTier?: ('green' | 'red')[]) => new JourneyMonitor({ mode: 'walk', route, dest: B, etaS: 780, startedAt: T0, segTier });
const fix = (p: LonLat, s: number, acc = 5): Fix => ({ lon: p[0], lat: p[1], acc, t: T0 + s * 1000 });
const types = (evs: JourneyEvent[]) => evs.map((e) => e.type);

function walk(m: JourneyMonitor, toM = 1000, stepM = 20, speed = 1.3): JourneyEvent[] {
  const out: JourneyEvent[] = [];
  for (let d = 0; d <= toM; d += stepM) out.push(...m.feed(fix(at(d), d / speed)));
  return out;
}

describe('arrival geofence (FR-11)', () => {
  it('TC-40 arrives within 10 m target', () => {
    const m = mk();
    walk(m, 980);
    expect(types(m.feed(fix(at(992), 770)))).toContain('arrived');
  });
  it('TC-41 radius widens with GPS accuracy', () => {
    expect(arrivalRadius(5)).toBe(15);
    expect(arrivalRadius(25)).toBe(35);
    const m = mk();
    walk(m, 960);
    expect(types(m.feed(fix(at(970), 760, 25)))).toContain('arrived');
  });
  it('TC-42 radius is capped at 40 m', () => {
    expect(arrivalRadius(80)).toBe(40);
    const m = mk();
    walk(m, 940);
    expect(types(m.feed(fix(at(955), 740, 50)))).not.toContain('arrived');
  });
});

describe('off route (FR-13)', () => {
  it('TC-43 three far fixes raise one off_route, then back_on_route', () => {
    const m = mk();
    walk(m, 300);
    const ev = [...m.feed(fix(at(320, 120), 250)), ...m.feed(fix(at(340, 120), 265)), ...m.feed(fix(at(360, 120), 280)), ...m.feed(fix(at(380, 120), 295))];
    expect(types(ev).filter((t) => t === 'off_route')).toHaveLength(1);
    expect(types(m.feed(fix(at(400), 310)))).toContain('back_on_route');
  });
  it('TC-44 two noisy fixes are ignored', () => {
    const m = mk();
    walk(m, 300);
    const ev = [...m.feed(fix(at(320, 120), 250)), ...m.feed(fix(at(340, 120), 265)), ...m.feed(fix(at(360), 280))];
    expect(types(ev)).not.toContain('off_route');
  });
});

describe('check-ins (FR-14)', () => {
  it('TC-45 stopping 4 min on a risky stretch asks "are you OK?"', () => {
    const m = mk(['red', 'red']);
    walk(m, 300);
    const ev: JourneyEvent[] = [];
    for (let s = 0; s <= 250; s += 10) ev.push(...m.feed(fix(at(302), 231 + s)));
    const stop = ev.find((e) => e.type === 'stopped');
    expect(stop).toMatchObject({ type: 'stopped', onRiskySegment: true });
  });
  it('TC-46 on a green stretch it waits 10 min', () => {
    const m = mk(['green', 'green']);
    walk(m, 300);
    const ev: JourneyEvent[] = [];
    for (let s = 0; s <= 300; s += 10) ev.push(...m.feed(fix(at(302), 231 + s)));
    expect(types(ev)).not.toContain('stopped');
    for (let s = 310; s <= 620; s += 10) ev.push(...m.feed(fix(at(302), 231 + s)));
    expect(types(ev)).toContain('stopped');
  });
  it('TC-47 overdue fires once after ETA×1.25 + 10 min', () => {
    const m = mk();
    expect(m.tick(T0 + 780 * 1000)).toHaveLength(0);
    const late = T0 + (780 * 1.25 + 601) * 1000;
    expect(types(m.tick(late))).toEqual(['overdue']);
    expect(m.tick(late + 60000)).toHaveLength(0);
    m.acknowledge('overdue', late);
    expect(m.tick(late + 60000)).toHaveLength(0);
  });
  it('TC-48 out-of-order and duplicate fixes are ignored', () => {
    const m = mk();
    m.feed(fix(at(100), 80));
    m.feed(fix(at(50), 40));
    m.feed(fix(at(100), 80));
    expect(m.fixes).toHaveLength(1);
  });
  it('TC-49 impossible jumps are flagged', () => {
    const m = mk();
    m.feed(fix(at(0), 0));
    const ev = m.feed(fix(at(990, 0), 5));
    expect(types(ev)).toContain('gps_jump');
    expect(m.jumps).toBe(1);
  });
});

describe('review eligibility (FR-18)', () => {
  it('TC-50 an honest full walk is eligible', () => {
    const m = mk();
    walk(m, 1000);
    expect(m.arrivedAt).not.toBeNull();
    expect(m.coverage()).toBeGreaterThan(0.95);
    expect(reviewEligibility(m).eligible).toBe(true);
  });
  it('TC-51 a partial track that teleports to the end is rejected', () => {
    const m = mk();
    walk(m, 600);
    m.feed(fix(B, 470));
    m.feed(fix(at(-300), 475));
    m.feed(fix(B, 480));
    const el = reviewEligibility(m);
    expect(el.eligible).toBe(false);
    expect(el.reasons.join(' ')).toMatch(/80%/);
  });
  it('TC-52 arriving implausibly fast is rejected', () => {
    const m = mk();
    walk(m, 1000, 20, 7); // 25 km/h "walking"
    expect(reviewEligibility(m).reasons.join(' ')).toMatch(/implausibly fast/);
  });
  it('coverage of an empty track is 0', () => {
    expect(routeCoverage(route, [])).toBe(0);
  });
});
