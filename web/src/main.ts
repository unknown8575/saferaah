import './styles.css';
import { h, clear, fmtDuration, fmtDist } from './dom.ts';
import { SafeMap, loadBasemap } from './map.ts';
import { PlaceSearch, TYPE_ICON, type Entry, type Hit } from './search.ts';
import { load, save, normalisePhone, type Contact } from './store.ts';
import { api, checkServer, isOnline, serverSms, type JourneyHandle } from './api.ts';
import { gpsSource, simulatedSource, type PositionSource } from './location.ts';
import { smsLink, whatsappLink, telLink, shareUrl, arrivalText, startText, sosText, HELPLINES, notifyPhones } from './messages.ts';
import type { RouteReply, WorkerRoute } from './worker.ts';
import { TIER_INFO } from '../../shared/router.ts';
import { CAT_INFO, type Poi, type PoiCat } from '../../shared/places.ts';
import { MODE_INFO, MODES, WALK_KMH, type Mode } from '../../shared/modes.ts';
import { JourneyMonitor, type Fix, type JourneyEvent } from '../../shared/journey.ts';
import { darkness, istTime, IST_OFFSET_MIN } from '../../shared/time.ts';
import type { Profile } from '../../shared/risk.ts';
import type { LonLat } from '../../shared/geo.ts';

const BASE = import.meta.env.BASE_URL;
const params = new URLSearchParams(location.search);
const DEMO = params.has('demo');

// ---------- worker RPC ----------
const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
let rpcId = 0;
const pending = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>();
worker.onmessage = (ev) => {
  const p = pending.get(ev.data.id);
  if (!p) return;
  pending.delete(ev.data.id);
  if (ev.data.type === 'error') p.rej(new Error(ev.data.message)); else p.res(ev.data);
};
function rpc<T = any>(msg: Record<string, unknown>): Promise<T> {
  const id = ++rpcId;
  return new Promise((res, rej) => { pending.set(id, { res, rej }); worker.postMessage({ ...msg, id }); });
}

// ---------- state ----------
interface Place { lonlat: LonLat; label: string; mine?: boolean }
const S = {
  settings: load(),
  version: 'dev',
  snapshot: '',
  bbox: [77.17, 28.515, 77.285, 28.68] as [number, number, number, number],
  onewayKnown: true,
  from: null as Place | null,
  to: null as Place | null,
  leaveAt: null as Date | null, // null = now
  reply: null as RouteReply | null,
  selected: 0,
  view: 'plan' as 'plan' | 'routes' | 'details' | 'journey' | 'arrived' | 'contacts' | 'places' | 'help' | 'track',
  myPos: null as Fix | null,
  pois: [] as Poi[],
  journey: null as null | {
    route: WorkerRoute; monitor: JourneyMonitor; source: PositionSource; handle: JourneyHandle | null;
    pendingFixes: Fix[]; dest: Place; startedAt: number; clock: () => number; offRoute: boolean;
    tickTimer: ReturnType<typeof setInterval>; pushTimer: ReturnType<typeof setInterval>; result?: any; sos?: boolean;
  },
  busy: false,
};
(window as any).__sr = { S, rpc };

