// Saans — the clean-air assistant panel: live air with a 24-hour forecast, the family's
// plan for the day, and a chat grounded on our notes. Answers come from the server
// (Gemini) when it is reachable, otherwise from the built-in engine on the phone.
// Conversations are kept in memory only and vanish when the app closes.
import { h, clear } from './dom.ts';
import { icon } from './icons.ts';
import { load, save } from './store.ts';
import { api } from './api.ts';
import { AQI_BANDS, naqi, bandOf, type AirNow } from '../../shared/air.ts';
import { compose, type RouteSummary, type AssistantContext } from '../../shared/saans/assistant.ts';
import { dayPlan, TRAVEL_LABEL, hourLabel, type Family, type Travel } from '../../shared/saans/plan.ts';

export interface SaansEnv {
  air: () => Promise<AirNow | null>;
  route: () => RouteSummary | null;
  online: () => boolean;
}

interface Msg { role: 'user' | 'assistant'; text: string; notes?: { n: number; title: string; source: string }[]; engine?: string }
const chat: Msg[] = [];
let root: HTMLElement | null = null;
let lastFocus: Element | null = null;
let airNow: AirNow | null = null;

const SUGGEST = ['Plan my day', 'Which purifier for my bedroom?', 'When can the kids play outside?', 'Greener way to commute', 'Is agarbatti bad indoors?'];

export function closeSaans() {
  if (!root) return;
  const r = root;
  root = null;
  r.classList.add('leaving');
  setTimeout(() => r.remove(), 260);
  document.removeEventListener('keydown', onKey);
  (lastFocus as HTMLElement | null)?.focus?.();
}
function onKey(e: KeyboardEvent) { if (e.key === 'Escape') closeSaans(); }

