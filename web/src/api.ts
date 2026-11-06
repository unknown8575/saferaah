// Server API client. The app keeps working without a server (planning,
// navigation, SOS links); live sharing and verified reviews need it.
import { deviceId } from './store.ts';
import type { Fix } from '../../shared/journey.ts';
import type { LonLat } from '../../shared/geo.ts';
import type { Mode } from '../../shared/modes.ts';
import type { LiveReport, ReportKind } from '../../shared/live.ts';

/** Server address. Empty = same origin (web). Native apps set VITE_API_BASE at build time. */
export const API_BASE = ((import.meta.env.VITE_API_BASE as string | undefined) ?? '').replace(/\/$/, '');
const url = (path: string) => (API_BASE ? `${API_BASE}/${path}` : path);

let online: boolean | null = null;
let smsOnServer = false;

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(url(path), {
    method,
    headers: { 'content-type': 'application/json', 'x-device-id': deviceId() },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error ?? `Server error ${r.status}`);
  return data as T;
}

export async function checkServer(): Promise<boolean> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 3000);
    const r = await fetch(url('api/health'), { signal: ctl.signal });
    clearTimeout(t);
    const d = r.ok ? await r.json() : null;
    online = !!d?.ok;
    smsOnServer = !!d?.sms;
  } catch {
    online = false;
  }
  return online;
}
export const isOnline = () => online === true;
export const serverSms = () => smsOnServer;

export interface JourneyHandle { id: string; token: string; shareId: string }

export const api = {
  crowd: (v: string) => call<{ v: string; stats: [number, number, number][] }>('GET', `api/crowd?v=${encodeURIComponent(v)}`),
  startJourney: (b: { mode: Mode; route: LonLat[]; edges: number[]; dest: LonLat; etaS: number; graphVersion: string; name?: string; simulated?: boolean }) =>
    call<JourneyHandle>('POST', 'api/journeys', b),
  pushFixes: (j: JourneyHandle, fixes: Fix[]) => call<{ ok: boolean }>('POST', `api/journeys/${j.id}/fixes`, { token: j.token, fixes }),
  finish: (j: JourneyHandle) =>
    call<{ arrived: boolean; eligible: boolean; coverage: number; reasons: string[]; reviewToken: string | null }>(
      'POST', `api/journeys/${j.id}/finish`, { token: j.token }),
  sos: (j: JourneyHandle, contacts: string[], message: string) =>
    call<{ ok: boolean; smsSent: number }>('POST', `api/journeys/${j.id}/sos`, { token: j.token, contacts, message }),
  notify: (j: JourneyHandle, contacts: string[], message: string) =>
    call<{ ok: boolean; smsSent: number }>('POST', `api/journeys/${j.id}/notify`, { token: j.token, contacts, message }),
  review: (journeyId: string, reviewToken: string, rating: number, tags: string[]) =>
    call<{ ok: boolean }>('POST', 'api/reviews', { journeyId, reviewToken, rating, tags }),
  share: (shareId: string) => call<any>('GET', `api/share/${encodeURIComponent(shareId)}`),
  reroute: (j: JourneyHandle, route: LonLat[], edges: number[], etaS: number) =>
    call<{ ok: boolean }>('POST', `api/journeys/${j.id}/route`, { token: j.token, route, edges, etaS }),
  reports: (bbox: [number, number, number, number]) =>
    call<{ now: number; reports: LiveReport[] }>('GET', `api/reports?bbox=${bbox.map((x) => x.toFixed(4)).join(',')}`),
  report: (kind: ReportKind, spot: LonLat, at: { lon: number; lat: number; acc: number }) =>
    call<{ ok: boolean; id: string; merged: boolean }>('POST', 'api/reports', { kind, lon: spot[0], lat: spot[1], at }),
  voteReport: (id: string, still: boolean, at: { lon: number; lat: number; acc: number }) =>
    call<{ ok: boolean }>('POST', `api/reports/${encodeURIComponent(id)}/vote`, { still, at }),
};

