// Google services used by the server, all optional and all keyed by environment
// variables (never shipped to the browser):
//   GEMINI_API_KEY        Gemini API key (Google AI Studio)
//   GEMINI_VERTEX         1 = Gemini on Vertex AI with the Cloud Run service account (no key);
//                         on by default on Cloud Run when there is no key
//   GEMINI_MODEL          text model to try first (then newer stable names are tried)
//   GEMINI_EMBED_MODEL    embedding model, default "gemini-embedding-001"
//   GOOGLE_AIR_KEY        Google Air Quality API key (current conditions, CPCB AQI)
//   GEMINI_DAILY_LIMIT    most Gemini answers per day for the whole server (default 500)
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
  /** use Gemini on Vertex AI with the server's Google Cloud identity (no key; billed to the project) */
  vertex?: boolean;
  /** Google Cloud project id for Vertex AI (default: from the metadata server) */
  project?: string;
  /** most Gemini answers per day for the whole server (then the built-in engine answers) */
  dailyLimit?: number;
  fetch?: Fetch;
  now?: () => number;
}
export function aiConfigFromEnv(): AiConfig {
  return {
    geminiKey: process.env.GEMINI_API_KEY || undefined,
    model: process.env.GEMINI_MODEL || undefined,
    embedModel: process.env.GEMINI_EMBED_MODEL || undefined,
    airKey: process.env.GOOGLE_AIR_KEY || undefined,
    // on Cloud Run (K_SERVICE is set) with no key, use Vertex AI unless GEMINI_VERTEX=0
    vertex: process.env.GEMINI_VERTEX === '1' || (!process.env.GEMINI_API_KEY && !!process.env.K_SERVICE && process.env.GEMINI_VERTEX !== '0'),
    project: process.env.GOOGLE_CLOUD_PROJECT || undefined,
    dailyLimit: process.env.GEMINI_DAILY_LIMIT ? Number(process.env.GEMINI_DAILY_LIMIT) : undefined,
  };
}

async function withTimeout<T>(ms: number, f: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await f(ctl.signal); } finally { clearTimeout(t); }
}