export async function openSaans(env: SaansEnv, opts: { ask?: string } = {}) {
  if (root) closeSaans();
  lastFocus = document.activeElement;
  const body = h('div', { class: 'saans-body' });
  const msgs = h('div', { class: 'saans-msgs', 'aria-live': 'polite' });
  const input = h('input', {
    class: 'saans-input', id: 'saans-q', type: 'text', placeholder: 'Ask about air, routes, home…', autocomplete: 'off', maxlength: '500',
    'aria-label': 'Ask Saans',
  }) as HTMLInputElement;
  const form = h('form', { class: 'saans-compose', on: { submit: (e: Event) => { e.preventDefault(); ask(env, input.value, msgs); input.value = ''; } } },
    input, h('button', { class: 'saans-send', type: 'submit', 'aria-label': 'Send' }, icon('send', 18)));
  root = h('div', { class: 'saans', id: 'saans', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Saans clean-air assistant' },
    h('div', { class: 'saans-scrim', on: { click: () => closeSaans() } }),
    h('section', { class: 'saans-panel' },
      h('header', { class: 'saans-head' },
        h('span', { class: 'saans-orb', 'aria-hidden': 'true' }),
        h('div', { class: 'saans-title' }, h('b', null, 'Saans'), h('small', null, 'Your clean-air assistant')),
        h('button', { class: 'saans-close', 'aria-label': 'Close Saans', on: { click: () => closeSaans() } }, icon('close', 20))),
      body,
      form));
  document.body.append(root);
  document.addEventListener('keydown', onKey);
  clear(body, h('div', { class: 'saans-hero skeleton' }, h('div', { class: 'shimmer' })), msgs);
  renderMsgs(msgs, env);
  input.focus({ preventScroll: true });
  airNow = await env.air().catch(() => null);
  if (!root) return;
  renderBody(env, body, msgs);
  if (opts.ask) ask(env, opts.ask, msgs);
}

function renderBody(env: SaansEnv, body: HTMLElement, msgs: HTMLElement) {
  const fam = load().family;
  const plan = dayPlan(airNow, fam);
  clear(body,
    heroCard(airNow),
    familyStrip(env, body, msgs, fam),
    h('section', { class: 'saans-plan', 'aria-label': "Today's plan" },
      h('h3', null, 'Next 24 hours, for your family'),
      h('ol', { class: 'plan-list' }, plan.items.slice(0, 7).map((it, i) => h('li', { class: 'plan-item', style: { animationDelay: `${i * 50}ms` } },
        h('span', { class: 'plan-ic' }, icon(it.icon, 17)),
        h('span', { class: 'plan-txt' },
          h('span', { class: 'plan-top' }, it.when ? h('span', { class: 'plan-when' }, it.when) : null, h('b', null, it.title)),
          h('small', null, it.detail),
          it.impact ? h('span', { class: 'plan-impact' }, icon('leaf', 12), it.impact) : null))))),
    msgs);
}

function heroCard(a: AirNow | null): HTMLElement {
  if (!a) {
    return h('section', { class: 'saans-hero off' }, h('div', { class: 'hero-num' }, '—'),
      h('div', { class: 'hero-meta' }, h('b', null, 'Live air not available'), h('small', null, 'Saans will give general advice until you are back online.')));
  }
  const B = AQI_BANDS[a.aqi.band];
  const hours = a.hours.slice(0, 24);
  const max = Math.max(60, ...hours.map((x) => x.pm25));
  const best = (() => {
    let bi = -1, bv = Infinity;
    hours.forEach((x, i) => { const hr = Number(x.time.slice(11, 13)); if (hr >= 6 && hr <= 21 && x.pm25 < bv) { bv = x.pm25; bi = i; } });
    return bi;
  })();
  const W = 300, H = 64, bw = W / Math.max(1, hours.length);
  const svg = `<svg viewBox="0 0 ${W} ${H + 14}" class="hero-bars" role="img" aria-label="PM2.5 for the next ${hours.length} hours">${
    hours.map((x, i) => {
      const bh = Math.max(3, (x.pm25 / max) * H);
      const c = AQI_BANDS[bandOf(naqi(x.pm25).value)].color;
      return `<rect x="${(i * bw + 1).toFixed(1)}" y="${(H - bh).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="${c}" opacity="${i === best ? 1 : 0.72}" style="animation-delay:${i * 18}ms"/>`;
    }).join('')
  }${hours.map((x, i) => (i % 6 === 0 ? `<text x="${(i * bw + 1).toFixed(1)}" y="${H + 12}" class="bar-lbl">${i === 0 ? 'Now' : hourLabel(x.time)}</text>` : '')).join('')}</svg>`;
  const bars = h('div', { class: 'hero-chart' });
  bars.innerHTML = svg; // built from numbers and fixed labels only
  return h('section', { class: 'saans-hero', style: { '--band': B.color } },
    h('div', { class: 'hero-row' },
      h('div', { class: 'hero-num', 'aria-label': `AQI ${a.aqi.value}` }, String(a.aqi.value)),
      h('div', { class: 'hero-meta' },
        h('span', { class: 'band-pill' }, B.label),
        h('small', null, `PM2.5 ${Math.round(a.pm25)} µg/m³ · ${(a.pm25 / 15).toFixed(0)}× WHO guideline`))),
    h('p', { class: 'hero-advice' }, B.advice),
    hours.length ? bars : null,
    best >= 0 ? h('p', { class: 'hero-best' }, icon('sun', 14), `Cleanest daytime hour: ${hours[best].time.slice(0, 10) !== hours[0].time.slice(0, 10) ? 'tomorrow ' : ''}${hourLabel(hours[best].time)} (about ${Math.round(hours[best].pm25)} µg/m³)`) : null,
    h('small', { class: 'hero-src' }, `Indian National AQI · ${a.source}`));
}

function familyText(f: Family): string {
  const p = [`${f.adults} adult${f.adults === 1 ? '' : 's'}`];
  if (f.children) p.push(`${f.children} child${f.children > 1 ? 'ren' : ''}`);
  if (f.elders) p.push(`${f.elders} elder${f.elders > 1 ? 's' : ''}`);
  if (f.asthma) p.push('asthma');
  if (f.pregnant) p.push('pregnancy');
  if (f.commute) p.push(`${f.commute.km} km by ${TRAVEL_LABEL[f.commute.mode]}`);
  return p.join(' · ');
}

function familyStrip(env: SaansEnv, body: HTMLElement, msgs: HTMLElement, f: Family): HTMLElement {
  const set = load().familySet;
  return h('button', { class: `family-strip${set ? '' : ' unset'}`, id: 'family-edit', on: { click: () => editFamily(env, body, msgs) } },
    icon('contacts', 16),
    h('span', null, set ? familyText(f) : 'Tell Saans about your family for a personal plan'),
    h('span', { class: 'fs-edit' }, set ? 'Edit' : 'Set up'));
}

function editFamily(env: SaansEnv, body: HTMLElement, msgs: HTMLElement) {
  const f: Family = structuredClone(load().family);
  const stepper = (key: 'adults' | 'children' | 'elders', label: string, min: number) => {
    const val = h('output', null, String(f[key]));
    const set = (d: number) => { f[key] = Math.max(min, Math.min(12, f[key] + d)); val.textContent = String(f[key]); };
    return h('div', { class: 'fe-row' }, h('span', null, label),
      h('span', { class: 'stepper' },
        h('button', { type: 'button', 'aria-label': `Fewer ${label.toLowerCase()}`, on: { click: () => set(-1) } }, '−'), val,
        h('button', { type: 'button', 'aria-label': `More ${label.toLowerCase()}`, on: { click: () => set(1) } }, '+')));
  };
  const toggle = (key: 'asthma' | 'pregnant', label: string) => h('label', { class: 'fe-row switch' }, h('span', null, label),
    h('input', { type: 'checkbox', checked: f[key], on: { change: (e: Event) => { f[key] = (e.target as HTMLInputElement).checked; } } }));
  const seg = <T extends string>(opts: [T, string][], cur: T, on: (v: T) => void, name: string) => h('div', { class: 'seg', role: 'radiogroup', 'aria-label': name },
    opts.map(([v, l]) => h('button', { type: 'button', role: 'radio', 'aria-checked': v === cur ? 'true' : 'false', class: v === cur ? 'on' : '',
      on: { click: (e: Event) => {
        on(v);
        for (const b of (e.currentTarget as HTMLElement).parentElement!.children) { b.classList.toggle('on', b === e.currentTarget); b.setAttribute('aria-checked', b === e.currentTarget ? 'true' : 'false'); }
      } } }, l)));
  const room = h('output', null, `${f.bedroomM2} m²`);
  const kmOut = h('output', null, `${f.commute?.km ?? 8} km`);
  let commuteMode: Travel | 'none' = f.commute?.mode ?? 'none';
  let km = f.commute?.km ?? 8;
  clear(body, h('form', { class: 'family-form', on: { submit: (e: Event) => {
    e.preventDefault();
    f.commute = commuteMode === 'none' ? null : { mode: commuteMode, km };
    save({ family: f, familySet: true });
    renderBody(env, body, msgs);
  } } },
  h('h3', null, 'Your family'),
  h('p', { class: 'fe-note' }, 'Kept only on this phone. Saans uses it to tailor the plan.'),
  stepper('adults', 'Adults', 0), stepper('children', 'Children', 0), stepper('elders', 'Elders (60+)', 0),
  toggle('asthma', 'Someone has asthma or a lung condition'), toggle('pregnant', 'Someone is pregnant'),
  h('div', { class: 'fe-block' }, h('span', null, 'Cooking with'),
    seg([['lpg', 'LPG'], ['induction', 'Induction'], ['wood', 'Wood / coal'], ['kerosene', 'Kerosene']], f.cooking, (v) => { f.cooking = v; }, 'Cooking fuel')),
  h('div', { class: 'fe-block' }, h('span', null, 'Bedroom size ', room),
    h('input', { type: 'range', min: '6', max: '30', step: '1', value: String(f.bedroomM2), 'aria-label': 'Bedroom size in square metres',
      on: { input: (e: Event) => { f.bedroomM2 = Number((e.target as HTMLInputElement).value); room.textContent = `${f.bedroomM2} m²`; } } })),
  h('div', { class: 'fe-block' }, h('span', null, 'Daily commute'),
    seg([['none', 'None'], ['car', 'Car'], ['twowheeler', '2-wheeler'], ['auto', 'Auto'], ['bus', 'Bus'], ['metro', 'Metro']], commuteMode, (v) => { commuteMode = v; }, 'Commute mode'),
    h('span', { class: 'fe-km' }, 'One way ', kmOut),
    h('input', { type: 'range', min: '1', max: '40', step: '1', value: String(km), 'aria-label': 'Commute distance one way in kilometres',
      on: { input: (e: Event) => { km = Number((e.target as HTMLInputElement).value); kmOut.textContent = `${km} km`; } } })),
  h('div', { class: 'fe-actions' },
    h('button', { type: 'button', class: 'btn', on: { click: () => renderBody(env, body, msgs) } }, 'Cancel'),
    h('button', { type: 'submit', class: 'btn primary', id: 'family-save' }, 'Save'))));
}

function renderMsgs(msgs: HTMLElement, env: SaansEnv) {
  clear(msgs,
    chat.length ? null : h('div', { class: 'saans-hello' },
      h('p', null, 'Ask me anything about the air your family breathes: when to go out, home fixes, cleaner routes or greener swaps.')),
    chat.map((m) => bubble(m)),
    h('div', { class: 'saans-chips', role: 'list' }, SUGGEST.filter((s) => !chat.some((m) => m.text === s)).slice(0, 4)
      .map((s) => h('button', { class: 'chip', role: 'listitem', on: { click: () => ask(env, s, msgs) } }, s))));
}

function bubble(m: Msg): HTMLElement {
  if (m.role === 'user') return h('div', { class: 'msg me' }, m.text);
  const el = h('div', { class: 'msg bot' });
  // text → paragraphs and bullets, [n] → small citation marks (built with DOM nodes, never innerHTML)
  for (const line of m.text.split('\n')) {
    if (!line.trim()) continue;
    const bullet = /^\s*[•\-*]\s+/.test(line);
    const p = h(bullet ? 'li' : 'p', null);
    const txt = line.replace(/^\s*[•\-*]\s+/, '');
    let last = 0;
    for (const mm of txt.matchAll(/\[(\d)\]/g)) {
      p.append(txt.slice(last, mm.index));
      const n = Number(mm[1]);
      const note = m.notes?.find((x) => x.n === n);
      p.append(h('sup', { class: 'cite', title: note ? `${note.title} — ${note.source}` : '' }, String(n)));
      last = mm.index! + mm[0].length;
    }
    p.append(txt.slice(last));
    if (bullet) {
      const ul = el.lastElementChild?.tagName === 'UL' ? el.lastElementChild : el.appendChild(h('ul', null));
      ul.append(p);
    } else el.append(p);
  }
  if (m.notes?.length) {
    el.append(h('details', { class: 'msg-src' }, h('summary', null, `${m.engine === 'gemini' ? 'Gemini' : 'Saans'} · ${m.notes.length} source${m.notes.length > 1 ? 's' : ''}`),
      h('ol', null, m.notes.map((n) => h('li', null, h('b', null, n.title), ' — ', n.source)))));
  }
  return el;
}

let busy = false;
async function ask(env: SaansEnv, raw: string, msgs: HTMLElement) {
  const q = raw.trim().slice(0, 500);
  if (!q || busy) return;
  busy = true;
  chat.push({ role: 'user', text: q });
  renderMsgs(msgs, env);
  const typing = h('div', { class: 'msg bot typing', 'aria-label': 'Saans is thinking' }, h('i'), h('i'), h('i'));
  msgs.insertBefore(typing, msgs.querySelector('.saans-chips'));
  typing.scrollIntoView({ block: 'end', behavior: 'smooth' });
  const ctx: AssistantContext = { air: airNow, family: load().family, route: env.route() };
  let ans: Msg;
  try {
    if (!env.online()) throw new Error('offline');
    const history = chat.slice(0, -1).slice(-4).map((m) => ({ role: m.role, text: m.text }));
    const r = await api.assistant({ q, ctx, history });
    ans = { role: 'assistant', text: r.text, notes: r.notes, engine: r.engine };
  } catch {
    const r = compose(q, ctx);
    ans = { role: 'assistant', text: r.text, notes: r.notes, engine: 'saans' };
  }
  busy = false;
  chat.push(ans);
  if (!root) return;
  renderMsgs(msgs, env);
  msgs.querySelectorAll('.msg.bot')[msgs.querySelectorAll('.msg.bot').length - 1]?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

/** Tests and "erase my data" clear the conversation. */
export function forgetChat() { chat.length = 0; }
