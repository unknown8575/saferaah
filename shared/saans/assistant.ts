// Saans, the clean-air assistant. Two engines share one pipeline:
//
//   question → retrieve notes (BM25 + clusters [+ embeddings]) → compute facts (plan.ts)
//            → Gemini writes the answer from FACTS + NOTES        (server, with a key)
//            → or compose() writes it from templates              (no key / offline)
//
// The model never calculates: every number it may use is in FACTS, and it is told to
// cite notes as [n]. compose() gives a useful, specific answer without any model.
import { AQI_BANDS, type AirNow } from '../air.ts';
import { NOTES, CLUSTERS, type Cluster, type Note } from './knowledge.ts';
import { NoteIndex } from './retrieve.ts';
import { matchIntent, type Intent as PlaceIntent } from '../kinds.ts';
import { dayPlan, purifierCadr, commuteSwaps, TRAVEL_LABEL, CO2_PER_KM, atLeast, type Family, type DayPlan } from './plan.ts';

export interface RouteSummary {
  mode: string;
  minutes: number;
  label: string;
  /** % less PM2.5 than the fastest route */
  pctLess: number;
  avoided: string[];
  areas: string[];
}
/** A nearby place found ON THE PHONE. Only these fields leave it: no coordinates. */
export interface PlaceLite {
  name: string;
  kind: string;
  /** distance from the user, rounded to 50 m */
  distM: number;
  open: boolean | null;
  /** a similar kind, shown because few exact matches are mapped nearby */
  similar?: boolean;
}
export interface AssistantContext {
  air: AirNow | null;
  family: Family;
  route?: RouteSummary | null;
  /** places the phone found for a "near me" question */
  places?: { title: string; items: PlaceLite[] } | null;
}

const NEAR_CUE = /\b(near|nearby|nearest|around|close by|closest|where|buy|shop|shops|store|stores|kahan|kaha|kidhar|paas|nazdeek|milega|milenge|find)\b/i;
/** "Show me plant shops nearby" → the kind of place to look up on the phone (null if not a place question). */
export function placeIntentOf(q: string): PlaceIntent | null {
  if (!NEAR_CUE.test(q)) return null;
  const it = matchIntent(q);
  return it && it.title !== 'Shops' ? it : null;
}
export interface Turn { role: 'user' | 'assistant'; text: string }
export interface Answer {
  text: string;
  notes: { n: number; id: string; title: string; source: string }[];
  cluster: Cluster | null;
  plan: DayPlan;
  engine: 'gemini' | 'saans';
  model?: string;
}

export type Intent = 'places' | 'plan' | 'purifier' | 'route' | 'swaps' | 'mask' | 'general';
export function intentOf(q: string, ctx?: AssistantContext): Intent {
  if (ctx?.places?.items.length || placeIntentOf(q)) return 'places';
  const s = q.toLowerCase();
  if (/\b(plan|routine|schedule|today|tomorrow|aaj|kal|my day|day plan|din)\b/.test(s)) return 'plan';
  if (/purifier|cadr|hepa|air clean/.test(s)) return 'purifier';
  if (/\b(route|commute|way to|rasta|raasta|travel|cleanest air)\b/.test(s)) return 'route';
  if (/swap|co2|co₂|carbon|sustainab|footprint|emission|green(er)? (choice|option)|eco/.test(s)) return 'swaps';
  if (/\bmasks?\b|n95|kn95|ffp2/.test(s)) return 'mask';
  return 'general';
}

const index = new NoteIndex(NOTES);
export const noteIndex = () => index;

/** Notes to ground an answer: the best matches, plus the note the intent needs. */
export function groundingNotes(q: string, dense?: number[]): Note[] {
  const hits = index.search(q, 3, dense).map((x) => x.note);
  const must: Record<Intent, string[]> = {
    places: [], plan: ['timing'], purifier: ['purifier-size'], route: ['quiet-streets'], swaps: ['co2-modes', 'idling', 'burning'], mask: ['mask'], general: [],
  };
  const it = intentOf(q);
  if (it === 'places') {
    const t = placeIntentOf(q)?.title ?? '';
    must.places = /plant/i.test(t) ? ['plants'] : /purifier/i.test(t) ? ['purifier-size', 'purifier-care'] : /medical/i.test(t) ? ['mask'] : [];
  }
  const need = must[it].map((id) => NOTES.find((x) => x.id === id)!).filter(Boolean);
  return [...need, ...hits.filter((n) => !need.includes(n))].slice(0, Math.max(4, need.length));
}

