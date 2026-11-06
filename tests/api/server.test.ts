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
let db: ReturnType<typeof openDb>;

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
  db = openDb(':memory:');
  server = createApp({ db, graphVersion: 'test', now: () => clock, staticDir: 'web/public' });
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
    expect((await call('POST', '/api/reviews', ok)).status).toBe(403); // TC-62: answered once; the trip's data is already erased
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

describe('live safety reports', () => {
  const spot = TRIPS.lajpatSoami.from;
  const at = (dx = 0, acc = 10) => ({ lon: spot[0] + dx, lat: spot[1], acc });
  const DEV_C = 'device-cccccccccccccccc', DEV_D = 'device-dddddddddddddddd';
  it('TC-110 a traveller near the spot can report; far away is refused', async () => {
    const far = await call('POST', '/api/reports', { kind: 'dark', lon: spot[0], lat: spot[1], at: at(0.01) }, DEV_C);
    expect(far.status).toBe(403);
    const bad = await call('POST', '/api/reports', { kind: 'aliens', lon: spot[0], lat: spot[1], at: at() }, DEV_C);
    expect(bad.status).toBe(400);
    const ok = await call('POST', '/api/reports', { kind: 'dark', lon: spot[0], lat: spot[1], at: at() }, DEV_C);
    expect(ok.status).toBe(200);
    expect(ok.body.merged).toBe(false);
    const list = await call('GET', `/api/reports?bbox=${spot[0] - 0.01},${spot[1] - 0.01},${spot[0] + 0.01},${spot[1] + 0.01}`, undefined, null);
    const r = list.body.reports.find((x: any) => x.id === ok.body.id);
    expect(r).toMatchObject({ kind: 'dark', confirms: 1, dismisses: 0 });
    expect(r.expiresAt - r.createdAt).toBe(12 * 3600000);
  });
  it('TC-111 the same problem reported close by merges into one report', async () => {
    const a = await call('POST', '/api/reports', { kind: 'drunk', lon: spot[0], lat: spot[1], at: at() }, DEV_C);
    const b = await call('POST', '/api/reports', { kind: 'drunk', lon: spot[0] + 0.0004, lat: spot[1], at: at(0.0004) }, DEV_D);
    expect(b.body.merged).toBe(true);
    expect(b.body.id).toBe(a.body.id);
    const list = await call('GET', `/api/reports?bbox=${spot[0] - 0.01},${spot[1] - 0.01},${spot[0] + 0.01},${spot[1] + 0.01}`, undefined, null);
    expect(list.body.reports.filter((x: any) => x.kind === 'drunk')).toHaveLength(1);
    expect(list.body.reports.find((x: any) => x.kind === 'drunk').confirms).toBe(2);
  });
  it('TC-112 "gone" votes hide a report once they outnumber confirmations; voters must be near', async () => {
    const a = await call('POST', '/api/reports', { kind: 'dogs', lon: spot[0], lat: spot[1], at: at() }, DEV_C);
    const far = await call('POST', `/api/reports/${a.body.id}/vote`, { still: false, at: at(0.02) }, DEV_D);
    expect(far.status).toBe(403);
    expect((await call('POST', `/api/reports/${a.body.id}/vote`, { still: 'no', at: at() }, DEV_D)).status).toBe(400);
    expect((await call('POST', `/api/reports/${a.body.id}/vote`, { still: false, at: at() }, DEV_D)).status).toBe(200);
    expect((await call('POST', `/api/reports/${a.body.id}/vote`, { still: false, at: at() }, DEV_A)).status).toBe(200);
    const list = await call('GET', `/api/reports?bbox=${spot[0] - 0.01},${spot[1] - 0.01},${spot[0] + 0.01},${spot[1] + 0.01}`, undefined, null);
    expect(list.body.reports.find((x: any) => x.id === a.body.id)).toBeUndefined();
  });
  it('TC-113 reports expire, and one device cannot flood', async () => {
    const DEV_E = 'device-eeeeeeeeeeeeeeee';
    const codes: number[] = [];
    for (let i = 0; i < 8; i++) {
      const lon = spot[0] + i * 0.0015;
      codes.push((await call('POST', '/api/reports', { kind: 'followed', lon, lat: spot[1], at: { lon, lat: spot[1], acc: 5 } }, DEV_E)).status);
    }
    expect(codes.filter((c) => c === 200)).toHaveLength(6);
    expect(codes).toContain(429);
    clock += 3 * 3600000; // "followed" lasts 2 h
    const list = await call('GET', `/api/reports?bbox=${spot[0] - 0.02},${spot[1] - 0.02},${spot[0] + 0.03},${spot[1] + 0.02}`, undefined, null);
    expect(list.body.reports.filter((x: any) => x.kind === 'followed')).toHaveLength(0);
    expect((await call('GET', '/api/reports?bbox=1,2', undefined, null)).status).toBe(400);
  });
  it('TC-114 a re-route mid-journey replaces the route used for verification', async () => {
    const j = await startJourney();
    const alt = plan.routes[plan.routes.length - 1];
    const bad = await call('POST', `/api/journeys/${j.id}/route`, { token: 'wrong', route: alt.coords, edges: alt.edges, etaS: alt.timeS });
    expect(bad.status).toBe(403);
    const ok = await call('POST', `/api/journeys/${j.id}/route`, { token: j.token, route: alt.coords, edges: alt.edges, etaS: alt.timeS });
    expect(ok.status).toBe(200);
    const sh = await call('GET', `/api/share/${j.shareId}`, undefined, null);
    expect(sh.body.route).toEqual(alt.coords);
    expect(sh.body.etaS).toBe(alt.timeS);
    expect((await call('POST', `/api/journeys/${j.id}/route`, { token: j.token, route: [[1, 2]], edges: [], etaS: 10 })).status).toBe(400);
  });
});

