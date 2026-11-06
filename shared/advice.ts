// Plain-language advice shown above the route list, including a
// suggestion to switch travel mode when every route is risky.

import type { Mode } from './modes.ts';
import { MODE_INFO } from './modes.ts';
import type { Profile } from './risk.ts';
import type { RouteResult, Tier } from './router.ts';
import { istTime } from './time.ts';

export interface Advice {
  level: 'ok' | 'caution' | 'warn';
  title: string;
  body: string;
  /** a safer travel mode to switch to, if we recommend one */
  suggestMode?: Mode;
}

const RANK: Record<Tier, number> = { green: 0, yellow: 1, red: 2, darkred: 3 };

function fmtClock(when: Date): string {
  const m = istTime(when).minutes;
  const h = Math.floor(m / 60), mm = m % 60;
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(mm).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

export function adviseTrip(opts: {
  mode: Mode;
  profile: Profile;
  when: Date;
  routes: RouteResult[];
  /** fastest time for an auto/cab over the same trip, if computed */
  vehicleAltS?: { mode: Mode; timeS: number; tier: Tier };
}): Advice | null {
  const { mode, profile, when, routes, vehicleAltS } = opts;
  if (!routes.length) return null;
  const best = routes.reduce((a, b) => (RANK[b.tier] < RANK[a.tier] ? b : a));
  const bestRank = RANK[best.tier];
  const km = (best.lengthM / 1000).toFixed(1);
  const clock = fmtClock(when);
  const who = profile === 'child' ? 'for a child ' : '';

  if (mode === 'walk' && bestRank >= 2 && best.lengthM > 700 && vehicleAltS &&
      RANK[vehicleAltS.tier] <= bestRank) {
    const mins = Math.max(1, Math.round(vehicleAltS.timeS / 60));
    return {
      level: 'warn',
      title: `Walking ${who}is risky on every route right now`,
      body: `It is ${clock} and even the safest walk (${km} km) passes quiet, closed stretches. ` +
        `${MODE_INFO[vehicleAltS.mode].label} takes about ${mins} min — consider it, and share your trip.`,
      suggestMode: vehicleAltS.mode,
    };
  }
  if (bestRank === 3) {
    return {
      level: 'warn',
      title: 'Every route has high-risk stretches',
      body: 'Share your live trip with a trusted contact before you start, and keep the SOS button handy.',
    };
  }
  if (bestRank === 2) {
    return {
      level: 'caution',
      title: 'Choose the safest route and stay alert',
      body: best === routes[0]
        ? 'The fastest route is also the least risky one, but it has quiet stretches.'
        : 'The safer route takes a little longer but keeps you on busier, more open streets.',
    };
  }
  if (bestRank === 1) {
    return {
      level: 'caution',
      title: 'Mostly safe, a few quiet parts',
      body: 'Stick to the yellow or green route. We will tell your contacts when you arrive.',
    };
  }
  return {
    level: 'ok',
    title: 'Busy, open streets on the safest route',
    body: 'We will still send an arrival message to your contacts when you reach.',
  };
}