/** Everything the answer may state as a number, computed here. */
export function factsFor(ctx: AssistantContext, plan = dayPlan(ctx.air, ctx.family)): string[] {
  const f = [...plan.facts];
  const fam = ctx.family;
  const members = [`${fam.adults} adult${fam.adults === 1 ? '' : 's'}`];
  if (fam.children) members.push(`${fam.children} child${fam.children > 1 ? 'ren' : ''}`);
  if (fam.elders) members.push(`${fam.elders} elder${fam.elders > 1 ? 's' : ''}`);
  if (fam.asthma) members.push('someone with asthma');
  if (fam.pregnant) members.push('a pregnant family member');
  f.push(`Family: ${members.join(', ')}; cooks with ${fam.cooking}; bedroom ${fam.bedroomM2} m².`);
  if (fam.commute) f.push(`Commute: ${fam.commute.km} km each way by ${TRAVEL_LABEL[fam.commute.mode]} (≈${Math.round(CO2_PER_KM[fam.commute.mode] * fam.commute.km * 44)} kg CO₂ a month).`);
  const pl = ctx.places;
  if (pl) {
    f.push(pl.items.length
      ? `${pl.title} near the user, found on their phone (their location is not sent or stored):`
      : `No ${pl.title.toLowerCase()} are mapped near the user.`);
    pl.items.forEach((p, i) => f.push(`  ${i + 1}. ${p.name} — ${p.kind}${p.similar ? ' (similar kind)' : ''}, ${p.distM < 1000 ? `${p.distM} m` : `${(p.distM / 1000).toFixed(1)} km`}, ${p.open === null ? 'hours unknown' : p.open ? 'open now' : 'closed now'}`));
  }
  const r = ctx.route;
  if (r) {
    f.push(r.pctLess >= 3
      ? `Selected route (${r.label}, ${r.mode}, ${r.minutes} min) breathes about ${r.pctLess}% less PM2.5 than the fastest route.`
      : `Selected route (${r.label}, ${r.mode}, ${r.minutes} min): the fastest route is already about the cleanest here.`);
    if (r.avoided.length) f.push(`It avoids: ${r.avoided.join(', ')}.`);
    if (r.areas.length) f.push(`It passes near: ${r.areas.join(', ')}.`);
  }
  return f;
}

// ------------------------------------------------------------ Gemini prompt
export const SYSTEM_PROMPT = `You are Saans, the clean-air assistant inside SafeRaah, a map app for families in Delhi.
Help families breathe less polluted air: daily routines timed to the forecast, indoor air fixes, safer and cleaner routes, and sustainable swaps with their impact.
Rules:
- Use ONLY the numbers in FACTS. Never invent, estimate or recompute figures. If a number is not in FACTS, describe it in words.
- Base advice on NOTES and cite them like [1] or [2] right after the sentence they support.
- Tailor the answer to the family and today's air in FACTS. Be specific: name times, rooms, people.
- Keep it short: at most 140 words, a one-line answer first, then up to 5 short bullet points. No headings, no tables.
- Reply in the user's language and script (English, Hindi or Hinglish).
- You are not a doctor. For breathing trouble, chest pain or a child wheezing, say to get medical help and call 112 in an emergency.
- If FACTS list nearby places, recommend only from that list, nearest open ones first, with their distance; never invent places, addresses or phone numbers. The app shows them as cards with directions.
- If the question is not about air, health from air, routes, places for clean-air needs or the environment, say briefly that you help with clean air and suggest one thing you can do.`;

