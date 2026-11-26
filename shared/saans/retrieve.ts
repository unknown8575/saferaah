// Retrieval for Saans: a small BM25 index over the notes, a topic-cluster step, and an
// optional dense (embedding) score mixed in when the server has Gemini embeddings.
//
//   1. normalise the question (Hinglish words → English, light stemming)
//   2. score every note with BM25 over title + text + tags
//   3. sum scores per cluster → the question's main topic; notes in it get a boost
//   4. if note/question embeddings are given, final = 0.5·bm25(normalised) + 0.5·cosine
import { NOTES, type Cluster, type Note } from './knowledge.ts';

const SYN: Record<string, string> = {
  bachche: 'children', bacche: 'children', baccha: 'child', bachcha: 'child', bacha: 'child', kids: 'children', kid: 'child',
  saans: 'breath', sans: 'breath', khansi: 'cough', gala: 'throat', aankh: 'eyes', dama: 'asthma',
  dhuan: 'smoke', dhua: 'smoke', dhuaan: 'smoke', hawa: 'air', ghar: 'home', kamra: 'room', khidki: 'window',
  khana: 'cooking', khaana: 'cooking', rasoi: 'kitchen', jhadu: 'sweep', pocha: 'mop', kooda: 'garbage', kachra: 'garbage',
  patakhe: 'firecrackers', parali: 'stubble', subah: 'morning', shaam: 'evening', raat: 'night', aaj: 'today', kal: 'tomorrow',
  bahar: 'outside', andar: 'indoors', school: 'school', dadi: 'elderly', nani: 'elderly', dada: 'elderly', nana: 'elderly',
  buzurg: 'elderly', parents: 'elderly', gaadi: 'car', scooty: 'twowheeler', bike: 'twowheeler', paudhe: 'plants', ped: 'plants',
  machine: 'purifier', purifiers: 'purifier', masks: 'mask', walks: 'walk', walking: 'walk', jogging: 'run', running: 'run',
};
const STOP = new Set(('a an the is are was be to of in on for and or with at by it this that my our me we i you your do does can ' +
  'should what which how when where why kya hai hain ka ki ke ko se me mein aur ya kaise kab kahan kitna kitni please tell').split(' '));

export function tokens(s: string): string[] {
  const out: string[] = [];
  for (let w of s.toLowerCase().replace(/pm\s*2\.?5/g, 'pm25').replace(/[^a-z0-9₂ ]+/g, ' ').split(/\s+/)) {
    if (!w || STOP.has(w)) continue;
    w = SYN[w] ?? w;
    if (w.length > 4 && w.endsWith('ing')) w = w.slice(0, -3);
    else if (w.length > 3 && w.endsWith('es') && !w.endsWith('ses')) w = w.slice(0, -2);
    else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
    out.push(SYN[w] ?? w);
  }
  return out;
}

interface Doc { note: Note; tf: Map<string, number>; len: number }
const K1 = 1.2, B = 0.75;

export class NoteIndex {
  private docs: Doc[];
  private df = new Map<string, number>();
  private avg: number;
  constructor(notes: Note[] = NOTES) {
    this.docs = notes.map((note) => {
      // the title and tags count twice: they say what a note is about
      const toks = [...tokens(note.title), ...tokens(note.title), ...tokens(note.text), ...tokens(note.tags), ...tokens(note.tags)];
      const tf = new Map<string, number>();
      for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      return { note, tf, len: toks.length };
    });
    this.avg = this.docs.reduce((s, d) => s + d.len, 0) / Math.max(1, this.docs.length);
  }

  bm25(q: string): number[] {
    const qt = [...new Set(tokens(q))];
    const N = this.docs.length;
    return this.docs.map((d) => {
      let s = 0;
      for (const t of qt) {
        const f = d.tf.get(t);
        if (!f) continue;
        const idf = Math.log(1 + (N - (this.df.get(t) ?? 0) + 0.5) / ((this.df.get(t) ?? 0) + 0.5));
        s += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.len) / this.avg)));
      }
      return s;
    });
  }

  /** The topic cluster the question is mostly about (null if nothing matches). */
  clusterOf(q: string, scores = this.bm25(q)): Cluster | null {
    const sum = new Map<Cluster, number>();
    this.docs.forEach((d, i) => sum.set(d.note.cluster, (sum.get(d.note.cluster) ?? 0) + scores[i] ** 2));
    let best: Cluster | null = null, bv = 0;
    for (const [c, v] of sum) if (v > bv) { bv = v; best = c; }
    return best;
  }

  /**
   * Top `k` notes for a question. `dense` (optional) is the cosine similarity of the
   * question to each note, in NOTES order, from an embedding model.
   */
  search(q: string, k = 3, dense?: number[]): { note: Note; score: number }[] {
    const sparse = this.bm25(q);
    const cluster = this.clusterOf(q, sparse);
    const top = Math.max(...sparse, 1e-9);
    const scored = this.docs.map((d, i) => {
      let s = sparse[i] / top;
      if (dense && dense.length === this.docs.length) s = 0.5 * s + 0.5 * Math.max(0, dense[i]);
      if (cluster && d.note.cluster === cluster) s *= 1.15;
      return { note: d.note, score: s };
    });
    const best = Math.max(...scored.map((x) => x.score), 0);
    // keep only notes that are clearly about the question (not a stray shared word)
    return scored.filter((x) => x.score > 0.05 && x.score >= 0.35 * best).sort((a, b) => b.score - a.score).slice(0, k);
  }

  get notes(): Note[] { return this.docs.map((d) => d.note); }
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? d / Math.sqrt(na * nb) : 0;
}
