import { describe, it, expect } from 'vitest';
import { NOTES } from '../../shared/saans/knowledge.ts';
import { NoteIndex, tokens, cosine } from '../../shared/saans/retrieve.ts';
import { compose, buildPrompt, intentOf, groundingNotes, cleanModelText, factsFor, placeIntentOf } from '../../shared/saans/assistant.ts';
import { dayPlan, purifierCadr, commuteSwaps, windowLabel, DEFAULT_FAMILY, type Family } from '../../shared/saans/plan.ts';
import { parseOpenMeteo, type AirNow } from '../../shared/air.ts';

function fakeAir(pmBase = 180): AirNow {
  const time: string[] = [], pm: number[] = [];
  for (let i = 0; i < 48; i++) {
    const d = i < 24 ? '26' : '27';
    const h = i % 24;
    time.push(`2026-11-${d}T${String(h).padStart(2, '0')}:00`);
    pm.push(pmBase * (1 + 0.45 * Math.cos(((h - 6) / 24) * 2 * Math.PI)));
  }
  return parseOpenMeteo({ utc_offset_seconds: 19800, hourly: { time, pm2_5: pm, pm10: pm.map((x) => x * 1.7) } }, new Date('2026-11-26T03:00:00Z'))!;
}
const FAM: Family = { ...DEFAULT_FAMILY, children: 1, elders: 1, asthma: true, commute: { mode: 'car', km: 9 } };

describe('Saans retrieval', () => {
  const idx = new NoteIndex();
  it('TC-170 notes have unique ids, a cluster and a source', () => {
    expect(new Set(NOTES.map((n) => n.id)).size).toBe(NOTES.length);
    for (const n of NOTES) { expect(n.source.length).toBeGreaterThan(3); expect(n.text.length).toBeGreaterThan(60); }
  });
  it('TC-171 Hinglish words map to English terms', () => {
    expect(tokens('bachche ko khansi')).toEqual(['children', 'cough']);
    expect(tokens('PM 2.5 kya hai')).toEqual(['pm25']);
  });
  it('TC-172 questions find the right note and cluster', () => {
    const top = (q: string) => idx.search(q, 1)[0]?.note.id;
    expect(top('what size air purifier for my room')).toBe('purifier-size');
    expect(top('is agarbatti smoke bad')).toBe('incense');
    expect(top('do money plants clean air')).toBe('plants');
    expect(top('which mask n95 or cloth')).toBe('mask');
    expect(top('dadi ko saans ki dikkat')).toMatch(/elders|asthma|symptoms/);
    expect(idx.clusterOf('tadka frying smoke in kitchen')).toBe('indoor');
    expect(idx.clusterOf('carbon footprint of metro vs car')).toBe('swaps');
  });
  it('TC-173 dense scores can re-rank results (hybrid search)', () => {
    const dense = NOTES.map((n) => (n.id === 'grap' ? 1 : 0));
    expect(idx.search('what should I know', 1, dense)[0].note.id).toBe('grap');
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
  });
});

describe('Saans numbers', () => {
  it('TC-174 purifier CADR is room volume × 5 air changes', () => {
    expect(purifierCadr(12)).toBe(180);
    expect(purifierCadr(20)).toBe(300);
  });
  it('TC-175 commute swaps compute monthly CO₂ saved', () => {
    const s = commuteSwaps({ mode: 'car', km: 10 });
    expect(s[0].to).toBe('metro');
    expect(s[0].kgPerMonth).toBe(Math.round((0.17 - 0.03) * 10 * 44));
    expect(commuteSwaps({ mode: 'metro', km: 10 }).length).toBe(0);
  });
  it('TC-176 window labels read naturally', () => {
    expect(windowLabel('2026-11-26T14:00', '2026-11-26T15:00')).toBe('2–4 pm');
    expect(windowLabel('2026-11-26T11:00', '2026-11-26T12:00')).toBe('11 am – 1 pm');
  });
  it('TC-177 day plan follows the forecast and the family', () => {
    const p = dayPlan(fakeAir(), FAM);
    expect(['verypoor', 'severe']).toContain(p.band);
    expect(p.best).not.toBeNull();
    const ids = p.items.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(['window', 'mask', 'purifier', 'family', 'swap']));
    expect(p.items.find((i) => i.id === 'window')!.impact).toMatch(/% less PM2.5/);
    const clean = dayPlan(fakeAir(20), DEFAULT_FAMILY);
    expect(clean.items.map((i) => i.id)).not.toContain('mask');
    expect(dayPlan(null, DEFAULT_FAMILY).verdict).toMatch(/not available/);
  });
});

