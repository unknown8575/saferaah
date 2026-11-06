// Turn-by-turn guidance while travelling: spoken instructions (like a maps app) and the
// live "island" — a capsule at the top of the app, and in the Android app an ongoing
// notification that Android 16 shows as a Live Update chip in the status bar.

import { Capacitor, registerPlugin } from '@capacitor/core';
import type { Tier } from '../../shared/router.ts';

export interface NavInfo {
  /** e.g. "Turn left onto Veer Savarkar Marg" */
  text: string;
  turn: string;
  toNextM: number;
  /** the step after the next one, if close ("then turn right") */
  thenText?: string;
  remainM: number;
  remainS: number;
  etaText: string;
  /** tier of the street you are on now */
  tier: Tier;
  /** a quieter/risky stretch starting soon on the route */
  ahead?: { tier: Tier; lengthM: number; inM: number; key: number };
  progress: number; // 0..1
  destLabel: string;
}

interface NavStatusPlugin {
  update(o: { title: string; text: string; chip: string; eta: string; progress: number; tier: string }): Promise<void>;
  end(): Promise<void>;
  speak(o: { text: string; lang: string }): Promise<void>;
  stopSpeaking(): Promise<void>;
  requestPermissions(): Promise<{ notifications: string }>;
}
const native = Capacitor.isNativePlatform() ? registerPlugin<NavStatusPlugin>('NavStatus') : null;

export const ARROW: Record<string, string> = {
  start: '↑', straight: '↑', slight_left: '↖', left: '←', sharp_left: '↙', slight_right: '↗', right: '→',
  sharp_right: '↘', uturn: '↶', arrive: '⚑',
};

/** Spoken distances, rounded the way people say them. */
export function sayDistance(m: number): string {
  if (m >= 950) {
    const km = Math.round(m / 100) / 10;
    return `${km % 1 === 0 ? km.toFixed(0) : km} kilometre${km === 1 ? '' : 's'}`;
  }
  const r = m >= 200 ? Math.round(m / 50) * 50 : Math.max(10, Math.round(m / 10) * 10);
  return `${r} metres`;
}

let webVoice: SpeechSynthesisVoice | null = null;
const hasWebSpeech = () => typeof window !== 'undefined' && 'speechSynthesis' in window;
function pickWebVoice() {
  if (!hasWebSpeech()) return;
  const vs = speechSynthesis.getVoices();
  webVoice = vs.find((v) => v.lang === 'en-IN') ?? vs.find((v) => v.lang.startsWith('en-GB')) ?? vs.find((v) => v.lang.startsWith('en')) ?? null;
}
if (hasWebSpeech()) { pickWebVoice(); speechSynthesis.addEventListener?.('voiceschanged', pickWebVoice); }

export function speak(text: string) {
  if (native) { native.speak({ text, lang: 'en-IN' }).catch(() => {}); return; }
  if (!hasWebSpeech()) return;
  const u = new SpeechSynthesisUtterance(text);
  if (webVoice) u.voice = webVoice;
  u.lang = webVoice?.lang ?? 'en-IN';
  u.rate = 1;
  speechSynthesis.cancel(); // never queue stale instructions
  speechSynthesis.speak(u);
}
export function stopSpeaking() {
  if (native) native.stopSpeaking().catch(() => {});
  else if (hasWebSpeech()) speechSynthesis.cancel();
}
/** Browsers only allow speech after a tap; call this from the Start button. */
export function unlockSpeech() {
  if (native || !hasWebSpeech()) return;
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0;
  speechSynthesis.speak(u);
}
export const canSpeak = () => !!native || hasWebSpeech();
/** In the app: ask once for permission to show the navigation notification. */
export function prepareNative() { native?.requestPermissions().catch(() => {}); }

/**
 * Decides what to say and when. Each instruction is spoken at most twice: once in
 * advance ("In 200 metres, turn left onto …") and once at the turn ("Turn left …").
 */
export class Guide {
  private said = new Set<string>();
  private lastNative = '';
  private lastNativeAt = 0;
  constructor(private isMuted: () => boolean, private walking: boolean) {}

  private recent = new Map<string, number>();
  private say(key: string, text: string) {
    if (this.said.has(key)) return;
    this.said.add(key);
    // two steps onto the same road can produce the same sentence; say it once
    const t = Date.now();
    if (t - (this.recent.get(text) ?? -Infinity) < 60000) return;
    this.recent.set(text, t);
    if (!this.isMuted()) speak(text);
  }

  start(firstText: string, destLabel: string) {
    this.say('start', `Starting your trip to ${destLabel}. ${firstText}.`);
  }

  update(stepIdx: number, n: NavInfo) {
    const far = this.walking ? 120 : 400;
    const near = this.walking ? 25 : 70;
    if (n.turn !== 'arrive' && n.turn !== 'straight') {
      if (n.toNextM <= far && n.toNextM > near * 2) this.say(`far${stepIdx}`, `In ${sayDistance(n.toNextM)}, ${lower(n.text)}.`);
      if (n.toNextM <= near) this.say(`near${stepIdx}`, `${n.text}${n.thenText ? `, then ${lower(n.thenText)}` : ''}.`);
    } else if (n.turn === 'arrive' && n.toNextM <= far) {
      this.say(`dest${stepIdx}`, `Your destination is ${sayDistance(n.toNextM)} ahead.`);
    }
    if (n.ahead && n.ahead.inM <= (this.walking ? 60 : 200)) {
      const what = n.ahead.tier === 'yellow' ? 'Quieter stretch ahead' : 'Risky stretch ahead';
      this.say(`risk${n.ahead.key}`, `${what} for ${sayDistance(n.ahead.lengthM)}. ${n.ahead.tier === 'yellow' ? 'Stay alert.' : 'Keep moving and stay on the main road.'}`);
    }
    this.pushNative(n);
  }

  /** a new route replaced the old one: forget what was said about the old steps */
  rerouted(msg: string) {
    this.said = new Set(['start']);
    if (!this.isMuted()) speak(msg);
  }

  arrived(destLabel: string) {
    this.say('arrived', `You have arrived at ${destLabel}.`);
    native?.end().catch(() => {});
  }

  stop() {
    stopSpeaking();
    native?.end().catch(() => {});
  }

  /** the Android notification / Live Update; throttled so it is not rebuilt every fix */
  private pushNative(n: NavInfo) {
    if (!native) return;
    const chip = n.turn === 'arrive' ? 'Arriving' : fmtShort(n.toNextM);
    const sig = `${n.text}|${chip}|${n.etaText}|${n.tier}`;
    const now = Date.now();
    if (sig === this.lastNative && now - this.lastNativeAt < 15000) return;
    this.lastNative = sig;
    this.lastNativeAt = now;
    native.update({
      title: `${ARROW[n.turn] ?? '↑'} ${n.turn === 'arrive' ? n.text : `${fmtShort(n.toNextM)} · ${n.text}`}`,
      text: `${n.tier === 'green' ? '' : n.tier === 'yellow' ? 'Quieter stretch — stay alert · ' : 'Risky stretch — keep moving · '}Arrive ${n.etaText} · ${fmtShort(n.remainM)} left`,
      chip, eta: n.etaText, progress: Math.max(0, Math.min(1, n.progress)), tier: n.tier,
    }).catch(() => {});
  }
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
export const fmtShort = (m: number) => (m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1)} km`);
