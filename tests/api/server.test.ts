import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../../server/app.ts';
import { openDb } from '../../server/db.ts';
import { haversine, type LonLat } from '../../shared/geo.ts';
import { delhi, ist, TRIPS } from '../helpers.ts';

const DEV_A = 'device-aaaaaaaaaaaaaaaa', DEV_B = 'device-bbbbbbbbbbbbbbbb';
let clock = Date.UTC(2026, 10, 6, 15, 0);
let server: Server, base = '';

async function call(method: string, path: string, body?: unknown, device: string | null = DEV_A, raw?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (device) headers['x-device-id'] = device;
  const r = await fetch(base + path, { method, headers, body: raw ?? (body ? JSON.stringify(body) : undefined) });
  return { status: r.status, body: await r.json().catch(() => null) };
}

// a real planned route and an honest walking track along it
const { router, pois } = delhi();
const when = ist('20:00');
const plan = router.route({ ...TRIPS.cpIndiaGate, mode: 'walk', when, ctx: { when, profile: 'woman', pois } });
const route = plan.routes[0];
function track(coords: LonLat[], t0: number, speed = 1.3, stepM = 15) {
  const out: { lon: number; lat: number; acc: number; t: number }[] = [];
  let t = t0;
  for (let i = 1; i < coords.length; i++) {
    const [a, b] = [coords[i - 1], coords[i]];
    const d = haversine(a[0], a[1], b[0], b[1]);
    const n = Math.max(1, Math.ceil(d / stepM));
    for (let k = 0; k < n; k++) {
      const f = k / n;
      out.push({ lon: a[0] + (b[0] - a[0]) * f, lat: a[1] + (b[1] - a[1]) * f, acc: 6, t: Math.round(t) });
      t += (d / n / speed) * 1000;
    }
  }
  const end = coords[coords.length - 1];
  out.push({ lon: end[0], lat: end[1], acc: 6, t: Math.round(t) });
  return out;
}
async function startJourney(device = DEV_A, extra: Record<string, unknown> = {}) {
  const r = await call('POST', '/api/journeys', {
    mode: 'walk', route: route.coords, edges: route.edges, dest: route.coords[route.coords.length - 1],
    etaS: route.timeS, graphVersion: 'test', name: 'Riya', ...extra,
  }, device);
  expect(r.status).toBe(200);
  return r.body as { id: string; token: string; shareId: string };
}
async function honestTrip(device = DEV_A) {
  const j = await startJourney(device);
  const fixes = track(route.coords, clock);
  clock = fixes[fixes.length - 1].t + 30000;
  for (let i = 0; i < fixes.length; i += 400) {
    const r = await call('POST', `/api/journeys/${j.id}/fixes`, { token: j.token, fixes: fixes.slice(i, i + 400) }, device);
    expect(r.status).toBe(200);
  }
  const fin = await call('POST', `/api/journeys/${j.id}/finish`, { token: j.token }, device);
  return { j, fin: fin.body };
}