describe('privacy: nothing about a trip is kept after it ends', () => {
  const rows = (sql: string, ...a: unknown[]) => db.prepare(sql).all(...(a as never[])) as any[];
  it('TC-130 ending a trip deletes its GPS points and erases route, destination and name at once', async () => {
    const { j, fin } = await honestTrip();
    expect(fin.eligible).toBe(true);
    expect(rows('SELECT COUNT(*) AS n FROM fixes WHERE journey_id = ?', j.id)[0].n).toBe(0);
    const [row] = rows('SELECT * FROM journeys WHERE id = ?', j.id);
    expect(row.route_json).toBe('[]');
    expect([row.dest_lon, row.dest_lat]).toEqual([0, 0]);
    expect(row.traveller_name).toBeNull();
    const sh = await call('GET', `/api/share/${j.shareId}`, undefined, null);
    expect(sh.body).toMatchObject({ status: 'arrived', route: [], dest: null, last: null, name: null });
    // and no location can be added to a finished trip
    const late = await call('POST', `/api/journeys/${j.id}/fixes`, { token: j.token, fixes: [{ lon: 77.2, lat: 28.6, acc: 5, t: clock }] });
    expect(late.status).toBe(409);
    expect((await call('POST', `/api/journeys/${j.id}/finish`, { token: j.token })).status).toBe(409);
  });
  it('TC-131 answering the questions erases the trip; the vote is anonymous and day-rounded', async () => {
    const { j, fin } = await honestTrip(DEV_B);
    const r = await call('POST', '/api/reviews', { journeyId: j.id, reviewToken: fin.reviewToken, rating: 1, tags: ['dark'], comment: 'secret' }, DEV_B);
    expect(r.status).toBe(200);
    // only a bare status for the family's link remains: no route, streets, device or name
    const [left] = rows('SELECT * FROM journeys WHERE id = ?', j.id);
    expect(left).toMatchObject({ route_json: '[]', edges_json: '[]', device: '', traveller_name: null, dest_lon: 0, dest_lat: 0 });
    const votes = rows('SELECT device, tags, updated_at FROM edge_votes WHERE rating = 1');
    expect(votes.length).toBeGreaterThan(0);
    for (const v of votes) {
      expect(v.device).not.toBe(DEV_B);
      expect(v.updated_at % 86400000).toBe(0);
      expect(v.tags).toBe('dark');
    }
    // no table keeps comments or links an answer to a trip
    expect(rows("SELECT name FROM sqlite_master WHERE name = 'reviews'")).toHaveLength(0);
    expect(JSON.stringify(rows('SELECT * FROM edge_votes'))).not.toContain('secret');
  });
  it('TC-132 report and vote pseudonyms cannot be linked, and differ from the phone id', async () => {
    const spot = TRIPS.cpIndiaGate.from;
    const at = { lon: spot[0], lat: spot[1], acc: 5 };
    expect((await call('POST', '/api/reports', { kind: 'dark', lon: spot[0], lat: spot[1], at }, DEV_B)).status).toBe(200);
    const rep = rows('SELECT device FROM reports ORDER BY created_at DESC LIMIT 1')[0].device;
    const votesB = new Set(rows('SELECT device FROM edge_votes WHERE rating = 1').map((v) => v.device));
    expect(rep).not.toBe(DEV_B);
    expect(votesB.has(rep)).toBe(false);
  });
  it('TC-133 an unanswered trip is deleted after an hour; an abandoned one after 12 h; expired reports go too', async () => {
    const { j } = await honestTrip();
    const open = await startJourney();
    clock += 61 * 60000;
    await call('GET', '/api/share/none', undefined, null); // any share lookup runs the clean-up
    expect(rows('SELECT * FROM journeys WHERE id = ?', j.id)).toHaveLength(0);
    expect(rows('SELECT * FROM journeys WHERE id = ?', open.id)).toHaveLength(1); // still travelling
    clock += 12 * 3600000;
    await call('GET', '/api/share/none', undefined, null);
    expect(rows('SELECT * FROM journeys WHERE id = ?', open.id)).toHaveLength(0);
    expect(rows('SELECT COUNT(*) AS n FROM reports WHERE expires_at <= ?', clock)[0].n).toBe(0);
    expect(rows('SELECT COUNT(*) AS n FROM fixes')[0].n).toBe(0);
  });
});