const now = () => S.leaveAt ?? new Date();
const inCoverage = (p: LonLat) => p[0] >= S.bbox[0] && p[0] <= S.bbox[2] && p[1] >= S.bbox[1] && p[1] <= S.bbox[3];
function clockText(d: Date): string {
  const m = istTime(d).minutes;
  const hh = Math.floor(m / 60), mm = m % 60;
  return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'am' : 'pm'}`;
}

// ---------- layout ----------
const app = document.getElementById('app')!;
const mapEl = h('div', { id: 'map', role: 'application', 'aria-label': 'Map' });
const sheet = h('section', { id: 'sheet', 'aria-live': 'polite' });
const topbar = h('header', { id: 'topbar' });
const sosBtn = h('button', { id: 'sos', class: 'sos', 'aria-label': 'SOS emergency', on: { click: () => openSos() } }, 'SOS');
const toastEl = h('div', { id: 'toast', role: 'status' });
const modal = h('div', { id: 'modal', hidden: true });
app.append(mapEl, topbar, sheet, sosBtn, toastEl, modal);
// keep the SOS button just above the sheet, whatever its current height
new ResizeObserver(() => {
  const h = sheet.offsetParent ? sheet.getBoundingClientRect().height : 0;
  // if the sheet covers most of the screen, keep SOS reachable over the map's top area
  document.documentElement.style.setProperty('--sheet-h', `${Math.min(h, window.innerHeight - 170)}px`);
}).observe(sheet);

let toastTimer: ReturnType<typeof setTimeout>;
function toast(msg: string, ms = 3500) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
}

let smap: SafeMap;
let search: PlaceSearch;

// ---------- boot ----------
async function boot() {
  clear(sheet, h('div', { class: 'loading' }, h('div', { class: 'spinner' }), h('p', null, 'Loading the map of Delhi…')));
  try {
    const [ver, basemap, searchEntries] = await Promise.all([
      fetch(BASE + 'data/version.json').then((r) => r.json()).catch(() => ({ version: 'dev' })),
      loadBasemap(BASE),
      fetch(BASE + 'data/search.json').then((r) => r.json() as Promise<Entry[]>),
    ]);
    S.version = ver.version;
    S.snapshot = ver.snapshot ?? '';
    search = new PlaceSearch(searchEntries);
    smap = new SafeMap(mapEl, BASE, basemap.bounds);
    (window as any).__sr.map = smap.map;
    smap.map.on('error', (e: any) => console.warn('map error', e?.error?.message ?? e));
    smap.onRouteClick((i) => selectRoute(i));
    setupMapPicking();
    const ready = await rpc<{ meta: any }>({ type: 'init', base: new URL(BASE, location.href).href, graphParts: ver.graphParts });
    S.bbox = ready.meta.bbox; S.onewayKnown = ready.meta.onewayKnown;
    S.pois = await fetch(BASE + 'data/pois.json').then((r) => r.json());
    refreshPois();
    checkServer().then(async (ok) => {
      if (!ok) return;
      try { const c = await api.crowd(S.version); await rpc({ type: 'crowd', stats: c.stats }); } catch { /* crowd data optional */ }
    });
  } catch (err) {
    clear(sheet, h('div', { class: 'pad' }, h('h2', null, 'The map could not load'),
      h('p', null, String((err as Error).message)), h('button', { class: 'btn primary', on: { click: () => location.reload() } }, 'Try again')));
    return;
  }
  renderTopbar();
  const track = params.get('track');
  if (track) { showTrack(track); return; }
  if (DEMO) save({ simulate: true });
  const pf = params.get('from'), pt = params.get('to');
  if (pf) S.from = { lonlat: pf.split(',').map(Number) as LonLat, label: params.get('fromName') ?? 'Start' };
  if (pt) S.to = { lonlat: pt.split(',').map(Number) as LonLat, label: params.get('toName') ?? 'Destination' };
  const t = params.get('t');
  if (t && /^\d{1,2}:\d{2}$/.test(t)) S.leaveAt = timeToday(t);
  const md = params.get('mode') as Mode | null;
  if (md && MODES.includes(md)) save({ mode: md });
  const pr = params.get('who') as Profile | null;
  if (pr && ['woman', 'child', 'general'].includes(pr)) save({ profile: pr });
  S.settings = load();
  applyTheme();
  if (S.from && S.to) { await planRoutes(); return; }
  showPlan();
  if (!S.settings.seenIntro && !DEMO) showIntro();
}

function timeToday(hhmm: string): Date {
  // interpret HH:MM as Delhi time today (or tomorrow if it already passed by > 1 h)
  const [hh, mm] = hhmm.split(':').map(Number);
  const nowIst = new Date(Date.now() + IST_OFFSET_MIN * 60000);
  const d = new Date(Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), nowIst.getUTCDate(), hh, mm) - IST_OFFSET_MIN * 60000);
  if (d.getTime() < Date.now() - 3600000) d.setTime(d.getTime() + 86400000);
  return d;
}

function applyTheme() {
  const night = darkness(now()) >= 0.5;
  document.documentElement.dataset.theme = night ? 'night' : 'day';
  smap?.setTheme(night ? 'night' : 'day');
}

async function refreshPois() {
  const r = await rpc<{ open: Uint8Array }>({ type: 'open', when: now().toISOString() });
  smap.setPois(S.pois, r.open);
}

// ---------- top bar ----------
function renderTopbar() {
  clear(topbar,
    h('div', { class: 'brand', 'aria-label': 'SafeRaah' }, h('span', { class: 'logo', 'aria-hidden': 'true' }), 'SafeRaah'),
    h('nav', null,
      h('button', { class: 'icon-btn', 'aria-label': 'Safe places near me', title: 'Safe places near me', on: { click: () => showPlaces() } }, '🏥'),
      h('button', { class: 'icon-btn', 'aria-label': 'Contacts and settings', title: 'Contacts and settings', on: { click: () => showContacts() } }, '👥'),
      h('button', { class: 'icon-btn', 'aria-label': 'Help', title: 'Help', on: { click: () => showHelp() } }, '?'),
    ),
  );
}

// ---------- plan ----------
let picking: 'from' | 'to' | null = null;
function setupMapPicking() {
  const pickAt = (lngLat: { lng: number; lat: number }, which: 'from' | 'to') => {
    const p: LonLat = [+lngLat.lng.toFixed(6), +lngLat.lat.toFixed(6)];
    if (!inCoverage(p)) { toast('That point is outside the area this map covers (Delhi NCT).'); return; }
    const label = nearestLabel(p);
    if (which === 'from') S.from = { lonlat: p, label }; else S.to = { lonlat: p, label };
    picking = null;
    document.body.classList.remove('picking');
    afterPlaceChange();
  };
  smap.map.on('click', (e) => { if (picking) pickAt(e.lngLat, picking); });
  const canPick = () => S.view === 'plan' || S.view === 'routes';
  smap.map.on('contextmenu', (e) => { if (canPick()) pickAt(e.lngLat, 'to'); });
  // iOS Safari never fires contextmenu on touch, so detect a long-press ourselves
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  let pressAt: { x: number; y: number } | null = null;
  const cancel = () => { if (pressTimer) clearTimeout(pressTimer); pressTimer = null; };
  smap.map.on('touchstart', (e) => {
    if (!canPick() || e.originalEvent.touches.length !== 1) return cancel();
    pressAt = { x: e.point.x, y: e.point.y };
    const lngLat = e.lngLat;
    cancel();
    pressTimer = setTimeout(() => { pressTimer = null; navigator.vibrate?.(30); pickAt(lngLat, 'to'); }, 600);
  });
  smap.map.on('touchmove', (e) => { if (pressAt && Math.hypot(e.point.x - pressAt.x, e.point.y - pressAt.y) > 10) cancel(); });
  smap.map.on('touchend', cancel);
  smap.map.on('touchcancel', cancel);
  smap.map.on('movestart', (e) => { if ((e as { originalEvent?: Event }).originalEvent) cancel(); });
}

function nearestLabel(p: LonLat): string {
  // nearest named place within 300 m, else coordinates
  let best: Poi | null = null, bd = 300;
  for (const q of S.pois) {
    if (!q.name) continue;
    const d = Math.hypot((q.lon - p[0]) * 97600, (q.lat - p[1]) * 111200);
    if (d < bd) { bd = d; best = q; }
  }
  return best ? `Near ${best.name}` : `${p[1].toFixed(4)}, ${p[0].toFixed(4)}`;
}

async function useMyLocation(): Promise<boolean> {
  if (DEMO || S.settings.simulate) {
    S.from = { lonlat: [77.2197, 28.6328], label: 'My location (demo: Rajiv Chowk)', mine: true };
    return true;
  }
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) { toast('Location is not available on this device. Search for a start point.'); resolve(false); return; }
    navigator.geolocation.getCurrentPosition((pos) => {
      const p: LonLat = [pos.coords.longitude, pos.coords.latitude];
      S.myPos = { lon: p[0], lat: p[1], acc: pos.coords.accuracy, t: Date.now() };
      if (!inCoverage(p)) { toast('You are outside the area this map covers (Delhi NCT). Search for a start point.', 5000); resolve(false); return; }
      S.from = { lonlat: p, label: 'My location', mine: true };
      smap.setMe(p);
      resolve(true);
    }, (e) => {
      toast(e.code === 1 ? 'Location permission is off. Search for a start point instead.' : 'Could not find your location. Search for a start point.', 5000);
      resolve(false);
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
  });
}

function placeField(which: 'from' | 'to'): HTMLElement {
  const val = which === 'from' ? S.from : S.to;
  const input = h('input', {
    type: 'search', class: 'field-input', id: `f-${which}`, autocomplete: 'off', enterkeyhint: 'search',
    placeholder: which === 'from' ? 'Start: my location' : 'Where to?', value: val?.label ?? '',
    'aria-label': which === 'from' ? 'Start point' : 'Destination',
  });
  const list = h('ul', { class: 'suggest', role: 'listbox', hidden: true });
  const choose = (hit: Hit | 'me' | 'map') => {
    list.hidden = true;
    if (hit === 'me') { useMyLocation().then((ok) => { if (ok) afterPlaceChange(); }); return; }
    if (hit === 'map') {
      picking = which; document.body.classList.add('picking');
      toast(which === 'from' ? 'Tap the map to set the start' : 'Tap the map to set the destination', 4000);
      return;
    }
    const p = { lonlat: [hit.lon, hit.lat] as LonLat, label: hit.name };
    if (which === 'from') S.from = p; else S.to = p;
    afterPlaceChange();
  };
  const render = () => {
    const q = input.value;
    const near = S.from?.lonlat ?? [77.215, 28.6];
    const hits = search.query(q, 7, near as [number, number]);
    const items: HTMLElement[] = [];
    if (which === 'from') items.push(h('li', { role: 'option', tabindex: 0, on: { click: () => choose('me') } }, h('span', { class: 'ic' }, '📍'), 'Use my location'));
    items.push(...hits.map((x) => h('li', { role: 'option', tabindex: 0, on: { click: () => choose(x) } },
      h('span', { class: 'ic' }, TYPE_ICON[x.type] ?? '📌'), h('span', null, x.name), h('small', null, typeLabel(x.type)))));
    items.push(h('li', { role: 'option', tabindex: 0, on: { click: () => choose('map') } }, h('span', { class: 'ic' }, '👆'), 'Choose on the map'));
    if (q.length >= 2 && !hits.length) items.splice(which === 'from' ? 1 : 0, 0, h('li', { class: 'empty' }, `No place called “${q}” in Delhi. Try a nearby metro station or market.`));
    clear(list, items);
    list.hidden = false;
  };
  input.addEventListener('input', render);
  input.addEventListener('focus', () => { input.select(); render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const first = list.querySelector('li[role=option]:not(:first-child), li[role=option]') as HTMLElement | null; first?.click(); }
    if (e.key === 'Escape') list.hidden = true;
  });
  input.addEventListener('blur', () => setTimeout(() => (list.hidden = true), 200));
  return h('div', { class: `field field-${which}` }, h('span', { class: `dot dot-${which}`, 'aria-hidden': 'true' }), input, list);
}

function typeLabel(t: string): string {
  if (t === 'street') return 'Street';
  if (t === 'station') return 'Metro / rail';
  const extra: Record<string, string> = { landmark: 'Landmark', park: 'Park', market: 'Market', school: 'School / college', office: 'Office' };
  if (extra[t]) return extra[t];
  return (CAT_INFO as Record<string, { label: string }>)[t]?.label ?? (t === 'place' ? 'Place' : t.charAt(0).toUpperCase() + t.slice(1));
}

function chips<T extends string>(name: string, options: { v: T; label: string; icon: string }[], cur: T, onPick: (v: T) => void) {
  return h('div', { class: 'chips', role: 'radiogroup', 'aria-label': name },
    options.map((o) => h('button', {
      class: `chip${o.v === cur ? ' on' : ''}`, role: 'radio', 'aria-checked': o.v === cur ? 'true' : 'false', 'data-v': o.v,
      on: { click: () => onPick(o.v) },
    }, h('span', { 'aria-hidden': 'true' }, o.icon), o.label)));
}

function showPlan() {
  S.view = 'plan';
  smap?.clearRoutes();
  sheet.className = 'plan';
  const st = S.settings;
  const timeInput = h('input', { type: 'time', class: 'time-input', 'aria-label': 'Leave at', value: S.leaveAt ? isoClock(S.leaveAt) : '' });
  timeInput.addEventListener('change', () => { S.leaveAt = timeInput.value ? timeToday(timeInput.value) : null; applyTheme(); refreshPois(); showPlan(); maybeAutoPlan(); });
  clear(sheet,
    h('div', { class: 'grip', 'aria-hidden': 'true' }),
    h('div', { class: 'fields' }, placeField('from'), placeField('to')),
    h('div', { class: 'group' }, h('h3', null, 'Who is travelling?'),
      chips<Profile>('Who is travelling', [
        { v: 'woman', label: 'Woman', icon: '👩' }, { v: 'child', label: 'Child', icon: '🧒' }, { v: 'general', label: 'Anyone', icon: '🙂' },
      ], st.profile, (v) => { S.settings = save({ profile: v }); showPlan(); maybeAutoPlan(); })),
    h('div', { class: 'group' }, h('h3', null, 'How?'),
      chips<Mode>('How are you travelling', MODES.map((m) => ({ v: m, label: MODE_INFO[m].label, icon: MODE_INFO[m].emoji })),
        st.mode, (v) => { S.settings = save({ mode: v }); showPlan(); maybeAutoPlan(); })),
    h('div', { class: 'group row' }, h('h3', null, 'When?'),
      h('button', { class: `chip${S.leaveAt ? '' : ' on'}`, on: { click: () => { S.leaveAt = null; applyTheme(); refreshPois(); showPlan(); maybeAutoPlan(); } } }, 'Now'),
      h('label', { class: `chip time${S.leaveAt ? ' on' : ''}` }, 'Leave at ', timeInput)),
    S.from && S.to ? h('button', { class: 'btn primary wide', id: 'go', on: { click: () => planRoutes() } }, 'Show safe routes') :
      h('p', { class: 'hint' }, S.to ? 'Choose a start point, or use your location.' : 'Search a place, or long-press the map to set where you are going.'),
  );
  smap?.setEndpoints(S.from?.lonlat, S.to?.lonlat);
}

function isoClock(d: Date): string {
  const m = istTime(d).minutes;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function afterPlaceChange() {
  smap.setEndpoints(S.from?.lonlat, S.to?.lonlat);
  if (S.to && !S.from) { useMyLocation().then((ok) => { if (ok) planRoutes(); else showPlan(); }); return; }
  if (S.from && S.to) { planRoutes(); return; }
  if (S.to) smap.map.flyTo({ center: S.to.lonlat, zoom: 15 });
  showPlan();
}

function maybeAutoPlan() { /* plan screen waits for the button; routes screen re-plans on change */ }

// ---------- routes ----------
async function planRoutes() {
  if (!S.from || !S.to) { showPlan(); return; }
  if (!inCoverage(S.from.lonlat) || !inCoverage(S.to.lonlat)) { toast('Both points must be inside Delhi NCT for now.'); showPlan(); return; }
  S.view = 'routes';
  sheet.className = 'routes';
  clear(sheet, h('div', { class: 'grip' }), summaryBar(), h('div', { class: 'loading small' }, h('div', { class: 'spinner' }), h('p', null, 'Checking which streets are busy and open right now…')));
  applyTheme();
  smap.setEndpoints(S.from.lonlat, S.to.lonlat);
  try {
    const r = await rpc<{ reply: RouteReply }>({
      type: 'route', from: S.from.lonlat, to: S.to.lonlat, mode: S.settings.mode, when: now().toISOString(), profile: S.settings.profile,
    });
    S.reply = r.reply;
  } catch (err) {
    S.reply = null;
    clear(sheet, h('div', { class: 'grip' }), summaryBar(), h('div', { class: 'pad' }, h('p', { class: 'error' }, 'Routing failed: ' + (err as Error).message)));
    return;
  }
  const safest = S.reply.routes.findIndex((x) => x.labels.includes('Safest') || x.labels.includes('Also safest'));
  S.selected = Math.max(0, safest);
  renderRoutes();
  if (S.reply.routes.length) smap.fit(S.reply.routes.flatMap((x) => x.coords), fitPad());
  refreshPois();
}

function fitPad() {
  const wide = window.innerWidth >= 860;
  return wide ? { top: 80, bottom: 60, left: 440, right: 60 } : { top: 80, bottom: Math.round(window.innerHeight * 0.54), left: 40, right: 90 };
}

function summaryBar() {
  return h('div', { class: 'summary' },
    h('button', { class: 'back', 'aria-label': 'Change trip', on: { click: () => showPlan() } }, '‹'),
    h('div', { class: 'summary-text', on: { click: () => showPlan() } },
      h('div', { class: 'from-to' }, h('span', { class: 'dot dot-from' }), S.from?.label ?? '', h('br'), h('span', { class: 'dot dot-to' }), S.to?.label ?? ''),
      h('div', { class: 'meta' }, `${MODE_INFO[S.settings.mode].emoji} ${MODE_INFO[S.settings.mode].label}, ${S.settings.profile === 'child' ? 'child' : S.settings.profile === 'woman' ? 'woman' : 'anyone'}, ${S.leaveAt ? 'leaving ' + clockText(S.leaveAt) : 'leaving now'}`)),
  );
}

function selectRoute(i: number) {
  if (!S.reply || (S.view !== 'routes' && S.view !== 'details')) return;
  S.selected = i;
  if (S.view === 'details') showDetails(); else renderRoutes();
}

function tierBadge(r: WorkerRoute) {
  const t = TIER_INFO[r.tier];
  const icon = r.tier === 'green' ? '✓' : r.tier === 'yellow' ? '!' : '⚠';
  return h('span', { class: `tier tier-${r.tier}` }, h('span', { 'aria-hidden': 'true' }, icon), t.label);
}

function renderRoutes() {
  const R = S.reply!;
  smap.showRoutes(R.routes, S.selected);
  const adv = R.advice;
  const vehicleNote = S.settings.mode !== 'walk' && !S.onewayKnown;
  clear(sheet,
    h('div', { class: 'grip' }), summaryBar(),
    R.error ? h('div', { class: 'pad' }, h('p', { class: 'error' }, R.error), h('button', { class: 'btn', on: { click: () => showPlan() } }, 'Change trip')) : null,
    adv ? h('div', { class: `advice advice-${adv.level}` },
      h('strong', null, adv.title), h('p', null, adv.body),
      adv.suggestMode ? h('button', { class: 'btn small', on: { click: () => { S.settings = save({ mode: adv.suggestMode! }); planRoutes(); } } },
        `Show ${MODE_INFO[adv.suggestMode].label.toLowerCase()} routes`) : null) : null,
    h('ol', { class: 'route-list', 'aria-label': 'Routes, fastest first' },
      R.routes.map((r, i) => {
        return h('li', null, h('button', {
          class: `route-card${i === S.selected ? ' sel' : ''}`, 'aria-pressed': i === S.selected ? 'true' : 'false', 'data-tier': r.tier,
          on: { click: () => { if (S.selected === i) showDetails(); else selectRoute(i); } },
        },
        h('span', { class: 'swatch', style: { background: TIER_INFO[r.tier].color } }),
        h('span', { class: 'rc-main' },
          h('span', { class: 'rc-time' }, fmtDuration(r.timeS)),
          h('span', { class: 'rc-sub' }, fmtDist(r.lengthM), r.labels.filter((l) => l !== 'Also safest').map((l) => h('span', { class: `lbl lbl-${l.toLowerCase()}` }, l)))),
        h('span', { class: 'rc-side' }, tierBadge(r),
          h('span', { class: 'rc-why' }, r.warnings[0] ?? havenLine(r)))));
      })),
    R.note ? h('p', { class: 'note' }, R.note) : null,
    vehicleNote ? h('p', { class: 'note' }, 'One-way streets are not in this map yet. Follow road signs.') : null,
    R.routes.length ? h('div', { class: 'actions' },
      h('button', { class: 'btn', on: { click: () => showDetails() } }, 'Why this colour?'),
      h('button', { class: 'btn primary', id: 'start', on: { click: () => startJourney() } }, 'Start journey')) : null,
  );
}

function havenLine(r: WorkerRoute): string {
  const parts: string[] = [];
  const order: PoiCat[] = ['police', 'hospital', 'pharmacy', 'station', 'fuel', 'shop', 'food'];
  const NOUN: Partial<Record<PoiCat, [string, string]>> = {
    police: ['police post', 'police posts'], hospital: ['hospital', 'hospitals'], pharmacy: ['medical store', 'medical stores'],
    station: ['metro/rail station', 'metro/rail stations'], fuel: ['petrol pump', 'petrol pumps'], shop: ['shop', 'shops'], food: ['eatery', 'eateries'],
  };
  for (const c of order) { const n = r.havens[c]; if (n) parts.push(`${n} ${NOUN[c]![n > 1 ? 1 : 0]}`); }
  return parts.length ? `Open on the way: ${parts.slice(0, 3).join(', ')}` : 'Few places open on the way';
}

// ---------- details ----------
function showDetails() {
  if (!S.reply?.routes.length) return;
  S.view = 'details';
  sheet.className = 'details';
  const r = S.reply.routes[S.selected];
  smap.showRoutes(S.reply.routes, S.selected);
  const contacts = S.settings.contacts;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const dark = darkness(now()) >= 0.5;
  clear(sheet,
    h('div', { class: 'grip' }),
    h('div', { class: 'summary' }, h('button', { class: 'back', 'aria-label': 'Back to routes', on: { click: () => { S.view = 'routes'; sheet.className = 'routes'; renderRoutes(); } } }, '‹'),
      h('div', { class: 'summary-text' }, h('div', { class: 'big-time' }, fmtDuration(r.timeS), ' ', tierBadge(r)), h('div', { class: 'meta' }, `${fmtDist(r.lengthM)} by ${MODE_INFO[S.settings.mode].label.toLowerCase()}, arrive about ${clockText(new Date(now().getTime() + r.timeS * 1000))}`))),
    h('div', { class: 'pad' },
      h('h3', null, 'Why this colour'),
      h('ul', { class: 'facts' },
        h('li', null, h('b', null, pct(r.mainRoadShare)), ' on main roads'),
        dark ? h('li', null, h('b', null, pct(r.litShare)), ' on roads that are usually lit') : null,
        h('li', null, h('b', null, pct(r.policeShare)), ' within 500 m of a police station'),
        h('li', null, h('b', null, String(r.havenIds.length)), ` places open along the way at ${clockText(now())}`)),
      r.dangerSpots.length ? [h('h3', null, 'Risky stretches'), h('ul', { class: 'spots' }, r.dangerSpots.map((d) =>
        h('li', null, h('button', { class: 'linkish', on: { click: () => smap.map.flyTo({ center: [d.lon, d.lat], zoom: 16.5 }) } },
          h('span', { class: 'warn-ic' }, '!'), `${fmtDist(d.lengthM)}: ${d.reasons.join(', ') || 'quiet at this hour'}`))))] : null,
      r.havenList.length ? [h('h3', null, 'Safe places open on the way'), h('ul', { class: 'havens' }, r.havenList.slice(0, 8).map((p) =>
        h('li', null, h('span', { 'aria-hidden': 'true' }, CAT_INFO[p.cat].icon), h('span', null, p.name || CAT_INFO[p.cat].label),
          h('small', null, p.verified ? 'open now' : 'open now (estimated hours)'))))] : null,
      h('h3', null, 'Tell when I reach'),
      contacts.length ? h('div', { class: 'chips' }, contacts.map((c) => h('button', {
        class: `chip${c.notify ? ' on' : ''}`, 'aria-pressed': c.notify ? 'true' : 'false',
        on: { click: () => { c.notify = !c.notify; S.settings = save({ contacts }); showDetails(); } },
      }, c.notify ? '✓ ' : '', c.name)), h('button', { class: 'chip', on: { click: () => showContacts() } }, '+ Add')) :
        h('p', null, h('button', { class: 'linkish', on: { click: () => showContacts() } }, 'Add a trusted contact'), ' to send an arrival message.'),
      h('details', { class: 'steps' }, h('summary', null, 'Directions'),
        h('ol', null, r.steps.map((s) => h('li', null, s.text, s.distM ? h('small', null, ` ${fmtDist(s.distM)}`) : null)))),
      h('p', { class: 'fine' }, 'Scores describe the street environment at this hour (open places, police, busy roads, lighting, parks and traveller reviews). They help you choose; they cannot guarantee safety.'),
    ),
    h('div', { class: 'actions sticky' }, h('button', { class: 'btn primary wide', id: 'start', on: { click: () => startJourney() } }, 'Start journey')),
  );
}

// ---------- journey ----------
async function startJourney() {
  if (!S.reply?.routes.length || !S.to) return;
  const route = S.reply.routes[S.selected];
  const startedAt = Date.now();
  const sim = S.settings.simulate || DEMO;
  const monitor = new JourneyMonitor({
    mode: S.settings.mode, route: route.coords, segTier: route.segTier, dest: route.coords[route.coords.length - 1],
    etaS: route.timeS, startedAt,
  });
  let handle: JourneyHandle | null = null;
  if (isOnline()) {
    try {
      handle = await api.startJourney({ mode: S.settings.mode, route: route.coords, edges: route.edges, dest: route.coords[route.coords.length - 1],
        etaS: route.timeS, graphVersion: S.version, name: S.settings.travellerName || undefined, simulated: sim });
    } catch (err) { toast('Live sharing is unavailable: ' + (err as Error).message); }
  }
  const speedMps = S.settings.mode === 'walk' ? WALK_KMH / 3.6 : route.lengthM / route.timeS;
  const pauseAt = params.get('pause') ? { atFrac: Number(params.get('pause')), seconds: Number(params.get('pauseS') ?? 300) } : undefined;
  const source = sim ? simulatedSource(route.coords, speedMps, Number(params.get('speed') ?? 30), pauseAt) : gpsSource();
  let lastT = startedAt;
  const J = {
    route, monitor, source, handle, pendingFixes: [] as Fix[], dest: S.to, startedAt, offRoute: false,
    clock: () => (sim ? lastT : Date.now()),
    tickTimer: setInterval(() => handleEvents(monitor.tick(J.clock())), 15000),
    pushTimer: setInterval(() => flushFixes(), 10000),
  };
  S.journey = J;
  S.view = 'journey';
  sheet.className = 'journey';
  smap.showRoutes([route], 0);
  source.start((f) => {
    lastT = f.t;
    S.myPos = f;
    J.pendingFixes.push(f);
    smap.setMe([f.lon, f.lat]);
    if (!userPanned) smap.map.easeTo({ center: [f.lon, f.lat], zoom: Math.max(smap.map.getZoom(), 15.5), duration: 400 });
    handleEvents(monitor.feed(f));
    if (S.view === 'journey') renderJourney();
  }, (msg) => toast(msg, 6000));
  // optional server SMS on start
  const phones = notifyPhones(S.settings.contacts);
  if (handle && serverSms() && phones.length) {
    api.notify(handle, phones, startText(S.settings.travellerName, S.to.label, clockText(new Date(startedAt + route.timeS * 1000)), shareUrl(handle.shareId))).catch(() => {});
  }
  renderJourney();
}

let userPanned = false;
let lastStepIdx = -1;

function renderJourney() {
  const J = S.journey;
  if (!J) return;
  const f = S.myPos;
  const coords = J.route.coords;
  // progress: nearest vertex
  let ni = 0;
  if (f) {
    let bd = Infinity;
    for (let i = 0; i < coords.length; i++) {
      const d = (coords[i][0] - f.lon) ** 2 + (coords[i][1] - f.lat) ** 2;
      if (d < bd) { bd = d; ni = i; }
    }
  }
  let remain = 0;
  for (let i = ni; i < coords.length - 1; i++) remain += Math.hypot((coords[i + 1][0] - coords[i][0]) * 97600, (coords[i + 1][1] - coords[i][1]) * 111200);
  const remainS = J.route.lengthM > 0 ? J.route.timeS * (remain / J.route.lengthM) : 0;
  const next = J.route.steps.find((s) => s.idx > ni) ?? J.route.steps[J.route.steps.length - 1];
  let toNext = 0;
  for (let i = ni; i < Math.min(next.idx, coords.length - 1); i++) toNext += Math.hypot((coords[i + 1][0] - coords[i][0]) * 97600, (coords[i + 1][1] - coords[i][1]) * 111200);
  if (next.idx !== lastStepIdx && 'vibrate' in navigator && lastStepIdx >= 0) navigator.vibrate?.(60);
  lastStepIdx = next.idx;
  const clockNow = new Date(J.clock());
  clear(sheet,
    h('div', { class: 'instruction', role: 'status' }, h('span', { class: `turn turn-${next.turn}`, 'aria-hidden': 'true' }, turnGlyph(next.turn)),
      h('div', null, h('b', null, next.text), next.turn !== 'arrive' ? h('div', { class: 'meta' }, `in ${fmtDist(toNext)}`) : null)),
    J.offRoute ? h('div', { class: 'advice advice-caution' }, h('strong', null, 'You left the route'),
      h('button', { class: 'btn small', on: { click: () => reroute() } }, 'Find a new safe route')) : null,
    h('div', { class: 'journey-row' },
      h('div', null, h('div', { class: 'big-time' }, fmtDuration(remainS)), h('div', { class: 'meta' }, `${fmtDist(remain)} left, arrive ${clockText(new Date(clockNow.getTime() + remainS * 1000))}`)),
      h('div', { class: 'journey-actions' },
        h('button', { class: 'btn', on: { click: () => shareTrip() } }, J.handle ? 'Share live trip' : 'Share trip'),
        h('button', { class: 'btn ghost', on: { click: () => endJourney(false) } }, 'End'))),
    J.handle ? h('p', { class: 'fine live' }, h('span', { class: 'live-dot' }), 'Live trip link is active') : h('p', { class: 'fine' }, isOnline() ? '' : 'Offline: live sharing and reviews need an internet connection.'),
    (S.settings.simulate || DEMO) ? h('p', { class: 'fine' }, 'Demo mode: your movement is simulated.') : null,
  );
}

function turnGlyph(t: string): string {
  return ({ start: '↑', straight: '↑', slight_left: '↖', left: '←', sharp_left: '↙', slight_right: '↗', right: '→', sharp_right: '↘', uturn: '↶', arrive: '⚑' } as Record<string, string>)[t] ?? '↑';
}

function handleEvents(evs: JourneyEvent[]) {
  const J = S.journey;
  if (!J) return;
  for (const e of evs) {
    if (e.type === 'arrived') { onArrived(); return; }
    if (e.type === 'off_route') { J.offRoute = true; toast('You are off the planned route.'); }
    if (e.type === 'back_on_route') J.offRoute = false;
    if (e.type === 'stopped') checkIn(`You have not moved for ${e.minutes} min${e.onRiskySegment ? ' on a quiet stretch' : ''}.`, 'stopped');
    if (e.type === 'overdue') checkIn(`You are ${e.minutesLate} min later than expected.`, 'overdue');
  }
}

async function flushFixes() {
  const J = S.journey;
  if (!J?.handle || !J.pendingFixes.length) return;
  const batch = J.pendingFixes.splice(0, 400);
  try { await api.pushFixes(J.handle, batch); } catch { J.pendingFixes.unshift(...batch); }
}

async function shareTrip() {
  const J = S.journey;
  if (!J) return;
  const link = J.handle ? shareUrl(J.handle.shareId) : undefined;
  const text = startText(S.settings.travellerName, J.dest.label, clockText(new Date(J.startedAt + J.route.timeS * 1000)), link);
  if (navigator.share) {
    try { await navigator.share({ title: 'My trip', text, url: link }); return; } catch { /* cancelled */ }
  }
  showMessageSheet('Share your trip', text);
}

function showMessageSheet(title: string, text: string, onClose?: () => void) {
  const phones = notifyPhones(S.settings.contacts);
  openModal(h('div', { class: 'modal-card' },
    h('h2', null, title),
    h('p', { class: 'msg-preview' }, text),
    phones.length ? h('a', { class: 'btn primary wide', href: smsLink(phones, text) }, `Send SMS to ${S.settings.contacts.filter((c) => c.notify).map((c) => c.name).join(', ')}`) :
      h('p', null, 'No contacts selected. ', h('button', { class: 'linkish', on: { click: () => { closeModal(); showContacts(); } } }, 'Add a contact')),
    S.settings.contacts.filter((c) => c.notify).map((c) => h('a', { class: 'btn wide', href: whatsappLink(c.phone, text), target: '_blank', rel: 'noopener' }, `WhatsApp ${c.name}`)),
    h('button', { class: 'btn ghost wide', on: { click: () => { navigator.clipboard?.writeText(text).then(() => toast('Copied')); } } }, 'Copy text'),
    h('button', { class: 'btn ghost wide', on: { click: () => { closeModal(); onClose?.(); } } }, 'Close'),
  ));
}

function openModal(content: HTMLElement) {
  clear(modal, content);
  modal.hidden = false;
  (content.querySelector('button, a') as HTMLElement | null)?.focus();
}
function closeModal() { modal.hidden = true; clear(modal); if (checkTimer) { clearInterval(checkTimer); checkTimer = null; } }

let checkTimer: ReturnType<typeof setInterval> | null = null;
function checkIn(reason: string, kind: 'stopped' | 'overdue') {
  if (!S.journey || checkTimer || S.journey.sos) return;
  let left = 30;
  const count = h('div', { class: 'countdown', 'aria-live': 'assertive' }, `0:${left}`);
  navigator.vibrate?.([200, 100, 200]);
  openModal(h('div', { class: 'modal-card checkin', role: 'alertdialog', 'aria-label': 'Are you OK?' },
    h('h2', null, 'Are you OK?'), h('p', null, reason), count,
    h('div', { class: 'row2' },
      h('button', { class: 'btn ok', id: 'im-ok', on: { click: () => { closeModal(); S.journey?.monitor.acknowledge(kind, S.journey.clock()); toast('Glad you are OK. We will keep watching the trip.'); } } }, "I'm OK"),
      h('button', { class: 'btn danger', on: { click: () => { closeModal(); openSos(); } } }, 'Send SOS')),
    h('p', { class: 'fine' }, 'If you do not answer, SOS opens automatically.'),
  ));
  checkTimer = setInterval(() => {
    left--;
    count.textContent = `0:${String(left).padStart(2, '0')}`;
    if (left <= 0) { closeModal(); openSos(true); }
  }, 1000);
}

async function openSos(auto = false) {
  const J = S.journey;
  if (J) J.sos = true;
  const pos: LonLat = S.myPos ? [S.myPos.lon, S.myPos.lat] : S.from?.lonlat ?? (smap ? [smap.map.getCenter().lng, smap.map.getCenter().lat] : [77.21, 28.61]);
  const link = J?.handle ? shareUrl(J.handle.shareId) : undefined;
  const text = sosText(S.settings.travellerName, pos[0], pos[1], link);
  const phones = S.settings.contacts.map((c) => c.phone);
  let serverNote = '';
  if (J?.handle) {
    try {
      const r = await api.sos(J.handle, phones, text);
      serverNote = r.smsSent ? `SOS SMS sent to ${r.smsSent} contact${r.smsSent > 1 ? 's' : ''}. ` : '';
    } catch { /* fall back to links */ }
  }
  navigator.vibrate?.([300, 100, 300, 100, 300]);
  openModal(h('div', { class: 'modal-card sos-card', role: 'alertdialog', 'aria-label': 'SOS' },
    h('h2', null, auto ? 'No answer, so SOS is open' : 'SOS'),
    serverNote ? h('p', null, serverNote) : null,
    h('a', { class: 'btn danger wide big', href: telLink('112') }, 'Call 112'),
    phones.length ? h('a', { class: 'btn primary wide', href: smsLink(phones, text) }, 'Send SOS SMS to all contacts') :
      h('p', null, 'You have no trusted contacts yet.'),
    S.settings.contacts.map((c) => h('a', { class: 'btn wide', href: whatsappLink(c.phone, text), target: '_blank', rel: 'noopener' }, `WhatsApp ${c.name}`)),
    h('details', null, h('summary', null, 'Other helplines'),
      h('ul', { class: 'helplines' }, HELPLINES.map((x) => h('li', null, h('a', { href: telLink(x.n) }, x.n), ` ${x.label}`)))),
    h('button', { class: 'btn ghost wide', on: { click: () => { closeModal(); if (J) J.sos = false; } } }, 'I am safe, close'),
  ));
}

async function reroute() {
  const J = S.journey;
  if (!J || !S.myPos) return;
  S.from = { lonlat: [S.myPos.lon, S.myPos.lat], label: 'My location', mine: true };
  stopJourney();
  S.leaveAt = null;
  await planRoutes();
}

function stopJourney() {
  const J = S.journey;
  if (!J) return;
  J.source.stop();
  clearInterval(J.tickTimer);
  clearInterval(J.pushTimer);
}

async function endJourney(confirmed: boolean) {
  if (!confirmed) {
    openModal(h('div', { class: 'modal-card' }, h('h2', null, 'End this trip?'), h('p', null, 'Your contacts will not get an arrival message.'),
      h('div', { class: 'row2' }, h('button', { class: 'btn ghost', on: { click: () => closeModal() } }, 'Keep going'),
        h('button', { class: 'btn danger', on: { click: () => { closeModal(); endJourney(true); } } }, 'End trip'))));
    return;
  }
  stopJourney();
  const J = S.journey;
  if (J?.handle) { await flushFixes(); api.finish(J.handle).catch(() => {}); }
  S.journey = null;
  smap.setMe(undefined);
  showPlan();
}

async function onArrived() {
  const J = S.journey!;
  stopJourney();
  await flushFixes();
  let result: any = null;
  if (J.handle) { try { result = await api.finish(J.handle); } catch { result = null; } }
  J.result = result;
  S.view = 'arrived';
  sheet.className = 'arrived';
  const msg = arrivalText(S.settings.travellerName, J.dest.label, clockText(new Date(J.clock())));
  const phones = notifyPhones(S.settings.contacts);
  let autoSent = 0;
  if (J.handle && serverSms() && phones.length) { try { autoSent = (await api.notify(J.handle, phones, msg)).smsSent; } catch { /* links below */ } }
  navigator.vibrate?.([100, 60, 100]);
  renderArrived(msg, autoSent);
}

function renderArrived(msg: string, autoSent: number) {
  const J = S.journey!;
  const res = J.result;
  const names = S.settings.contacts.filter((c) => c.notify).map((c) => c.name);
  let rating = 0;
  const tags = new Set<string>();
  const TAGS: [string, string][] = [['well_lit', '💡 Well lit'], ['busy', '👥 Busy'], ['shops_open', '🏪 Shops open'], ['police_seen', '👮 Police seen'],
    ['dark', '🌑 Dark'], ['deserted', '🚷 Deserted'], ['harassment', '😟 Harassment'], ['followed', '👣 Followed'], ['stray_dogs', '🐕 Stray dogs'], ['bad_footpath', '🚧 Bad footpath']];
  const stars = h('div', { class: 'stars', role: 'radiogroup', 'aria-label': 'Safety rating' });
  const drawStars = () => clear(stars, [1, 2, 3, 4, 5].map((n) => h('button', {
    class: `star${n <= rating ? ' on' : ''}`, role: 'radio', 'aria-checked': n === rating ? 'true' : 'false', 'aria-label': `${n} of 5`,
    on: { click: () => { rating = n; drawStars(); submit.disabled = false; } } }, '★')));
  const submit = h('button', { class: 'btn primary', disabled: true, id: 'submit-review', on: { click: async () => {
    try {
      await api.review(J.handle!.id, res.reviewToken, rating, [...tags], comment.value);
      clear(reviewBox, h('p', { class: 'ok-msg' }, 'Thanks. Your review helps others once enough travellers agree about these streets.'));
    } catch (err) { toast((err as Error).message); }
  } } }, 'Submit review');
  const comment = h('textarea', { rows: 2, maxlength: 500, placeholder: 'Anything others should know? (optional)', 'aria-label': 'Comment' });
  drawStars();
  const reviewBox = h('div', { class: 'review' });
  if (res?.eligible && res.reviewToken) {
    clear(reviewBox, h('h3', null, 'How safe did this route feel?'), stars,
      h('div', { class: 'chips wrap' }, TAGS.map(([k, label]) => h('button', { class: 'chip', 'aria-pressed': 'false',
        on: { click: (e: Event) => { const b = e.currentTarget as HTMLElement; if (tags.has(k)) tags.delete(k); else tags.add(k); b.classList.toggle('on'); b.setAttribute('aria-pressed', String(tags.has(k))); } } }, label))),
      comment, h('div', { class: 'row2' }, h('button', { class: 'btn ghost', on: { click: () => clear(reviewBox) } }, 'Skip'), submit));
  } else if (res) {
    clear(reviewBox, h('p', { class: 'fine' }, 'Reviews are only accepted from verified trips. This one could not be verified: ', res.reasons.join('; '), '.'));
  } else {
    clear(reviewBox, h('p', { class: 'fine' }, 'Reviews need an internet connection to verify your trip.'));
  }
  clear(sheet,
    h('div', { class: 'grip' }),
    h('div', { class: 'pad center' },
      h('div', { class: 'arrived-mark', 'aria-hidden': 'true' }, '✓'),
      h('h2', null, 'You reached'),
      h('p', null, J.dest.label),
      autoSent ? h('p', { class: 'ok-msg' }, `Arrival message sent to ${names.join(', ')}.`) :
        names.length ? h('a', { class: 'btn primary wide', href: smsLink(notifyPhones(S.settings.contacts), msg), id: 'send-arrival' }, `Tell ${names.join(', ')} you reached`) :
          h('p', null, h('button', { class: 'linkish', on: { click: () => showContacts() } }, 'Add a trusted contact'), ' to send arrival messages next time.'),
      names.length && !autoSent ? h('button', { class: 'btn wide', on: { click: () => showMessageSheet('Tell them you reached', msg) } }, 'Other ways to send') : null,
    ),
    h('div', { class: 'pad' }, reviewBox),
    h('div', { class: 'actions' }, h('button', { class: 'btn wide', on: { click: () => { S.journey = null; smap.setMe(undefined); S.from = S.to ? { ...S.to } : null; S.to = null; showPlan(); } } }, 'Done')),
  );
}

// ---------- contacts & settings ----------
function showContacts() {
  const prev = S.view;
  S.view = 'contacts';
  sheet.className = 'page';
  const st = S.settings;
  const name = h('input', { type: 'text', placeholder: 'Name, e.g. Maa', 'aria-label': 'Contact name', maxlength: 30 });
  const phone = h('input', { type: 'tel', placeholder: 'Mobile, e.g. 98765 43210', 'aria-label': 'Contact mobile number', inputmode: 'tel' });
  const err = h('p', { class: 'error', hidden: true });
  const add = () => {
    const p = normalisePhone(phone.value);
    if (!name.value.trim()) { err.textContent = 'Enter a name.'; err.hidden = false; return; }
    if (!p) { err.textContent = 'Enter a valid mobile number (10 digits, or with +country code).'; err.hidden = false; return; }
    if (st.contacts.length >= 5) { err.textContent = 'You can save up to 5 contacts.'; err.hidden = false; return; }
    if (st.contacts.some((c) => c.phone === p)) { err.textContent = 'This number is already saved.'; err.hidden = false; return; }
    const c: Contact = { id: crypto.randomUUID(), name: name.value.trim(), phone: p, notify: true };
    S.settings = save({ contacts: [...st.contacts, c] });
    showContacts();
  };
  const travName = h('input', { type: 'text', value: st.travellerName, placeholder: 'Your name (shown in messages)', 'aria-label': 'Your name', maxlength: 30 });
  travName.addEventListener('change', () => { S.settings = save({ travellerName: travName.value.trim() }); toast('Saved'); });
  clear(sheet,
    h('div', { class: 'summary' }, h('button', { class: 'back', 'aria-label': 'Back', on: { click: () => goBack(prev) } }, '‹'), h('h2', null, 'Contacts and settings')),
    h('div', { class: 'pad' },
      h('h3', null, 'Your name'), travName,
      h('h3', null, 'Trusted contacts'),
      st.contacts.length ? h('ul', { class: 'contacts' }, st.contacts.map((c) => h('li', null,
        h('div', null, h('b', null, c.name), h('small', null, c.phone)),
        h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: c.notify, 'aria-label': `Send arrival message to ${c.name}`,
          on: { change: (e: Event) => { c.notify = (e.target as HTMLInputElement).checked; S.settings = save({ contacts: st.contacts }); } } }), 'Arrival message'),
        h('button', { class: 'icon-btn', 'aria-label': `Remove ${c.name}`, on: { click: () => { S.settings = save({ contacts: st.contacts.filter((x) => x.id !== c.id) }); showContacts(); } } }, '✕')))) :
        h('p', { class: 'hint' }, 'Add up to 5 people who should know when you reach, and who get your SOS.'),
      h('div', { class: 'add-contact' }, name, phone, h('button', { class: 'btn primary', id: 'add-contact', on: { click: add } }, 'Add contact')), err,
      h('p', { class: 'fine' }, 'Contacts stay on this phone. Messages are sent from your own phone by SMS or WhatsApp.'),
      h('h3', null, 'Demo mode'),
      h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: st.simulate, on: { change: (e: Event) => { S.settings = save({ simulate: (e.target as HTMLInputElement).checked }); } } }),
        'Simulate my movement (to try the app without walking)'),
    ),
  );
}

function goBack(prev: typeof S.view) {
  if (prev === 'details') showDetails();
  else if (prev === 'routes' && S.reply) { S.view = 'routes'; sheet.className = 'routes'; renderRoutes(); }
  else if (prev === 'journey' && S.journey) { S.view = 'journey'; sheet.className = 'journey'; renderJourney(); }
  else if (prev === 'arrived' && S.journey) { S.view = 'arrived'; sheet.className = 'arrived'; renderArrived(arrivalText(S.settings.travellerName, S.journey.dest.label, clockText(new Date())), 0); }
  else showPlan();
}

// ---------- safe places nearby ----------
async function showPlaces() {
  const prev = S.view;
  S.view = 'places';
  sheet.className = 'page';
  const at: LonLat = S.myPos ? [S.myPos.lon, S.myPos.lat] : S.from?.lonlat ?? [smap.map.getCenter().lng, smap.map.getCenter().lat];
  clear(sheet, h('div', { class: 'summary' }, h('button', { class: 'back', 'aria-label': 'Back', on: { click: () => goBack(prev) } }, '‹'), h('h2', null, 'Safe places nearby')),
    h('div', { class: 'loading small' }, h('div', { class: 'spinner' })));
  const r = await rpc<{ places: (Poi & { distM: number; open: boolean; verified: boolean })[] }>({
    type: 'nearby', at, when: now().toISOString(), radiusM: 1500, cats: ['police', 'hospital', 'pharmacy', 'clinic', 'station', 'fuel'],
  });
  clear(sheet, h('div', { class: 'summary' }, h('button', { class: 'back', 'aria-label': 'Back', on: { click: () => goBack(prev) } }, '‹'),
    h('div', { class: 'summary-text' }, h('h2', null, 'Safe places nearby'), h('div', { class: 'meta' }, `Within 1.5 km, open state at ${clockText(now())}`))),
  h('ul', { class: 'places' }, r.places.length ? r.places.map((p) => h('li', null,
    h('span', { class: 'pi', 'aria-hidden': 'true' }, CAT_INFO[p.cat].icon),
    h('div', null, h('b', null, p.name || CAT_INFO[p.cat].label), h('small', null, `${CAT_INFO[p.cat].label}, ${fmtDist(p.distM)} away`)),
    h('span', { class: `open-pill ${p.open ? 'yes' : 'no'}` }, p.open ? (p.verified ? 'Open' : 'Likely open') : 'Closed'),
    h('button', { class: 'btn small', on: { click: () => { S.to = { lonlat: [p.lon, p.lat], label: p.name || CAT_INFO[p.cat].label }; if (!S.from) S.from = { lonlat: at, label: 'My location', mine: true }; planRoutes(); } } }, 'Go'))) :
    h('li', { class: 'empty' }, 'No safe places mapped within 1.5 km. Call 112 if you need help.')));
}

// ---------- help ----------
const GUIDES = [
  ['plan', 'Plan a trip', 'Search where you are going, pick who and how, then tap Show safe routes.'],
  ['routes', 'Choose a route', 'Routes go from fastest to safest. Colour, label and icon all show the risk. Tap a route twice for the reasons.'],
  ['journey', 'Start the journey', 'Pick who gets your arrival message, then tap Start journey.'],
  ['checkin', 'If you stop too long', 'We ask if you are OK. No answer in 30 seconds opens SOS.'],
  ['sos', 'SOS', 'One tap: call 112, or send your location to your contacts.'],
  ['review', 'Arrive and review', 'Your contacts get the arrival message. Rate how safe the streets felt.'],
];
function showHelp() {
  const prev = S.view;
  S.view = 'help';
  sheet.className = 'page';
  clear(sheet, h('div', { class: 'summary' }, h('button', { class: 'back', 'aria-label': 'Back', on: { click: () => goBack(prev) } }, '‹'), h('h2', null, 'How to use SafeRaah')),
    h('div', { class: 'pad guides' }, GUIDES.map(([k, title, text]) => h('figure', { class: 'guide' },
      h('img', { src: `${BASE}help/${k}.gif`, alt: `Animation: ${title}`, loading: 'lazy', width: 240, height: 520,
        on: { error: (e: Event) => ((e.target as HTMLElement).style.display = 'none') } }),
      h('figcaption', null, h('b', null, title), h('span', null, text)))),
    h('h3', null, 'Helplines'), h('ul', { class: 'helplines' }, HELPLINES.map((x) => h('li', null, h('a', { href: telLink(x.n) }, x.n), ` ${x.label}`))),
    h('h3', null, 'How the colours are worked out'),
    h('p', null, 'Every street gets a score for the time you travel: are places like police stations, hospitals, medical stores and shops open nearby, is the road busy, is it usually lit, does it run through a park or empty land, and what verified travellers said about it. Routes are coloured by their real score, so in daytime all routes can be green.'),
    h('p', { class: 'fine' }, 'Some areas of Delhi have fewer shops and places mapped on OpenStreetMap, so "nothing open nearby" there can partly mean "nothing mapped yet". Your reviews help correct this.'),
    h('p', { class: 'fine' }, `Map data © OpenStreetMap contributors (ODbL) via OpenMapTiles, snapshot ${S.snapshot || '31 Oct 2026'}. Covers all of Delhi NCT, including New Delhi, with the bordering edges of Gurugram, Faridabad, Noida and Ghaziabad.`)));
}

function showIntro() {
  openModal(h('div', { class: 'modal-card intro' },
    h('h2', null, 'Reach home safely'),
    h('p', null, 'SafeRaah shows up to four routes, from the fastest to the safest, based on what is open, how busy the streets are and what other travellers felt.'),
    h('p', null, 'Add one trusted contact so we can tell them when you reach.'),
    h('div', { class: 'row2' },
      h('button', { class: 'btn ghost', on: { click: () => { save({ seenIntro: true }); closeModal(); } } }, 'Later'),
      h('button', { class: 'btn primary', on: { click: () => { save({ seenIntro: true }); closeModal(); showContacts(); } } }, 'Add a contact')),
  ));
}

// ---------- live trip viewer (for contacts) ----------
async function showTrack(shareId: string) {
  S.view = 'track';
  sheet.className = 'page track';
  sosBtn.hidden = true;
  let first = true;
  const draw = async () => {
    let d: any;
    try { d = await api.share(shareId); } catch (err) {
      clear(sheet, h('div', { class: 'pad' }, h('h2', null, 'Trip not available'), h('p', null, (err as Error).message)));
      return false;
    }
    smap.showRoutes([{ coords: d.route, tier: 'green', dangerSpots: [] } as unknown as WorkerRoute], 0);
    smap.setEndpoints(d.route[0], d.dest);
    if (d.last) smap.setMe([d.last.lon, d.last.lat]);
    if (first) { smap.fit(d.route, fitPad()); first = false; }
    const statusText: Record<string, string> = { active: 'On the way', arrived: 'Reached safely', ended: 'Trip ended', sos: 'SOS: needs help now', expired: 'Trip expired' };
    const eta = new Date(d.startedAt + d.etaS * 1000);
    clear(sheet, h('div', { class: 'pad' },
      h('h2', null, `${d.name ? d.name + ': ' : ''}${statusText[d.status] ?? d.status}`),
      d.status === 'sos' ? h('a', { class: 'btn danger wide big', href: telLink('112') }, 'Call 112') : null,
      h('p', null, d.status === 'arrived' ? `Arrived at ${clockText(new Date(d.arrivedAt))}.` : `Expected by ${clockText(eta)}.`),
      d.last ? h('p', { class: 'meta' }, `Last seen ${Math.max(0, Math.round((Date.now() - d.last.t) / 60000))} min ago.`) : h('p', { class: 'meta' }, 'Waiting for the first location…'),
      h('p', { class: 'fine' }, 'This page updates every 10 seconds.')));
    return d.status === 'active' || d.status === 'sos';
  };
  if (await draw()) { const t = setInterval(async () => { if (!(await draw())) clearInterval(t); }, 10000); }
}

// ---------- misc ----------
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden && !checkTimer) closeModal(); });
mapEl.addEventListener('pointerdown', () => { if (S.view === 'journey') { userPanned = true; setTimeout(() => (userPanned = false), 15000); } });
if ('serviceWorker' in navigator && import.meta.env.PROD && !DEMO) {
  navigator.serviceWorker.register(BASE + 'sw.js').then(async () => {
    await navigator.serviceWorker.ready;
    // The first visit loads before the service worker controls the page, so the hashed
    // app bundles, fonts and map worker were never intercepted. Cache them now so the
    // next launch works with no signal at all.
    setTimeout(async () => {
      try {
        const urls = performance.getEntriesByType('resource').map((e) => e.name)
          .filter((u) => u.startsWith(location.origin) && !u.includes('/api/'));
        const c = await caches.open('saferaah-v1');
        await c.addAll([...new Set([new URL(BASE, location.href).href, ...urls])]);
      } catch { /* best effort */ }
    }, 4000);
  }).catch(() => {});
}
boot();
