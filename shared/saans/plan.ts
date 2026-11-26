// The numbers behind Saans: a day plan from the hourly forecast and the family's
// situation, purifier sizing and travel swaps. All arithmetic is done here, in code,
// so the language model only has to explain results it is given — never compute them.
import { AQI_BANDS, bandOf, naqi, cleanestWindow, type AirNow, type AirHour, type AqiBand } from '../air.ts';

export type Travel = 'walk' | 'cycle' | 'twowheeler' | 'auto' | 'car' | 'bus' | 'metro';
export const TRAVEL_LABEL: Record<Travel, string> = {
  walk: 'walk', cycle: 'cycle', twowheeler: 'two-wheeler', auto: 'auto', car: 'car', bus: 'bus', metro: 'metro',
};
/** kg CO₂ per person-km, rounded averages (see knowledge note "co2-modes") */
export const CO2_PER_KM: Record<Travel, number> = {
  walk: 0, cycle: 0, twowheeler: 0.05, auto: 0.07, car: 0.17, bus: 0.04, metro: 0.03,
};

export interface Family {
  adults: number;
  children: number;
  elders: number;
  asthma: boolean;
  pregnant: boolean;
  cooking: 'lpg' | 'induction' | 'wood' | 'kerosene';
  /** bedroom floor area, m² */
  bedroomM2: number;
  /** daily commute (one way) */
  commute: { mode: Travel; km: number } | null;
}
export const DEFAULT_FAMILY: Family = {
  adults: 2, children: 0, elders: 0, asthma: false, pregnant: false, cooking: 'lpg', bedroomM2: 12, commute: null,
};

const RANK: AqiBand[] = ['good', 'satisfactory', 'moderate', 'poor', 'verypoor', 'severe'];
export const atLeast = (b: AqiBand, min: AqiBand) => RANK.indexOf(b) >= RANK.indexOf(min);