describe('Saans answers', () => {
  const ctx = { air: fakeAir(), family: FAM, route: null };
  it('TC-178 intents are recognised', () => {
    expect(intentOf('Plan my day')).toBe('plan');
    expect(intentOf('aaj kya karein')).toBe('plan');
    expect(intentOf('which purifier')).toBe('purifier');
    expect(intentOf('greener way to commute')).toBe('route');
    expect(intentOf('reduce my carbon footprint')).toBe('swaps');
  });
  it('TC-179 built-in answers are specific, cited and different per question', () => {
    const a = compose('Plan my day', ctx);
    const b = compose('Which purifier for my bedroom?', ctx);
    const c = compose('How can I cut my carbon footprint?', ctx);
    expect(a.text).toMatch(/AQI \d+/);
    expect(b.text).toMatch(/180 m³\/h/);
    expect(c.text).toMatch(/kg CO₂/);
    for (const x of [a, b, c]) { expect(x.text).toMatch(/\[\d\]/); expect(x.engine).toBe('saans'); }
    expect(new Set([a.text, b.text, c.text]).size).toBe(3);
  });
  it('TC-180 route answers use the selected route numbers', () => {
    const r = compose('is my route clean?', { ...ctx, route: { mode: 'auto', minutes: 25, label: 'Cleanest air', pctLess: 12, avoided: ['Mayapuri Industrial Area I'], areas: [] } });
    expect(r.text).toMatch(/12% less PM2.5/);
    expect(r.text).toMatch(/Mayapuri/);
  });
  it('TC-181 the Gemini prompt carries facts, numbered notes and the rules', () => {
    const notes = groundingNotes('which purifier');
    expect(notes[0].id).toBe('purifier-size');
    const p = buildPrompt('which purifier', ctx, notes, [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'hello' }]);
    const body = p.contents.at(-1)!.parts[0].text;
    expect(body).toMatch(/FACTS/);
    expect(body).toMatch(/CADR about 180/);
    expect(body).toMatch(/\[1\] How big a purifier/);
    expect(p.system).toMatch(/Never invent/);
    expect(p.contents[1].role).toBe('model');
    expect(p.contents.at(-1)!.role).toBe('user');
    expect(factsFor(ctx).some((f) => /Family: 2 adults, 1 child, 1 elder, someone with asthma/.test(f))).toBe(true);
  });
  it('TC-182 model output is tidied', () => {
    expect(cleanModelText('## Plan\n**Go** out\n* one\n- two\n\n\n\nend')).toBe('Plan\nGo out\n• one\n• two\n\nend');
  });
});

describe('Saans nearby places', () => {
  const ctx = { air: fakeAir(), family: FAM, route: null };
  it('TC-183 only "near me" questions about a kind of place become place look-ups', () => {
    expect(placeIntentOf('Show me nearby plants shops')?.title).toBe('Plant nurseries');
    expect(placeIntentOf('where can I buy an air purifier')?.title).toBe('Air purifier shops');
    expect(placeIntentOf('n95 mask kahan milega')?.title).toBe('Medical stores');
    expect(placeIntentOf('Which purifier for my bedroom?')).toBeNull();
    expect(placeIntentOf('do plants clean air')).toBeNull();
    expect(placeIntentOf('Is agarbatti bad indoors?')).toBeNull();
  });
  it('TC-184 answers list the phone-found places honestly and carry no coordinates', () => {
    const places = { title: 'Plant nurseries', items: [
      { name: 'Ganga Nursery', kind: 'Garden centre', distM: 350, open: true },
      { name: 'Birju Flowers', kind: 'Florist', distM: 1500, open: null, similar: true },
    ] };
    const a = compose('plant shops near me', { ...ctx, places });
    expect(a.text).toMatch(/Ganga Nursery — 350 m, open/);
    expect(a.text).toMatch(/1\.5 km/);
    expect(a.text).toMatch(/don't clean room air/);
    const f = factsFor({ ...ctx, places }).join('\n');
    expect(f).toMatch(/not sent or stored/);
    expect(f).toMatch(/1\. Ganga Nursery — Garden centre, 350 m, open now/);
    expect(f).not.toMatch(/77\.|28\./);
    expect(compose('plant shops near me', { ...ctx, places: null }).text).toMatch(/Turn on location/);
    expect(intentOf('anything', { ...ctx, places })).toBe('places');
  });
});
