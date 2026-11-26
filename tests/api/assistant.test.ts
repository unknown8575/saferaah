import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp, cleanFamily, cleanAir } from '../../server/app.ts';
import { openDb } from '../../server/db.ts';
import { Ai, type Fetch } from '../../server/ai.ts';
import { NOTES } from '../../shared/saans/knowledge.ts';

// A fake network: Open-Meteo, Google Air Quality and Gemini, recording every call.
const calls: { url: string; body: any; headers: Record<string, string> }[] = [];
let geminiMode: 'ok' | 'fail' = 'ok';
const hours = Array.from({ length: 48 }, (_, i) => `2026-11-${i < 24 ? 26 : 27}T${String(i % 24).padStart(2, '0')}:00`);
const fakeFetch: Fetch = (async (input: any, init: any = {}) => {
  const url = String(input);
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ url, body, headers: init.headers ?? {} });
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  if (url.includes('open-meteo')) {
    return json({ utc_offset_seconds: 19800, current: { pm2_5: 150, pm10: 260 }, hourly: { time: hours, pm2_5: hours.map((_, i) => 100 + (i % 24) * 3), pm10: hours.map(() => 200) } });
  }
  if (url.includes('airquality.googleapis.com')) {
    return json({ dateTime: '2026-11-26T10:00:00Z', pollutants: [{ code: 'pm25', concentration: { value: 180 } }, { code: 'pm10', concentration: { value: 300 } }] });
  }
  if (url.includes(':batchEmbedContents')) {
    return json({ embeddings: body.requests.map((_: unknown, i: number) => ({ values: [i === 1 ? 1 : 0, 0.1] })) });
  }
  if (url.includes(':embedContent')) return json({ embedding: { values: [1, 0] } });
  if (url.includes(':generateContent')) {
    if (geminiMode === 'fail') return json({ error: { message: 'quota' } }, 429);
    return json({ candidates: [{ content: { parts: [{ text: '**Run the purifier** tonight [1].\n- CADR about 180 m³/h' }] } }], modelVersion: 'gemini-test' });
  }
  return json({}, 404);
}) as Fetch;