export function hourLabel(iso: string): string {
  const h = Number(iso.slice(11, 13));
  const ap = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${ap}`;
}
/** "2–4 pm" for a window whose last hour starts at `end` */
export function windowLabel(start: string, end: string): string {
  const e = Number(end.slice(11, 13)) + 1;
  const endIso = `${end.slice(0, 11)}${String(e % 24).padStart(2, '0')}`;
  const a = hourLabel(start), b = hourLabel(endIso);
  return a.split(' ')[1] === b.split(' ')[1] ? `${a.split(' ')[0]}–${b}` : `${a} – ${b}`;
}

/** Purifier clean-air delivery rate for ~5 air changes an hour. */
export function purifierCadr(floorM2: number, ceilingM = 3, ach = 5): number {
  return Math.round((floorM2 * ceilingM * ach) / 10) * 10;
}

export interface Swap { from: Travel; to: Travel; kgPerMonth: number; pct: number }
/** Monthly CO₂ saved by doing the commute (both ways, 22 working days) another way. */
export function commuteSwaps(c: { mode: Travel; km: number }): Swap[] {
  const base = CO2_PER_KM[c.mode];
  const km = c.km * 2 * 22;
  return (['metro', 'bus', 'cycle', 'twowheeler', 'auto'] as Travel[])
    .filter((t) => t !== c.mode && CO2_PER_KM[t] < base && !(t === 'cycle' && c.km > 8))
    .map((t) => ({ from: c.mode, to: t, kgPerMonth: Math.round((base - CO2_PER_KM[t]) * km), pct: Math.round((1 - CO2_PER_KM[t] / base) * 100) }))
    .sort((a, b) => b.kgPerMonth - a.kgPerMonth)
    .slice(0, 2);
}

export interface PlanItem { id: string; icon: string; when?: string; title: string; detail: string; impact?: string }
export interface DayPlan {
  aqi: number | null;
  band: AqiBand | null;
  verdict: string;
  best: { label: string; pm25: number } | null;
  worst: { label: string; pm25: number } | null;
  items: PlanItem[];
  facts: string[];
}

function worstWindow(hours: AirHour[], len = 2): { start: string; end: string; pm25: number } | null {
  let w: { start: string; end: string; pm25: number } | null = null;
  for (let i = 0; i + len <= hours.length; i++) {
    const avg = hours.slice(i, i + len).reduce((s, x) => s + x.pm25, 0) / len;
    if (!w || avg > w.pm25) w = { start: hours[i].time, end: hours[i + len - 1].time, pm25: avg };
  }
  return w;
}

/** A plain-language plan for the next day, with the numbers that justify each step. */
export function dayPlan(air: AirNow | null, fam: Family): DayPlan {
  const items: PlanItem[] = [];
  const facts: string[] = [];
  const who = [fam.children ? 'children' : '', fam.elders ? 'elders' : '', fam.asthma ? 'someone with asthma' : '', fam.pregnant ? 'a pregnancy' : '']
    .filter(Boolean);
  const sensitive = who.length > 0;
  if (!air) {
    facts.push('No live air reading is available right now.');
    return { aqi: null, band: null, verdict: 'Live air data is not available, so this plan uses general advice.', best: null, worst: null, items: generalItems(fam), facts };
  }
  const band = air.aqi.band;
  const B = AQI_BANDS[band];
  facts.push(`AQI now ${air.aqi.value} (${B.label}, Indian National AQI), PM2.5 ${Math.round(air.pm25)} µg/m³, PM10 ${Math.round(air.pm10)} µg/m³ (${air.source}).`);
  facts.push(`PM2.5 now is ${(air.pm25 / 15).toFixed(1)}× the WHO 24-hour guideline (15 µg/m³).`);
  const best = cleanestWindow(air.hours, 2);
  const worst = worstWindow(air.hours, 2);
  const today = air.hours[0]?.time.slice(0, 10);
  const lbl = (w: { start: string; end: string }) => (w.start.slice(0, 10) !== today ? 'tomorrow ' : '') + windowLabel(w.start, w.end);
  const bestL = best ? { label: lbl(best), pm25: Math.round(best.pm25) } : null;
  const worstL = worst ? { label: lbl(worst), pm25: Math.round(worst.pm25) } : null;
  if (bestL) facts.push(`Cleanest 2 hours in the next day (6 am–10 pm): ${bestL.label}, about ${bestL.pm25} µg/m³ PM2.5 (AQI ${naqi(bestL.pm25).value}).`);
  if (worstL) facts.push(`Worst 2 hours in the next day: ${worstL.label}, about ${worstL.pm25} µg/m³.`);
  const cut = best && worst && worst.pm25 > 0 ? Math.max(0, Math.min(95, Math.round((1 - best.pm25 / worst.pm25) * 100))) : 0;

  // 1. time outdoor activity
  if (bestL) {
    items.push({
      id: 'window', icon: 'sun', when: bestL.label,
      title: atLeast(band, 'verypoor') ? 'Keep errands and play to this window' : 'Best time to be outside',
      detail: atLeast(band, 'poor') ? `Walks, play and errands in the cleanest hours; keep them short.` : 'Good time for a walk, play or exercise.',
      impact: cut >= 5 && worstL ? `${cut}% less PM2.5 per breath than in the worst hours` : undefined,
    });
    if (cut >= 5 && worstL) facts.push(`Being outside at ${bestL.label} instead of ${worstL.label} means about ${cut}% less PM2.5 per breath.`);
  }
  if (worstL && atLeast(band, 'moderate')) {
    items.push({ id: 'avoid', icon: 'moon', when: worstL.label, title: 'Stay in if you can', detail: `The forecast's dirtiest hours (about ${worstL.pm25} µg/m³).` });
  }
  // 2. exercise
  if (atLeast(band, 'poor')) {
    items.push({ id: 'exercise', icon: 'activity', title: 'Move workouts indoors', detail: 'Hard exercise multiplies the air you breathe; skip runs beside busy roads.' });
  }
  // 3. masks
  if (atLeast(band, 'poor')) {
    items.push({ id: 'mask', icon: 'wind', title: 'Wear a fitted N95 outside', detail: fam.children ? 'Child-size N95 only for children old enough to wear it well; none under 2.' : 'Cloth and loose surgical masks let most fine dust through.' });
  }
  // 4. purifier + windows
  const cadr = purifierCadr(fam.bedroomM2);
  facts.push(`Purifier for a ${fam.bedroomM2} m² bedroom (3 m ceiling, 5 air changes/hour): CADR about ${cadr} m³/h.`);
  if (atLeast(band, 'moderate')) {
    items.push({ id: 'purifier', icon: 'fan', when: 'Night', title: 'Purifier on in the bedroom', detail: `Doors and windows shut. For ${fam.bedroomM2} m², pick a CADR of at least ${cadr} m³/h.` });
  }
  if (best) items.push({ id: 'air-out', icon: 'home', when: (best.start.slice(0, 10) !== today ? 'tomorrow ' : '') + hourLabel(best.start), title: 'Air out the house for 10–15 min', detail: 'Lets out cooking fumes and stale air while outdoor air is at its best.' });
  // 5. kitchen
  if (fam.cooking === 'wood' || fam.cooking === 'kerosene') {
    items.push({ id: 'fuel', icon: 'cook', title: `Cook on LPG or induction instead of ${fam.cooking}`, detail: 'Solid-fuel and kerosene smoke is one of the largest indoor exposures.' });
  } else {
    items.push({ id: 'cook', icon: 'cook', title: 'Chimney on, window open while frying', detail: 'A tadka can push kitchen PM2.5 above the outdoor level for a while.' });
  }
  // 6. sensitive family members
  if (sensitive) {
    items.push({
      id: 'family', icon: 'health', title: `Extra care for ${who.join(', ')}`,
      detail: fam.asthma ? 'Reliever inhaler at hand, preventer as prescribed. ' + B.advice : B.advice,
    });
  }
  // 7. commute
  if (fam.commute) {
    const sw = commuteSwaps(fam.commute);
    if (sw.length) {
      const s = sw[0];
      items.push({ id: 'swap', icon: 'leaf', title: `Try the ${TRAVEL_LABEL[s.to]} for your ${fam.commute.km} km commute`, detail: `Instead of the ${TRAVEL_LABEL[s.from]}.`, impact: `≈${s.kgPerMonth} kg less CO₂ a month (${s.pct}% less)` });
      facts.push(`Commute swap: ${fam.commute.km} km each way by ${TRAVEL_LABEL[s.from]} → ${TRAVEL_LABEL[s.to]} saves about ${s.kgPerMonth} kg CO₂ a month (${s.pct}% less; 22 working days).`);
    }
  }
  const verdict = `${B.label} air (AQI ${air.aqi.value}). ${B.advice}`;
  // most personal and most useful first: the UI shows the top few
  const order = ['window', 'family', 'mask', 'purifier', 'swap', 'fuel', 'avoid', 'exercise', 'air-out', 'cook'];
  items.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  return { aqi: air.aqi.value, band, verdict, best: bestL, worst: worstL, items, facts };
}

function generalItems(fam: Family): PlanItem[] {
  return [
    { id: 'window', icon: 'sun', title: 'Check the air before going out', detail: 'In winter, early mornings are often the dirtiest hours in Delhi.' },
    { id: 'purifier', icon: 'fan', title: 'Purifier in the bedroom', detail: `For ${fam.bedroomM2} m², a CADR of about ${purifierCadr(fam.bedroomM2)} m³/h.` },
    { id: 'cook', icon: 'cook', title: 'Chimney on while frying', detail: 'Cooking smoke is a big indoor source.' },
  ];
}

export { bandOf };