export function buildPrompt(q: string, ctx: AssistantContext, notes: Note[], history: Turn[] = []) {
  const facts = factsFor(ctx);
  const body = [
    `QUESTION: ${q.trim()}`,
    '',
    'FACTS (computed by SafeRaah — use these numbers exactly):',
    ...facts.map((x) => `- ${x}`),
    '',
    'NOTES:',
    ...notes.map((n, i) => `[${i + 1}] ${n.title}: ${n.text} (Source: ${n.source})`),
  ].join('\n');
  const contents = [
    ...history.slice(-4).map((t) => ({ role: t.role === 'user' ? 'user' : 'model', parts: [{ text: t.text.slice(0, 600) }] })),
    { role: 'user', parts: [{ text: body }] },
  ];
  return { system: SYSTEM_PROMPT, contents, facts };
}

/** Tidy model output: no headings or bold markers, sane length. */
export function cleanModelText(s: string): string {
  return s.replace(/^#+\s*/gm, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/^\s*\*\s+/gm, '• ').replace(/^\s*-\s+/gm, '• ')
    .replace(/\n{3,}/g, '\n\n').trim().slice(0, 1600);
}

// ------------------------------------------------------------ built-in engine
const cite = (notes: Note[], id: string) => { const i = notes.findIndex((n) => n.id === id); return i >= 0 ? ` [${i + 1}]` : ''; };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const firstSentences = (t: string, n = 2) => t.split(/(?<=\.)\s+/).slice(0, n).join(' ');

/** A specific answer built from the plan and notes, without a language model. */
export function compose(q: string, ctx: AssistantContext, notes = groundingNotes(q)): Answer {
  const plan = dayPlan(ctx.air, ctx.family);
  const intent = intentOf(q, ctx);
  const lines: string[] = [];
  const air = ctx.air;
  const band = plan.band;
  const lead = air && band ? `Right now: AQI ${air.aqi.value}, ${AQI_BANDS[band].label.toLowerCase()}.` : 'I could not get a live air reading, so this is general advice.';
  const fam = ctx.family;

  switch (intent) {
    case 'places': {
      const pl = ctx.places;
      if (!pl) { lines.push('Turn on location (or mark where you are on the map) and ask again, and I will list the nearest ones. Your location stays on your phone.'); break; }
      if (!pl.items.length) { lines.push(`I could not find ${pl.title.toLowerCase()} mapped near you. Map data in some areas is thin; try a nearby market.`); break; }
      const open = pl.items.filter((p) => p.open);
      lines.push(`${pl.title} near you${open.length ? ` (${open.length} open now)` : ''}:`);
      for (const p of pl.items.slice(0, 5)) lines.push(`• ${p.name} — ${p.distM < 1000 ? `${p.distM} m` : `${(p.distM / 1000).toFixed(1)} km`}${p.open === null ? '' : p.open ? ', open' : ', closed'}${p.similar ? ` (${p.kind.toLowerCase()})` : ''}`);
      if (/plant|nurser/i.test(pl.title)) lines.push(`• Plants are lovely, but they don't clean room air measurably; for that use a purifier${cite(notes, 'plants')}.`);
      if (/purifier/i.test(pl.title)) lines.push(`• Pick a CADR of at least ${purifierCadr(fam.bedroomM2)} m³/h for your ${fam.bedroomM2} m² bedroom${cite(notes, 'purifier-size')}.`);
      if (/medical/i.test(pl.title) && /mask|n95/i.test(q)) lines.push(`• Ask for a fitted N95 (not cloth or loose surgical)${cite(notes, 'mask')}.`);
      break;
    }
    case 'plan': {
      lines.push(`${lead} Here is your day${cite(notes, 'timing')}:`);
      for (const it of plan.items.slice(0, 6)) lines.push(`• ${it.when ? it.when + ' — ' : ''}${it.title}${it.impact ? ` (${it.impact})` : ''}`);
      break;
    }
    case 'purifier': {
      const cadr = purifierCadr(fam.bedroomM2);
      lines.push(`For your ${fam.bedroomM2} m² bedroom, choose a purifier with a CADR of at least ${cadr} m³/h${cite(notes, 'purifier-size')}.`);
      lines.push('• Run it with the door and windows shut, all night on medium.');
      lines.push(`• True HEPA (H13) filter; skip ionizer or ozone models${cite(notes, 'purifier-care')}.`);
      lines.push(`• Living room of 20 m²? Aim for about ${purifierCadr(20)} m³/h.`);
      if (band && !atLeast(band, 'moderate')) lines.push('• Today the air is fairly clean, so it can run on low.');
      break;
    }
    case 'route': {
      const r = ctx.route;
      if (r && r.pctLess >= 3) {
        lines.push(`Your ${r.label.toLowerCase()} route breathes about ${r.pctLess}% less PM2.5 than the fastest one${cite(notes, 'quiet-streets')}.`);
        if (r.avoided.length) lines.push(`• It keeps away from ${r.avoided.join(', ')}.`);
        lines.push(`• ${r.minutes} min by ${r.mode}.`);
      } else if (r) {
        lines.push(`On this trip the fastest route is already about the cleanest: less time outside beats a long detour${cite(notes, 'quiet-streets')}.`);
        if (r.areas.length) lines.push(`• It passes ${r.areas.join(', ')}; keep windows up there.`);
      } else {
        lines.push(`Plan a trip and pick the "Cleanest air" route: it keeps you off busy roads and away from industrial areas and landfills${cite(notes, 'quiet-streets')}.`);
      }
      if (plan.best) lines.push(`• Cleanest time to travel today: ${plan.best.label}.`);
      if (band && atLeast(band, 'poor')) lines.push(`• Wear a fitted N95 if you walk or ride${cite(notes, 'mask')}.`);
      break;
    }
    case 'swaps': {
      if (fam.commute) {
        const sw = commuteSwaps(fam.commute);
        lines.push(sw.length
          ? `Your biggest swap is the commute${cite(notes, 'co2-modes')}:`
          : `Your ${TRAVEL_LABEL[fam.commute.mode]} commute is already low-carbon${cite(notes, 'co2-modes')}.`);
        for (const s of sw) lines.push(`• ${cap(TRAVEL_LABEL[s.to])} instead of ${TRAVEL_LABEL[s.from]}: ≈${s.kgPerMonth} kg CO₂ less a month (${s.pct}% less).`);
      } else {
        lines.push(`Small swaps that clean the air you share${cite(notes, 'co2-modes')}:`);
        lines.push('• Metro instead of a solo car trip: about 80% less CO₂ per km.');
      }
      lines.push(`• Engine off at long red lights${cite(notes, 'idling')}.`);
      lines.push(`• Compost leaves and waste; never burn them${cite(notes, 'burning')}.`);
      if (fam.cooking === 'wood' || fam.cooking === 'kerosene') lines.push(`• Switch from ${fam.cooking} to LPG or induction${cite(notes, 'cooking-fuel')}.`);
      break;
    }
    case 'mask': {
      lines.push(`${lead} ${firstSentences(notes.find((n) => n.id === 'mask')?.text ?? '', 2)}${cite(notes, 'mask')}`);
      if (fam.children) lines.push('• For children: a child-size N95 only if it fits; no masks under 2.');
      if (band && !atLeast(band, 'poor')) lines.push('• Today a mask is optional for short trips.');
      break;
    }
    default: {
      const top = notes[0];
      if (!top) {
        lines.push(`${lead} I help with clean air: daily plans, indoor air, cleaner routes and greener swaps. Try "Plan my day".`);
        break;
      }
      lines.push(`${firstSentences(top.text, 2)} [1]`);
      const second = notes[1];
      if (second && second.cluster === top.cluster) lines.push(`• ${second.title}: ${firstSentences(second.text, 1)} [2]`);
      if (air && band) lines.push(`• ${lead}${plan.best ? ` Cleanest hours: ${plan.best.label}.` : ''}`);
    }
  }
  const index = noteIndex();
  return {
    text: lines.join('\n'),
    notes: notes.map((n, i) => ({ n: i + 1, id: n.id, title: n.title, source: n.source })),
    cluster: index.clusterOf(q),
    plan,
    engine: 'saans',
  };
}

export { CLUSTERS };