beforeAll(async () => {
  server = createApp({ db: openDb(':memory:'), graphVersion: 'test', now: () => clock, staticDir: 'web/public' });
  await new Promise<void>((res) => server.listen(0, res));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

describe('journeys and reviews', () => {
  it('TC-60 an honest trip is verified and gets a review token', async () => {
    const { fin } = await honestTrip();
    expect(fin.arrived).toBe(true);
    expect(fin.eligible).toBe(true);
    expect(fin.coverage).toBeGreaterThan(0.9);
    expect(typeof fin.reviewToken).toBe('string');
  });

  it('TC-61..65 review rules', async () => {
    const { j, fin } = await honestTrip();
    const ok = { journeyId: j.id, reviewToken: fin.reviewToken, rating: 2, tags: ['dark', 'deserted', 'not_a_tag'], comment: 'Street lights off near the park' };
    for (const bad of [0, 6, 3.5, '5']) expect((await call('POST', '/api/reviews', { ...ok, rating: bad })).status).toBe(400); // TC-65
    expect((await call('POST', '/api/reviews', ok, DEV_B)).status).toBe(403); // TC-63 other device
    expect((await call('POST', '/api/reviews', { ...ok, reviewToken: 'nope' })).status).toBe(403); // TC-64
    expect((await call('POST', '/api/reviews', ok)).status).toBe(200); // TC-61
    expect((await call('POST', '/api/reviews', ok)).status).toBe(409); // TC-62
    const crowd = await call('GET', '/api/crowd?v=test');
    expect(crowd.body.stats.length).toBeGreaterThan(10);
  });

  it('TC-64 an unverified trip cannot be reviewed', async () => {
    const j = await startJourney();
    const fin = await call('POST', `/api/journeys/${j.id}/finish`, { token: j.token });
    expect(fin.body.eligible).toBe(false);
    expect(fin.body.reviewToken).toBeNull();
    expect((await call('POST', '/api/reviews', { journeyId: j.id, reviewToken: null, rating: 1 })).status).toBe(403);
  });

  it('TC-66 one vote per device per street, however many trips', async () => {
    const before = (await call('GET', '/api/crowd?v=test')).body.stats as [number, number, number][];
    const e = route.edges[3];
    const n0 = before.find((s) => s[0] === e)?.[1] ?? 0;
    for (let i = 0; i < 2; i++) {
      const { j, fin } = await honestTrip(DEV_B);
      expect((await call('POST', '/api/reviews', { journeyId: j.id, reviewToken: fin.reviewToken, rating: 5 }, DEV_B)).status).toBe(200);
    }
    const after = (await call('GET', '/api/crowd?v=test')).body.stats as [number, number, number][];
    expect(after.find((s) => s[0] === e)![1]).toBeCloseTo(n0 + 1, 1);
  });

  it('TC-67 votes decay with a 90-day half-life', async () => {
    const e = route.edges[3];
    const now = (await call('GET', '/api/crowd?v=test')).body.stats.find((s: number[]) => s[0] === e)[1];
    clock += 90 * 86400000;
    const later = (await call('GET', '/api/crowd?v=test')).body.stats.find((s: number[]) => s[0] === e)[1];
    expect(later).toBeCloseTo(now / 2, 1);
  });

  it('TC-68 demo (simulated) trips are never eligible', async () => {
    const j = await startJourney(DEV_A, { simulated: true });
    const fixes = track(route.coords, clock);
    clock = fixes[fixes.length - 1].t + 30000;
    await call('POST', `/api/journeys/${j.id}/fixes`, { token: j.token, fixes: fixes.slice(0, 400) });
    await call('POST', `/api/journeys/${j.id}/fixes`, { token: j.token, fixes: fixes.slice(400) });
    const fin = await call('POST', `/api/journeys/${j.id}/finish`, { token: j.token });
    expect(fin.body.eligible).toBe(false);
    expect(fin.body.reasons[0]).toMatch(/demo trip/);
  });

  it('TC-69 live share follows the trip, then SOS and arrival', async () => {
    const j = await startJourney();
    const fixes = track(route.coords, clock).slice(0, 30);
    clock = fixes[fixes.length - 1].t + 1000;
    await call('POST', `/api/journeys/${j.id}/fixes`, { token: j.token, fixes });
    let s = await call('GET', `/api/share/${j.shareId}`, undefined, null);
    expect(s.status).toBe(200);
    expect(s.body.status).toBe('active');
    expect(s.body.name).toBe('Riya');
    expect(s.body.last.t).toBe(fixes[fixes.length - 1].t);
    expect((await call('POST', `/api/journeys/${j.id}/sos`, { token: j.token, contacts: ['9876543210'], message: 'help' })).body.smsSent).toBe(0);
    s = await call('GET', `/api/share/${j.shareId}`, undefined, null);
    expect(s.body.status).toBe('sos');
    expect((await call('POST', `/api/journeys/${j.id}/sos`, { token: 'wrong' })).status).toBe(403);
  });

  it('TC-70 fixes from the future or before the start are dropped', async () => {
    const j = await startJourney();
    const r = await call('POST', `/api/journeys/${j.id}/fixes`, { token: j.token, fixes: [
      { lon: 77.22, lat: 28.63, acc: 5, t: clock + 3600000 },
      { lon: 77.22, lat: 28.63, acc: 5, t: clock - 3600000 },
      { lon: 77.22, lat: 28.63, acc: 5, t: clock },
      { lon: 'x', lat: 28.63, acc: 5, t: clock + 1 },
    ] });
    expect(r.body.stored).toBe(1);
  });
});

describe('input safety (NFR-5)', () => {
  it('TC-71 bad JSON, huge bodies, missing device, unknown endpoints', async () => {
    expect((await call('POST', '/api/journeys', undefined, DEV_A, '{nope')).status).toBe(400);
    expect((await call('POST', '/api/journeys', undefined, DEV_A, JSON.stringify({ pad: 'x'.repeat(600 * 1024) }))).status).toBe(413);
    expect((await call('POST', '/api/journeys', { mode: 'walk' }, null)).status).toBe(400);
    expect((await call('GET', '/api/nothing-here')).status).toBe(404);
  });
  it('TC-74 invalid journey fields', async () => {
    const good = { mode: 'walk', route: route.coords, edges: route.edges, dest: route.coords[1], etaS: 600 };
    for (const bad of [{ mode: 'rocket' }, { route: [[1, 2]] }, { route: [[500, 2], [1, 2]] }, { edges: [-1] }, { dest: 'home' }, { etaS: 0 }, { etaS: 99999 }])
      expect((await call('POST', '/api/journeys', { ...good, ...bad })).status).toBe(400);
  });
  it('TC-73 static files cannot escape the web root', async () => {
    for (const p of ['/../server/app.ts', '/%2e%2e/server/app.ts', '/data/../../server/app.ts']) {
      const r = await fetch(base + p);
      const text = await r.text();
      expect(text).not.toContain('createServer');
    }
    expect((await fetch(base + '/data/version.json')).status).toBe(200);
  });
  it('TC-76 CORS only for the native app origins', async () => {
    const pre = await fetch(base + '/api/journeys', { method: 'OPTIONS', headers: { origin: 'capacitor://localhost' } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe('capacitor://localhost');
    const evil = await fetch(base + '/api/health', { headers: { origin: 'https://evil.example' } });
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
  });
  it('TC-75 unknown share id', async () => {
    expect((await call('GET', '/api/share/doesnotexist', undefined, null)).status).toBe(404);
  });
  it('TC-72 rate limiting', async () => {
    const limited = createApp({ db: openDb(':memory:'), graphVersion: 't', rateLimitPerMin: 5 });
    await new Promise<void>((res) => limited.listen(0, res));
    const u = `http://127.0.0.1:${(limited.address() as AddressInfo).port}/api/health`;
    const codes = [];
    for (let i = 0; i < 8; i++) codes.push((await fetch(u)).status);
    limited.close();
    expect(codes.slice(0, 5).every((c) => c === 200)).toBe(true);
    expect(codes).toContain(429);
  });
});
