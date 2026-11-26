import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  naqi, bandOf, AirField, streetFactor, streetFactors, doseUg, parseOpenMeteo, cleanestWindow, encodeAir, BREATHING,
} from '../../shared/air.ts';
import { airEdgeDeltas, liveEdgeDeltas, REPORT_KINDS, isAirReport, type LiveReport } from '../../shared/live.ts';
import { delhi, ist } from '../helpers.ts';

const { g, router, pois } = delhi();
const air = new AirField(readFileSync('web/public/data/air.bin'));
const factor = streetFactors(g, air);

describe('Indian National AQI (CPCB)', () => {
  it('TC-150 PM2.5 breakpoints map to the right bands', () => {
    expect(naqi(20).band).toBe('good');
    expect(naqi(30).value).toBe(50);
    expect(naqi(60).value).toBe(100);
    expect(naqi(45).band).toBe('satisfactory');
    expect(naqi(90).value).toBe(200);
    expect(naqi(100).band).toBe('poor');
    expect(naqi(200).band).toBe('verypoor');
    expect(naqi(300).band).toBe('severe');
    expect(naqi(900).value).toBe(500);
  });
  it('TC-151 the worse of PM2.5 and PM10 sets the AQI', () => {
    const a = naqi(40, 300); // PM10 300 is Poor, PM2.5 40 is Satisfactory
    expect(a.main).toBe('PM10');
    expect(a.band).toBe('poor');
    expect(bandOf(0)).toBe('good');
    expect(bandOf(450)).toBe('severe');
  });
});

describe('Open-Meteo forecast parsing', () => {
  const hours = Array.from({ length: 48 }, (_, i) => `2026-11-26T${String(i % 24).padStart(2, '0')}:00`.replace('26T', i < 24 ? '26T' : '27T'));
  const pm = hours.map((_, i) => 100 + 80 * Math.cos(((i % 24) - 6) / 24 * 2 * Math.PI));
  const j = { utc_offset_seconds: 19800, current: { pm2_5: 210, pm10: 330 }, hourly: { time: hours, pm2_5: pm, pm10: pm.map((x) => x * 1.6) } };
  it('TC-152 picks the current hour (IST) and the next 24 hours', () => {
    const a = parseOpenMeteo(j, new Date('2026-11-26T04:40:00Z'))!; // 10:10 IST
    expect(a.at).toBe('2026-11-26T10:00');
    expect(a.hours).toHaveLength(24);
    expect(a.pm25).toBe(210);
    expect(a.aqi.band).toBe('verypoor');
  });
  it('TC-153 cleanest window falls in the afternoon for a winter-shaped day', () => {
    const a = parseOpenMeteo(j, new Date('2026-11-26T00:30:00Z'))!;
    const w = cleanestWindow(a.hours, 2)!;
    const h = Number(w.start.slice(11, 13));
    expect(h).toBeGreaterThanOrEqual(15);
    expect(h).toBeLessThanOrEqual(20);
  });
  it('TC-154 rejects empty or broken responses', () => {
    expect(parseOpenMeteo({})).toBeNull();
    expect(parseOpenMeteo({ hourly: { time: ['x'], pm2_5: [null], pm10: [null] } })).toBeNull();
  });
});

describe('street air field', () => {
  it('TC-155 air.bin matches the graph and round-trips', () => {
    expect(air.a.indM.length).toBe(g.m);
    expect(air.meta.areas).toContain('Ghazipur landfill');
    expect(air.meta.areas.some((a) => /Wazirpur/.test(a))).toBe(true);
    const tiny = encodeAir({ indM: Uint8Array.of(0, 50), majM: Uint8Array.of(0, 10), dumpM: Uint8Array.of(255, 1), area: Int16Array.of(-1, 0) }, { areas: ['X'], cellM: 50, source: 't' });
    const back = new AirField(tiny);
    expect(back.indM(1)).toBe(500);
    expect(back.areaName(1)).toBe('X');
    expect(back.areaName(0)).toBe('');
  });
  it('TC-156 streets in an industrial estate and next to a landfill score dirtier than quiet streets', () => {
    const [wz] = g.edgesNear(77.1667, 28.6994, 150); // Wazirpur Industrial Area
    const [gz] = g.edgesNear(77.3268, 28.6237, 400); // Ghazipur landfill
    expect(air.indM(wz)).toBeLessThanOrEqual(100);
    expect(streetFactor(g, air, wz)).toBeGreaterThan(1.2);
    expect(streetFactor(g, air, gz)).toBeGreaterThan(1.3);
    let quiet = 0;
    for (let e = 0; e < g.m; e++) if (factor[e] < 1.05) quiet++;
    expect(quiet / g.m).toBeGreaterThan(0.2);
    for (const v of factor) { expect(v).toBeGreaterThanOrEqual(0.69); expect(v).toBeLessThanOrEqual(2.21); }
  });
  it('TC-157 dose grows with time, PM and breathing; closed cars let in less', () => {
    expect(doseUg(100, 1, 3600, 'walk')).toBeCloseTo(140);
    expect(doseUg(200, 1, 3600, 'walk')).toBeCloseTo(280);
    expect(doseUg(100, 1.5, 1800, 'walk')).toBeCloseTo(105);
    expect(doseUg(100, 1, 3600, 'car')).toBeLessThan(doseUg(100, 1, 3600, 'twowheeler'));
    expect(BREATHING.walk.m3h).toBeGreaterThan(BREATHING.car.m3h);
  });
});