// ---------- live reports: the SafeRaah server, or the hosted preview's shared store ----------
// The hosted preview page has no SafeRaah server, but its host offers a small shared
// database. There the same rules the server enforces (near the spot, merge duplicates,
// a few reports per hour) are applied in the app, so the preview still shows live
// reports from everyone who opens it.
type Store = { collection(p: string): any; doc(p: string): any };
let store: Store | null = null;
export async function initPreviewStore(): Promise<boolean> {
  const c = (window as unknown as { claude?: { use?: (n: string) => Promise<unknown> } }).claude;
  if (!c?.use) return false;
  try { store = (await c.use('db')) as Store | null; } catch { store = null; }
  return !!store;
}
export const liveAvailable = () => isOnline() || !!store;
export const livePreview = () => !isOnline() && !!store;

const R_EARTH = 6371008.8;
function dist(a: [number, number], b: [number, number]) {
  const r = Math.PI / 180, dLat = (b[1] - a[1]) * r, dLon = (b[0] - a[0]) * r;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(s));
}
const HOURS: Record<string, number> = { dark: 12, deserted: 3, harassment: 6, drunk: 3, followed: 2, dogs: 6, police: 2 };

/** A one-way id for the shared store, so reports cannot be traced back to this phone's id. */
async function anonId(): Promise<string> {
  const data = new TextEncoder().encode(`saferaah-preview:${deviceId()}`);
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return [...h.slice(0, 10)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const live = {
  async list(bbox: [number, number, number, number]): Promise<{ now: number; reports: LiveReport[] }> {
    if (isOnline() || !store) return api.reports(bbox);
    const now = Date.now();
    const [rs, vs] = await Promise.all([
      store.collection('reports').where('expiresAt', '>', now).limit(500).get(),
      store.collection('votes').where('at', '>', now - 13 * 3600000).limit(1000).get(),
    ]);
    const tally = new Map<string, { c: number; d: number }>();
    for (const v of vs.docs) {
      const x = v.data();
      const t = tally.get(x.report) ?? { c: 0, d: 0 };
      if (x.still) t.c++; else t.d++;
      tally.set(x.report, t);
    }
    const reports: LiveReport[] = [];
    for (const d of rs.docs) {
      const x = d.data();
      if (!(x.kind in HOURS) || x.lon < bbox[0] || x.lon > bbox[2] || x.lat < bbox[1] || x.lat > bbox[3]) continue;
      const t = tally.get(d.id) ?? { c: 1, d: 0 };
      if (t.d > t.c) continue;
      reports.push({ id: d.id, kind: x.kind, lon: x.lon, lat: x.lat, createdAt: x.createdAt, expiresAt: x.expiresAt, confirms: Math.max(1, t.c), dismisses: t.d });
    }
    return { now, reports };
  },
  async report(kind: ReportKind, spot: LonLat, at: { lon: number; lat: number; acc: number }) {
    if (isOnline() || !store) return api.report(kind, spot, at);
    const now = Date.now(), dev = await anonId();
    if (dist(spot, [at.lon, at.lat]) > 300 + Math.min(200, at.acc)) throw new Error('Report only places near where you are');
    const mine = await store.collection('reports').where('by', '==', dev).where('createdAt', '>', now - 3600000).limit(10).get();
    if (mine.size >= 6) throw new Error('Too many reports in the last hour');
    const same = await store.collection('reports').where('kind', '==', kind).where('expiresAt', '>', now).limit(500).get();
    const near = same.docs.find((d: any) => dist([d.data().lon, d.data().lat], spot) <= 80);
    let id: string = near?.id;
    if (!id) {
      const ref = await store.collection('reports').add({ kind, lon: spot[0], lat: spot[1], by: dev, createdAt: now, expiresAt: now + HOURS[kind] * 3600000 });
      id = ref.id;
    }
    await store.doc(`votes/${id}_${dev}`).set({ report: id, device: dev, still: true, at: now });
    return { ok: true, id, merged: !!near };
  },
  async vote(id: string, still: boolean, at: { lon: number; lat: number; acc: number }) {
    if (isOnline() || !store) return api.voteReport(id, still, at);
    const r = await store.doc(`reports/${id}`).get();
    if (!r.exists || r.data().expiresAt <= Date.now()) throw new Error('Report has expired');
    if (dist([r.data().lon, r.data().lat], [at.lon, at.lat]) > 500 + Math.min(200, at.acc)) throw new Error('Only people near the spot can confirm it');
    const dev = await anonId();
    await store.doc(`votes/${id}_${dev}`).set({ report: id, device: dev, still, at: Date.now() });
    return { ok: true };
  },
};