let server: Server, base = '', noKey: Server, baseNoKey = '';
async function call(b: string, method: string, path: string, body?: unknown, device = 'device-assistant-0001') {
  const r = await fetch(b + path, { method, headers: { 'content-type': 'application/json', 'x-device-id': device }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
}

beforeAll(async () => {
  server = createApp({ db: openDb(':memory:'), graphVersion: 'test', ai: new Ai({ geminiKey: 'k-test', airKey: 'air-test', fetch: fakeFetch }) });
  noKey = createApp({ db: openDb(':memory:'), graphVersion: 'test', ai: new Ai({ fetch: fakeFetch }) });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  await new Promise<void>((r) => noKey.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  baseNoKey = `http://127.0.0.1:${(noKey.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); noKey.close(); });

const ctx = { air: { pm25: 200, pm10: 320, hours: [{ time: '2026-11-26T14:00', pm25: 120, pm10: 200 }, { time: '2026-11-26T15:00', pm25: 110, pm10: 190 }] }, family: { adults: 2, children: 1, bedroomM2: 12 } };

describe('Saans API', () => {
  it('TC-190 health reports which Google services are on', async () => {
    expect((await call(base, 'GET', '/api/health')).body).toMatchObject({ gemini: true, googleAir: true });
    expect((await call(baseNoKey, 'GET', '/api/health')).body).toMatchObject({ gemini: false, googleAir: false });
  });
  it('TC-191 /api/air rounds the position to ~10 km and merges Google now + CAMS hours', async () => {
    calls.length = 0;
    const r = await call(base, 'GET', '/api/air?lat=28.63281&lon=77.21972');
    expect(r.status).toBe(200);
    expect(r.body.pm25).toBe(180);
    expect(r.body.aqi.band).toBe('verypoor');
    expect(r.body.hours.length).toBeGreaterThan(0);
    expect(r.body.source).toMatch(/Google/);
    const om = calls.find((c) => c.url.includes('open-meteo'))!;
    expect(om.url).toContain('latitude=28.6&longitude=77.2');
    const g = calls.find((c) => c.url.includes('airquality'))!;
    expect(g.body.location).toEqual({ latitude: 28.6, longitude: 77.2 });
    expect(g.url).not.toContain('air-test'); // key travels in a header, not the URL
    expect(g.headers['x-goog-api-key']).toBe('air-test');
    expect((await call(base, 'GET', '/api/air?lat=abc&lon=1')).status).toBe(400);
  });
  it('TC-192 Gemini answers with our facts and notes; key never in the URL', async () => {
    calls.length = 0;
    const r = await call(base, 'POST', '/api/assistant', { q: 'Which purifier for my bedroom?', ctx });
    expect(r.status).toBe(200);
    expect(r.body.engine).toBe('gemini');
    expect(r.body.model).toBe('gemini-test');
    expect(r.body.text).toBe('Run the purifier tonight [1].\n• CADR about 180 m³/h');
    expect(r.body.notes[0].id).toBe('purifier-size');
    const gen = calls.find((c) => c.url.includes(':generateContent'))!;
    expect(gen.url).not.toContain('k-test');
    expect(gen.headers['x-goog-api-key']).toBe('k-test');
    const prompt = gen.body.contents.at(-1).parts[0].text as string;
    expect(prompt).toContain('CADR about 180 m³/h');
    expect(prompt).toContain('Family: 2 adults, 1 child');
    expect(gen.body.systemInstruction.parts[0].text).toMatch(/Use ONLY the numbers in FACTS/);
    // vector search: notes were embedded once, the question once
    const embeds = calls.filter((c) => c.url.includes(':batchEmbedContents'));
    expect(embeds.filter((c) => c.body.requests.length === NOTES.length)).toHaveLength(1); // notes, once
    expect(embeds.filter((c) => c.body.requests.length === 1)).toHaveLength(1); // the question
  });
  it('TC-193 without a key, or when Gemini fails, the built-in engine answers', async () => {
    const a = await call(baseNoKey, 'POST', '/api/assistant', { q: 'Which purifier for my bedroom?', ctx });
    expect(a.status).toBe(200);
    expect(a.body.engine).toBe('saans');
    expect(a.body.text).toMatch(/180 m³\/h/);
    geminiMode = 'fail';
    const b = await call(base, 'POST', '/api/assistant', { q: 'Plan my day', ctx });
    geminiMode = 'ok';
    expect(b.body.engine).toBe('saans');
    expect(b.body.fallback).toBe(true);
  });
  it('TC-194 input is validated and the assistant is rate-limited per phone', async () => {
    expect((await call(base, 'POST', '/api/assistant', { q: '   ', ctx })).status).toBe(400);
    const dev = 'device-limit-00000001';
    let last = 0;
    for (let i = 0; i < 21; i++) last = (await call(baseNoKey, 'POST', '/api/assistant', { q: 'mask?', ctx }, dev)).status;
    expect(last).toBe(429);
  });
  it('TC-195 family and air sent by the app are clamped to sane values', () => {
    const f = cleanFamily({ adults: 99, children: -3, cooking: 'rocket', bedroomM2: 1000, asthma: 'yes', commute: { mode: 'jet', km: 5 } });
    expect(f).toMatchObject({ adults: 12, children: 0, cooking: 'lpg', bedroomM2: 80, asthma: false, commute: null });
    expect(cleanFamily({ commute: { mode: 'metro', km: 500 } }).commute).toEqual({ mode: 'metro', km: 80 });
    expect(cleanAir({ pm25: 'x' })).toBeNull();
    const a = cleanAir({ pm25: 99999, hours: [{ time: 'bad', pm25: 1 }, { time: '2026-11-26T10:00', pm25: 50, pm10: 80 }] })!;
    expect(a.pm25).toBe(1500);
    expect(a.hours).toHaveLength(1);
  });
  it('TC-196 a daily cap on Gemini answers falls back to the built-in engine', async () => {
    const ai = new Ai({ geminiKey: 'k', dailyLimit: 2, fetch: fakeFetch });
    const c = { air: null, family: cleanFamily({}), route: null };
    expect((await ai.answer('mask?', c)).engine).toBe('gemini');
    expect((await ai.answer('mask?', c)).engine).toBe('gemini');
    expect((await ai.answer('mask?', c)).engine).toBe('saans');
  });
  it('TC-197 Vertex AI mode: service-account token, project from metadata, unknown models skipped', async () => {
    const seen: string[] = [];
    const vf: Fetch = (async (input: any, init: any = {}) => {
      const url = String(input);
      seen.push(url);
      const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
      if (url.endsWith('/service-accounts/default/token')) {
        expect(init.headers['Metadata-Flavor']).toBe('Google');
        return json({ access_token: 'tok-1', expires_in: 3600 });
      }
      if (url.endsWith('/project/project-id')) return new Response('my-proj');
      if (url.includes(':predict')) {
        expect(init.headers.authorization).toBe('Bearer tok-1');
        return json({ predictions: [{ embeddings: { values: [1, 0] } }] });
      }
      if (url.includes('gemini-flash-latest:generateContent')) return json({ error: { message: 'not found' } }, 404);
      if (url.includes(':generateContent')) {
        expect(init.headers.authorization).toBe('Bearer tok-1');
        return json({ candidates: [{ content: { parts: [{ text: 'thinking…', thought: true }, { text: 'Use a 180 m³/h purifier [1].' }] } }] });
      }
      return json({}, 500);
    }) as Fetch;
    const ai = new Ai({ vertex: true, fetch: vf });
    expect(ai.hasGemini).toBe(true);
    const a = await ai.answer('Which purifier?', { air: null, family: cleanFamily({}), route: null });
    expect(a.engine).toBe('gemini');
    expect(a.text).toBe('Use a 180 m³/h purifier [1].');
    expect(a.model).toBe('gemini-3.8-flash');
    const gen = seen.filter((u) => u.includes(':generateContent'));
    expect(gen[0]).toBe('https://aiplatform.googleapis.com/v1/projects/my-proj/locations/global/publishers/google/models/gemini-flash-latest:generateContent');
    expect(seen.some((u) => u.startsWith('https://us-central1-aiplatform.googleapis.com/v1/projects/my-proj/locations/us-central1/publishers/google/models/gemini-embedding-001:predict'))).toBe(true);
    // the working model is remembered: the next answer goes straight to it
    seen.length = 0;
    await ai.answer('mask?', { air: null, family: cleanFamily({}), route: null });
    expect(seen.filter((u) => u.includes(':generateContent'))[0]).toContain('gemini-3.8-flash');
    expect(seen.filter((u) => u.includes('/token'))).toHaveLength(0); // token cached
  });
});
