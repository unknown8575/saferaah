// Server API client. The app keeps working without a server (planning,
// navigation, SOS links); live sharing and verified reviews need it.
import { deviceId } from './store.ts';
import type { Fix } from '../../shared/journey.ts';
import type { LonLat } from '../../shared/geo.ts';
import type { Mode } from '../../shared/modes.ts';

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
  review: (journeyId: string, reviewToken: string, rating: number, tags: string[], comment: string) =>
    call<{ ok: boolean }>('POST', 'api/reviews', { journeyId, reviewToken, rating, tags, comment }),
  share: (shareId: string) => call<any>('GET', `api/share/${encodeURIComponent(shareId)}`),
};
