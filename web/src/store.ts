// Small persisted settings, all on the device. Storage can be unavailable
// (private mode, blocked site data), so every access is guarded.
import type { Mode } from '../../shared/modes.ts';
import type { Profile } from '../../shared/risk.ts';

export interface Contact { id: string; name: string; phone: string; notify: boolean }
export interface Settings {
  profile: Profile;
  mode: Mode;
  contacts: Contact[];
  travellerName: string;
  simulate: boolean;
  seenIntro: boolean;
}

const KEY = 'saferaah.v1';
const DEFAULTS: Settings = { profile: 'woman', mode: 'walk', contacts: [], travellerName: '', simulate: false, seenIntro: false };

let mem: Settings | null = null;

export function load(): Settings {
  if (mem) return mem;
  try {
    const raw = localStorage.getItem(KEY);
    mem = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    mem = { ...DEFAULTS };
  }
  return mem!;
}

export function save(patch: Partial<Settings>): Settings {
  mem = { ...load(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch { /* in-memory only */ }
  return mem;
}

export function deviceId(): string {
  try {
    let id = localStorage.getItem('saferaah.device');
    if (!id) { id = crypto.randomUUID(); localStorage.setItem('saferaah.device', id); }
    return id;
  } catch {
    return (mem as unknown as { _dev?: string })?._dev ?? crypto.randomUUID();
  }
}

/** Normalise an Indian mobile number to +91XXXXXXXXXX; null if not valid. */
export function normalisePhone(raw: string): string | null {
  const d = raw.replace(/[^\d+]/g, '');
  if (/^\+\d{10,15}$/.test(d)) return d;
  const digits = d.replace(/\D/g, '');
  if (/^[6-9]\d{9}$/.test(digits)) return '+91' + digits;
  if (/^0[6-9]\d{9}$/.test(digits)) return '+91' + digits.slice(1);
  if (/^91[6-9]\d{9}$/.test(digits)) return '+' + digits;
  return null;
}
