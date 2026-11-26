// Google services used by the server, all optional and all keyed by environment
// variables (never shipped to the browser):
//   GEMINI_API_KEY        Gemini API key (Google AI Studio)
//   GEMINI_MODEL          text model, default "gemini-flash-latest"
//   GEMINI_EMBED_MODEL    embedding model, default "gemini-embedding-001"
//   GOOGLE_AIR_KEY        Google Air Quality API key (current conditions, CPCB AQI)
// Without them the assistant uses its built-in engine and air comes from Open-Meteo.
import { parseOpenMeteo, naqi, type AirNow } from '../shared/air.ts';
import { NOTES } from '../shared/saans/knowledge.ts';
import { cosine } from '../shared/saans/retrieve.ts';
import {
  buildPrompt, compose, groundingNotes, cleanModelText, type Answer, type AssistantContext, type Turn,
} from '../shared/saans/assistant.ts';

export type Fetch = typeof fetch;
const GL = 'https://generativelanguage.googleapis.com/v1beta';

export interface AiConfig {
  geminiKey?: string;
  model?: string;
  embedModel?: string;
  airKey?: string;
  fetch?: Fetch;
}
export function aiConfigFromEnv(): AiConfig {
  return {
    geminiKey: process.env.GEMINI_API_KEY || undefined,
    model: process.env.GEMINI_MODEL || undefined,
    embedModel: process.env.GEMINI_EMBED_MODEL || undefined,
    airKey: process.env.GOOGLE_AIR_KEY || undefined,
  };
}

async function withTimeout<T>(ms: number, f: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await f(ctl.signal); } finally { clearTimeout(t); }
}

export class Ai {
  private f: Fetch;
  private model: string;
  private embedModel: string;
  private noteVecs: number[][] | null = null;
  private embedFailed = false;
  private airCache = new Map<string, { at: number; v: AirNow | null }>();
  constructor(private cfg: AiConfig) {
    this.f = cfg.fetch ?? fetch;
    this.model = cfg.model ?? 'gemini-flash-latest';
    this.embedModel = cfg.embedModel ?? 'gemini-embedding-001';
  }
  get hasGemini() { return !!this.cfg.geminiKey; }
  get hasGoogleAir() { return !!this.cfg.airKey; }

  private async gl(path: string, body: unknown, ms = 20000): Promise<any> {
    return withTimeout(ms, async (signal) => {
      const r = await this.f(`${GL}/${path}`, {
        method: 'POST', signal,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.cfg.geminiKey! },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`Gemini ${r.status}: ${j?.error?.message ?? 'error'}`);
      return j;
    });
  }

  /** Embeddings of every note, computed once (vector search). */
  private async notesEmbedded(): Promise<number[][] | null> {
    if (this.noteVecs || this.embedFailed || !this.hasGemini) return this.noteVecs;
    try {
      const j = await this.gl(`models/${this.embedModel}:batchEmbedContents`, {
        requests: NOTES.map((n) => ({
          model: `models/${this.embedModel}`, taskType: 'RETRIEVAL_DOCUMENT', title: n.title,
          content: { parts: [{ text: `${n.title}. ${n.text} ${n.tags}` }] },
        })),
      });
      this.noteVecs = (j.embeddings ?? []).map((e: any) => e.values as number[]);
      if (this.noteVecs!.length !== NOTES.length) throw new Error('embedding count mismatch');
    } catch (err) {
      console.warn('[saans] embeddings off:', (err as Error).message);
      this.embedFailed = true;
      this.noteVecs = null;
    }
    return this.noteVecs;
  }

  private async dense(q: string): Promise<number[] | undefined> {
    const vecs = await this.notesEmbedded();
    if (!vecs) return undefined;
    try {
      const j = await this.gl(`models/${this.embedModel}:embedContent`, {
        model: `models/${this.embedModel}`, taskType: 'RETRIEVAL_QUERY', content: { parts: [{ text: q }] },
      }, 8000);
      const qv = j.embedding?.values as number[] | undefined;
      return qv ? vecs.map((v) => cosine(qv, v)) : undefined;
    } catch { return undefined; }
  }

  /** Answer a question: Gemini grounded on our facts and notes, or the built-in engine. */
  async answer(q: string, ctx: AssistantContext, history: Turn[] = []): Promise<Answer & { fallback?: boolean }> {
    const dense = this.hasGemini ? await this.dense(q) : undefined;
    const notes = groundingNotes(q, dense);
    const base = compose(q, ctx, notes);
    if (!this.hasGemini) return base;
    try {
      const p = buildPrompt(q, ctx, notes, history);
      const j = await this.gl(`models/${this.model}:generateContent`, {
        systemInstruction: { parts: [{ text: p.system }] },
        contents: p.contents,
        generationConfig: { maxOutputTokens: 700 },
        safetySettings: [{ category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' }],
      });
      const text = (j.candidates?.[0]?.content?.parts ?? []).map((x: any) => x.text ?? '').join('').trim();
      if (!text) throw new Error('empty answer');
      return { ...base, text: cleanModelText(text), engine: 'gemini', model: j.modelVersion ?? this.model };
    } catch (err) {
      console.warn('[saans] Gemini failed, using built-in answer:', (err as Error).message);
      return { ...base, fallback: true };
    }
  }

  /** Air for a ~10 km cell: Google's current conditions when keyed, CAMS forecast for the hours. */
  async air(lat: number, lon: number): Promise<AirNow | null> {
    const key = `${lat.toFixed(1)},${lon.toFixed(1)}`;
    const hit = this.airCache.get(key);
    if (hit && Date.now() - hit.at < 30 * 60000) return hit.v;
    let v: AirNow | null = null;
    try {
      v = await withTimeout(8000, async (signal) => {
        const u = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat.toFixed(1)}&longitude=${lon.toFixed(1)}`
          + '&current=pm2_5,pm10&hourly=pm2_5,pm10&timezone=Asia%2FKolkata&forecast_days=2';
        const r = await this.f(u, { signal });
        return r.ok ? parseOpenMeteo(await r.json()) : null;
      });
    } catch { v = null; }
    if (this.hasGoogleAir) {
      try {
        const g = await withTimeout(8000, async (signal) => {
          const r = await this.f('https://airquality.googleapis.com/v1/currentConditions:lookup', {
            method: 'POST', signal, headers: { 'content-type': 'application/json', 'x-goog-api-key': this.cfg.airKey! },
            body: JSON.stringify({ location: { latitude: lat, longitude: lon }, extraComputations: ['POLLUTANT_CONCENTRATION', 'LOCAL_AQI'] }),
          });
          return r.ok ? r.json() : null;
        });
        const pm = (code: string) => g?.pollutants?.find((p: any) => p.code === code)?.concentration?.value as number | undefined;
        const pm25 = pm('pm25'), pm10 = pm('pm10');
        if (pm25 != null) {
          v = {
            at: g.dateTime ?? new Date().toISOString(), pm25, pm10: pm10 ?? v?.pm10 ?? pm25 * 1.6,
            aqi: naqi(pm25, pm10), hours: v?.hours ?? [],
            source: v ? 'Google Air Quality API (now) + CAMS forecast' : 'Google Air Quality API',
          };
        }
      } catch { /* keep the CAMS reading */ }
    }
    this.airCache.set(key, { at: Date.now(), v });
    return v;
  }
}