/** Model names to try, newest-stable aliases first; the first that answers is kept. */
const MODEL_CANDIDATES = ['gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
const META = 'http://metadata.google.internal/computeMetadata/v1';

export class Ai {
  private f: Fetch;
  private models: string[];
  private embedModel: string;
  private noteVecs: number[][] | null = null;
  private embedRetryAt = 0;
  private airCache = new Map<string, { at: number; v: AirNow | null }>();
  private day = { key: '', used: 0 };
  private token: { value: string; until: number } | null = null;
  private project: string | null;
  constructor(private cfg: AiConfig) {
    this.f = cfg.fetch ?? fetch;
    this.models = cfg.model ? [cfg.model, ...MODEL_CANDIDATES.filter((m) => m !== cfg.model)] : [...MODEL_CANDIDATES];
    // Vertex's multilingual model embeds a whole batch in one call (and knows Hindi)
    this.embedModel = cfg.embedModel ?? (cfg.geminiKey ? 'gemini-embedding-001' : 'text-multilingual-embedding-002');
    this.project = cfg.project ?? null;
  }
  /** Gemini through an AI Studio key, or through Vertex AI with the service's own identity. */
  get mode(): 'key' | 'vertex' | null { return this.cfg.geminiKey ? 'key' : this.cfg.vertex ? 'vertex' : null; }
  get hasGemini() { return this.mode !== null; }
  get hasGoogleAir() { return !!this.cfg.airKey; }
  private get now() { return (this.cfg.now ?? Date.now)(); }

  /** Count one Gemini answer against today's cap; false when the cap is reached. */
  private takeQuota(): boolean {
    const key = new Date(this.now).toISOString().slice(0, 10);
    if (this.day.key !== key) this.day = { key, used: 0 };
    if (this.day.used >= (this.cfg.dailyLimit ?? 500)) return false;
    this.day.used++;
    return true;
  }

  /** Vertex AI: an access token for the Cloud Run service account, from the metadata server. */
  private async vertexAuth(): Promise<{ token: string; project: string }> {
    if (!this.token || this.token.until < this.now) {
      const r = await this.f(`${META}/instance/service-accounts/default/token`, { headers: { 'Metadata-Flavor': 'Google' } });
      if (!r.ok) throw new Error(`metadata token ${r.status}`);
      const j = await r.json();
      this.token = { value: j.access_token, until: this.now + (Number(j.expires_in ?? 300) - 60) * 1000 };
    }
    if (!this.project) {
      const r = await this.f(`${META}/project/project-id`, { headers: { 'Metadata-Flavor': 'Google' } });
      if (!r.ok) throw new Error(`metadata project ${r.status}`);
      this.project = (await r.text()).trim();
    }
    return { token: this.token.value, project: this.project };
  }

  /** POST to Gemini. `op` is e.g. "gemini-x:generateContent". */
  private async call(model: string, op: string, body: unknown, ms = 25000, location = 'global'): Promise<any> {
    return withTimeout(ms, async (signal) => {
      let url: string, headers: Record<string, string>;
      if (this.mode === 'key') {
        url = `${GL}/models/${model}:${op}`;
        headers = { 'content-type': 'application/json', 'x-goog-api-key': this.cfg.geminiKey! };
      } else {
        const a = await this.vertexAuth();
        const host = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
        url = `https://${host}/v1/projects/${a.project}/locations/${location}/publishers/google/models/${model}:${op}`;
        headers = { 'content-type': 'application/json', authorization: `Bearer ${a.token}` };
      }
      const r = await this.f(url, { method: 'POST', signal, headers, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(`Gemini ${r.status}: ${j?.error?.message ?? 'error'}`), { status: r.status });
      return j;
    });
  }

  /** Embed texts (vector search). AI Studio takes a batch; Vertex takes one text per call. */
  private async embed(texts: { text: string; title?: string }[], task: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY', ms = 15000): Promise<number[][]> {
    if (this.mode === 'key') {
      const j = await this.call(this.embedModel, 'batchEmbedContents', {
        requests: texts.map((t) => ({ model: `models/${this.embedModel}`, taskType: task, title: t.title, content: { parts: [{ text: t.text }] } })),
      }, ms);
      return (j.embeddings ?? []).map((e: any) => e.values as number[]);
    }
    const j = await this.call(this.embedModel, 'predict', {
      instances: texts.map((t) => ({ content: t.text, task_type: task, ...(t.title ? { title: t.title } : {}) })),
    }, ms, 'us-central1');
    return (j.predictions ?? []).map((p: any) => p?.embeddings?.values as number[]);
  }

  /** Embeddings of every note, computed once (vector search); retried later if it failed. */
  private async notesEmbedded(): Promise<number[][] | null> {
    if (this.noteVecs || !this.hasGemini || this.now < this.embedRetryAt) return this.noteVecs;
    try {
      const vecs = await this.embed(NOTES.map((n) => ({ title: n.title, text: `${n.title}. ${n.text} ${n.tags}` })), 'RETRIEVAL_DOCUMENT', 30000);
      if (vecs.length !== NOTES.length || vecs.some((v) => !v?.length)) throw new Error('embedding count mismatch');
      this.noteVecs = vecs;
    } catch (err) {
      console.warn('[saans] embeddings off for 10 min:', (err as Error).message);
      this.embedRetryAt = this.now + 10 * 60000;
    }
    return this.noteVecs;
  }

  private async dense(q: string): Promise<number[] | undefined> {
    const vecs = await this.notesEmbedded();
    if (!vecs) return undefined;
    try {
      const [qv] = await this.embed([{ text: q }], 'RETRIEVAL_QUERY', 8000);
      return qv?.length ? vecs.map((v) => cosine(qv, v)) : undefined;
    } catch { return undefined; }
  }

  /** generateContent on the first model that exists; remembers it. */
  private async generate(body: unknown): Promise<{ j: any; model: string }> {
    let last: unknown;
    for (const m of [...this.models]) {
      try {
        try {
          return { j: await this.call(m, 'generateContent', body), model: m };
        } catch (err) {
          // a new project's per-minute quota is small: wait a moment and try once more
          if ((err as { status?: number }).status !== 429) throw err;
          await new Promise((r) => setTimeout(r, 1500));
          return { j: await this.call(m, 'generateContent', body), model: m };
        }
      } catch (err) {
        last = err;
        // an unknown or retired model (404), or one this billing account may not use (403),
        // moves on to the next name; anything else is a real error
        const st = (err as { status?: number }).status;
        if (st !== 404 && st !== 403) throw err;
        console.warn(`[saans] model ${m} not available (${st}), trying the next one`);
        this.models = this.models.filter((x) => x !== m).concat(m);
      }
    }
    throw last;
  }

  /** Answer a question: Gemini grounded on our facts and notes, or the built-in engine. */
  async answer(q: string, ctx: AssistantContext, history: Turn[] = []): Promise<Answer & { fallback?: boolean; reason?: string }> {
    const useGemini = this.hasGemini && this.takeQuota();
    const dense = useGemini ? await this.dense(q) : undefined;
    const notes = groundingNotes(q, dense);
    const base = compose(q, ctx, notes);
    if (!useGemini) return this.hasGemini ? { ...base, fallback: true, reason: 'daily limit reached' } : base;
    try {
      const p = buildPrompt(q, ctx, notes, history);
      const { j, model } = await this.generate({
        systemInstruction: { parts: [{ text: p.system }] },
        contents: p.contents,
        // room for the model's own thinking as well as the short answer
        generationConfig: { maxOutputTokens: 2048 },
        safetySettings: [{ category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' }],
      });
      const text = (j.candidates?.[0]?.content?.parts ?? []).filter((x: any) => !x.thought).map((x: any) => x.text ?? '').join('').trim();
      if (!text) throw new Error('empty answer');
      return { ...base, text: cleanModelText(text), engine: 'gemini', model: j.modelVersion ?? model };
    } catch (err) {
      console.warn('[saans] Gemini failed, using built-in answer:', (err as Error).message);
      const st = (err as { status?: number }).status;
      return { ...base, fallback: true, reason: st === 429 ? 'Gemini is busy' : 'Gemini unavailable' };
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
