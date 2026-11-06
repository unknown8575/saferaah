// Plain-language precautions for one route, shown on its card and in its details.
import type { RouteResult } from './router.ts';
import type { Mode } from './modes.ts';
import type { Profile } from './risk.ts';
import type { Poi } from './places.ts';
import { darkness } from './time.ts';

export interface Precautions {
  /** one short line for the route card */
  headline: string;
  /** full list for the details screen, most important first */
  items: string[];
}

const fmtM = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);

export function routePrecautions(r: RouteResult, opts: { mode: Mode; profile: Profile; when: Date; pois: Poi[] }): Precautions {
  const { mode, profile, when, pois } = opts;
  const dark = darkness(when) >= 0.5;
  const items: string[] = [];
  const spots = [...r.dangerSpots].sort((a, b) => b.lengthM - a.lengthM);
  const spotTotal = spots.reduce((a, s) => a + s.lengthM, 0);
  const police = r.havenIds.map((i) => pois[i]).filter((p) => p?.cat === 'police' && p.name);
  const risky = r.tier === 'red' || r.tier === 'darkred';

  if (risky && mode === 'walk' && dark) items.push('Consider an auto or cab for this trip, or walk with someone');
  for (const s of spots.slice(0, 3)) {
    items.push(`${fmtM(s.lengthM)}${s.street ? ` on ${s.street}` : ''}: ${s.reasons.join(', ') || 'quiet at this hour'}`);
  }
  if (dark && r.litShare < 0.5 && r.lengthM > 300) items.push('Much of this route uses side streets that may be poorly lit; keep to main roads where you can');
  if (police.length) items.push(`Police on the way: ${[...new Set(police.map((p) => p.name))].slice(0, 2).join(', ')}`);
  else if (r.policeShare < 0.2 && r.tier !== 'green') items.push('Few police posts along this route');
  if (mode === 'twowheeler' && dark && risky) items.push('Avoid stopping on the dark stretches; keep to the main carriageway');
  if (profile === 'child' && mode === 'walk' && r.mainRoadShare > 0.4) items.push('Busy traffic: cross only at signals or subways');
  if (r.tier !== 'green') items.push('Share your live trip with a contact before you start');

  let headline: string;
  if (r.tier === 'green') headline = spots.length ? `Mostly busy and open; ${fmtM(spotTotal)} quieter` : 'Busy, open streets: no special precautions';
  else if (r.tier === 'yellow') headline = spots.length
    ? `Stay alert on ${spots.length} quiet stretch${spots.length > 1 ? 'es' : ''} (${fmtM(spotTotal)})`
    : 'Some quiet parts: stay alert and share your trip';
  else if (mode === 'walk' && dark) headline = 'Risky on foot now: prefer an auto, or go with someone';
  else headline = spots.length
    ? `Avoid alone: ${spots.length} risky stretch${spots.length > 1 ? 'es' : ''} (${fmtM(spotTotal)})`
    : 'Risky at this hour: share your trip and stay alert';
  return { headline, items };
}
