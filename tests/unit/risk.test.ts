import { describe, it, expect } from 'vitest';
import { computeRisk, crowdDanger, MIN_REVIEWS_WARN, MIN_REVIEWS_SAFE } from '../../shared/risk.ts';
import { ROAD_CLASSES, RC } from '../../shared/modes.ts';
import { delhi, ist } from '../helpers.ts';

const { g, pois } = delhi();
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

describe('risk model (FR-5)', () => {
  const day = computeRisk(g, { when: ist('13:00'), profile: 'woman', pois });
  const night = computeRisk(g, { when: ist('23:30'), profile: 'woman', pois });

  it('TC-10 night is riskier than day on almost every street', () => {
    let higher = 0;
    for (let e = 0; e < g.m; e++) if (night.risk[e] > day.risk[e]) higher++;
    expect(higher / g.m).toBeGreaterThan(0.95);
  });

  it('TC-11 at night main roads < lanes < footpaths', () => {
    const by = (cls: string) => { const v: number[] = []; for (let e = 0; e < g.m; e++) if (ROAD_CLASSES[g.a.edgeClass[e]] === cls) v.push(night.risk[e]); return median(v); };
    expect(by('primary')).toBeLessThan(by('residential'));
    expect(by('residential')).toBeLessThan(by('footway'));
  });

  it('TC-12 open safe places lower risk', () => {
    const closed = pois.map((p) => ({ ...p, oh: 'Mo 00:00-00:01', cat: p.cat === 'police' || p.cat === 'hospital' ? 'shop' as const : p.cat }));
    const r1 = computeRisk(g, { when: ist('20:00'), profile: 'woman', pois });
    const r2 = computeRisk(g, { when: ist('20:00'), profile: 'woman', pois: closed });
    let e = 0;
    while (g.edgePois(e).length < 3) e++;
    expect(r1.risk[e]).toBeLessThan(r2.risk[e]);
  });

  it('TC-13 an open liquor outlet raises night risk', () => {
    let e = 0;
    while (!(g.edgePois(e).length === 1 && pois[g.edgePois(e)[0]].cat === 'shop')) e++;
    const pid = g.edgePois(e)[0];
    const withShop = pois.map((p) => (p.id === pid ? { ...p, oh: '24/7' } : p));
    const withBar = pois.map((p) => (p.id === pid ? { ...p, cat: 'liquor' as const, oh: '24/7' } : p));
    const a = computeRisk(g, { when: ist('22:30'), profile: 'woman', pois: withShop }).risk[e];
    const b = computeRisk(g, { when: ist('22:30'), profile: 'woman', pois: withBar }).risk[e];
    expect(b).toBeGreaterThan(a);
  });

  it('TC-14/15 crowd reviews only count after enough distinct travellers', () => {
    expect(crowdDanger({ n: MIN_REVIEWS_WARN - 1, mean: 1 })).toBe(0);
    expect(crowdDanger({ n: MIN_REVIEWS_WARN, mean: 1 })).toBeGreaterThan(0);
    expect(crowdDanger({ n: MIN_REVIEWS_WARN, mean: 5 })).toBe(0); // "safe" needs more votes
    expect(crowdDanger({ n: MIN_REVIEWS_SAFE, mean: 5 })).toBeLessThan(0);
    const e = 1234;
    const base = computeRisk(g, { when: ist('23:00'), profile: 'woman', pois }).risk[e];
    const warned = computeRisk(g, { when: ist('23:00'), profile: 'woman', pois, crowd: new Map([[e, { n: 8, mean: 1.5 }]]) }).risk[e];
    const few = computeRisk(g, { when: ist('23:00'), profile: 'woman', pois, crowd: new Map([[e, { n: 3, mean: 1 }]]) }).risk[e];
    expect(warned).toBeGreaterThan(base);
    expect(few).toBe(base);
  });

  it('TC-16 the child profile weighs traffic on big roads', () => {
    const woman = computeRisk(g, { when: ist('16:00'), profile: 'woman', pois });
    const child = computeRisk(g, { when: ist('16:00'), profile: 'child', pois });
    let e = 0;
    while (g.a.edgeClass[e] !== RC.trunk) e++;
    expect(child.risk[e]).toBeGreaterThan(woman.risk[e]);
  });

  it('TC-17 every risk is within [0, 1] at all hours', () => {
    for (const t of ['00:30', '05:45', '09:00', '18:30', '20:00', '22:15']) {
      const r = computeRisk(g, { when: ist(t), profile: 'child', pois });
      for (let e = 0; e < g.m; e++) {
        if (!(r.risk[e] >= 0 && r.risk[e] <= 1)) throw new Error(`edge ${e} at ${t}: ${r.risk[e]}`);
      }
    }
  });
});
