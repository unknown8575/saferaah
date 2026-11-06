// Offline place search over search.json: [name, lon, lat, type][]
export type Entry = [string, number, number, string];
export interface Hit { name: string; lon: number; lat: number; type: string; score: number }

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();

const TYPE_BOOST: Record<string, number> = {
  station: 0.6, suburb: 0.55, landmark: 0.55, neighbourhood: 0.5, market: 0.45, quarter: 0.45, police: 0.4, hospital: 0.4, attraction: 0.3, park: 0.3, school: 0.25,
  locality: 0.35, hotel: 0.1, street: 0.05,
};
export const TYPE_ICON: Record<string, string> = {
  station: '🚇', police: '👮', hospital: '🏥', clinic: '🩺', pharmacy: '💊', street: '🛣️', shop: '🛍️', food: '🍽️',
  hotel: '🏨', fuel: '⛽', bank: '🏦', atm: '🏧', worship: '🛕', govt: '🏛️', liquor: '🍺',
  landmark: '🏛️', park: '🌳', market: '🛍️', school: '🏫', office: '🏢', suburb: '📍', neighbourhood: '📍',
};

export class PlaceSearch {
  private items: { e: Entry; n: string; words: string[] }[];
  constructor(entries: Entry[]) {
    this.items = entries.map((e) => { const n = norm(e[0]); return { e, n, words: n.split(' ') }; });
  }
  query(q: string, limit = 8, near?: [number, number]): Hit[] {
    const nq = norm(q);
    if (nq.length < 2) return [];
    const qWords = nq.split(' ');
    const out: Hit[] = [];
    for (const it of this.items) {
      let s = 0;
      if (it.n === nq) s = 4;
      else if (it.n.startsWith(nq)) s = 3;
      else if (qWords.every((w) => it.words.some((x) => x.startsWith(w)))) s = 2;
      else if (nq.length >= 4 && it.n.includes(nq)) s = 1;
      if (!s) continue;
      s += TYPE_BOOST[it.e[3]] ?? 0.2;
      s -= Math.min(0.5, it.n.length / 200);
      if (near) {
        const d = Math.hypot((it.e[1] - near[0]) * 97.6, (it.e[2] - near[1]) * 111.2); // km
        s -= Math.min(0.6, d / 30);
      }
      out.push({ name: it.e[0], lon: it.e[1], lat: it.e[2], type: it.e[3], score: s });
    }
    out.sort((a, b) => b.score - a.score);
    // de-duplicate same name within ~300 m
    const res: Hit[] = [];
    for (const h of out) {
      if (res.some((r) => r.name === h.name && Math.abs(r.lon - h.lon) < 0.003 && Math.abs(r.lat - h.lat) < 0.003)) continue;
      res.push(h);
      if (res.length >= limit) break;
    }
    return res;
  }
}