describe('clean-air routing', () => {
  const when = ist('09:30');
  const plan = (from: [number, number], to: [number, number], mode: 'walk' | 'auto' | 'car' | 'twowheeler', f = factor) =>
    router.route({ from, to, mode, when, ctx: { when, profile: 'woman', pois, crowd: new Map(), live: new Map() }, air: { field: air, factor: f, pm25: 180 } });

  it('TC-158 every route carries an air score and exactly one route is the cleanest', () => {
    const r = plan([77.13, 28.635], [77.085, 28.625], 'auto');
    expect(r.routes.length).toBeGreaterThan(0);
    for (const x of r.routes) { expect(x.air).toBeDefined(); expect(x.air!.doseUg).toBeGreaterThan(0); }
    const tags = r.routes.flatMap((x) => x.labels).filter((l) => l === 'Cleanest air' || l === 'Also cleanest');
    expect(tags).toHaveLength(1);
    const fastest = r.routes.find((x) => x.labels.includes('Fastest'))!;
    expect(fastest.air!.pctVsFastest).toBe(0);
    const clean = r.routes.find((x) => x.labels.includes('Cleanest air'));
    if (clean) {
      expect(clean.air!.doseUg).toBeLessThan(fastest.air!.doseUg);
      expect(clean.air!.pctVsFastest).toBeGreaterThanOrEqual(3);
    }
  });
  it('TC-159 the cleanest route has the lowest dose of all routes offered', () => {
    for (const [f, t, m] of [[[77.13, 28.635], [77.085, 28.625], 'auto'], [[77.2197, 28.6328], [77.2295, 28.6129], 'walk'], [[77.334, 28.61], [77.316, 28.647], 'twowheeler']] as const) {
      const r = plan(f as [number, number], t as [number, number], m);
      const c = r.routes.find((x) => x.labels.includes('Cleanest air') || x.labels.includes('Also cleanest'))!;
      for (const x of r.routes) expect(c.air!.doseUg).toBeLessThanOrEqual(x.air!.doseUg + 1e-6);
    }
  });
  it('TC-160 a garbage-burning report makes the clean route avoid that street', () => {
    const from: [number, number] = [77.2197, 28.6328], to: [number, number] = [77.2295, 28.6129];
    const base = plan(from, to, 'walk');
    const fastest = base.routes.find((x) => x.labels.includes('Fastest'))!;
    const mid = fastest.coords[Math.floor(fastest.coords.length / 2)];
    const T = when.getTime();
    const reports: LiveReport[] = [{ id: 'b', kind: 'burning', lon: mid[0], lat: mid[1], createdAt: T, expiresAt: T + 6 * 3600000, confirms: 3, dismisses: 0 }];
    const live = airEdgeDeltas(g, reports, T);
    expect(live.size).toBeGreaterThan(0);
    const f2 = streetFactors(g, air, { live });
    const after = plan(from, to, 'walk', f2);
    const fastAfter = after.routes.find((x) => x.labels.includes('Fastest'))!;
    expect(fastAfter.air!.doseUg).toBeGreaterThan(fastest.air!.doseUg);
    // burning does not make streets "unsafe"
    expect(liveEdgeDeltas(g, reports, T).size).toBe(0);
  });
  it('TC-161 air report kinds exist and do not count as danger', () => {
    for (const k of ['burning', 'dust', 'smoke'] as const) {
      expect(isAirReport(k)).toBe(true);
      expect(REPORT_KINDS[k].danger).toBe(false);
      expect(REPORT_KINDS[k].weight).toBe(0);
    }
    expect(isAirReport('harassment')).toBe(false);
  });
});
