// Compact binary road graph ("SRG1") shared by pipeline, server and browser.
//
// Layout: "SRG1" | u32 headerBytes | header JSON | padding to 8 | typed arrays...
// The header lists each array's name, type, offset and length.

import { LocalProjection, GridIndex } from './geo.ts';

type ArrType = 'i32' | 'u32' | 'f32' | 'u16' | 'u8';
const CTORS = {
  i32: Int32Array, u32: Uint32Array, f32: Float32Array, u16: Uint16Array, u8: Uint8Array,
} as const;

export interface GraphArrays {
  nodeLon: Int32Array; // micro-degrees
  nodeLat: Int32Array;
  edgeU: Uint32Array;
  edgeV: Uint32Array;
  edgeLen: Float32Array; // metres
  edgeClass: Uint8Array;
  edgeFlags: Uint8Array;
  edgeName: Int32Array; // -1 = unnamed
  edgePoliceM: Uint16Array; // distance to nearest police station
  edgeStationM: Uint16Array; // distance to nearest metro/rail station
  edgeBldg: Uint8Array; // buildings with centroid within 50 m
  edgeGreen: Uint8Array; // bit0: inside park/forest; bit1: beside large park; bit2: inside industrial/construction
  poiOff: Uint32Array; // CSR offsets, length E+1
  poiIdx: Uint32Array; // POI ids within 50 m of each edge
}

export interface GraphMeta {
  bbox: [number, number, number, number];
  snapshot: string;
  source: string;
  onewayKnown: boolean;
  names: string[];
}

const ORDER: [keyof GraphArrays, ArrType][] = [
  ['nodeLon', 'i32'], ['nodeLat', 'i32'], ['edgeU', 'u32'], ['edgeV', 'u32'],
  ['edgeLen', 'f32'], ['edgeName', 'i32'], ['edgePoliceM', 'u16'], ['edgeStationM', 'u16'],
  ['poiOff', 'u32'], ['poiIdx', 'u32'], ['edgeClass', 'u8'], ['edgeFlags', 'u8'],
  ['edgeBldg', 'u8'], ['edgeGreen', 'u8'],
];

export function encodeGraph(a: GraphArrays, meta: GraphMeta): Uint8Array {
  const entries: { name: string; type: ArrType; offset: number; length: number }[] = [];
  let off = 0;
  for (const [name, type] of ORDER) {
    off = Math.ceil(off / 8) * 8;
    entries.push({ name, type, offset: off, length: a[name].length });
    off += a[name].byteLength;
  }
  const header = new TextEncoder().encode(JSON.stringify({ meta, arrays: entries }));
  const base = Math.ceil((8 + header.length) / 8) * 8;
  const out = new Uint8Array(base + off);
  out.set([0x53, 0x52, 0x47, 0x31], 0);
  new DataView(out.buffer).setUint32(4, header.length, true);
  out.set(header, 8);
  for (const e of entries) {
    const src = a[e.name as keyof GraphArrays];
    out.set(new Uint8Array(src.buffer, src.byteOffset, src.byteLength), base + e.offset);
  }
  return out;
}

export class Graph {
  readonly a: GraphArrays;
  readonly meta: GraphMeta;
  readonly n: number;
  readonly m: number;
  readonly proj: LocalProjection;
  /** adjacency CSR: for node i, adjEdge[adjOff[i]..adjOff[i+1]) */
  readonly adjOff: Uint32Array;
  readonly adjEdge: Uint32Array;
  private grid?: GridIndex;

  constructor(buf: ArrayBuffer | Uint8Array) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (bytes[0] !== 0x53 || bytes[1] !== 0x52 || bytes[2] !== 0x47 || bytes[3] !== 0x31)
      throw new Error('Not a SafeRaah graph file');
    const hlen = new DataView(bytes.buffer, bytes.byteOffset).getUint32(4, true);
    const head = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + hlen)));
    const base = Math.ceil((8 + hlen) / 8) * 8;
    // copy into an aligned buffer (subarray offsets may be unaligned)
    // Uint8Array.prototype.slice always copies (Node's Buffer#slice would return a pooled view)
    const body = Uint8Array.prototype.slice.call(bytes, base).buffer as ArrayBuffer;
    const a: Partial<GraphArrays> = {};
    for (const e of head.arrays) {
      const C = CTORS[e.type as ArrType];
      (a as Record<string, unknown>)[e.name] = new C(body, e.offset, e.length);
    }
    this.a = a as GraphArrays;
    this.meta = head.meta;
    this.n = this.a.nodeLon.length;
    this.m = this.a.edgeU.length;
    this.proj = new LocalProjection((this.meta.bbox[1] + this.meta.bbox[3]) / 2);

    const deg = new Uint32Array(this.n + 1);
    for (let e = 0; e < this.m; e++) {
      deg[this.a.edgeU[e] + 1]++;
      deg[this.a.edgeV[e] + 1]++;
    }
    for (let i = 0; i < this.n; i++) deg[i + 1] += deg[i];
    this.adjOff = deg;
    this.adjEdge = new Uint32Array(this.m * 2);
    const fill = deg.slice(0, this.n);
    for (let e = 0; e < this.m; e++) {
      this.adjEdge[fill[this.a.edgeU[e]]++] = e;
      this.adjEdge[fill[this.a.edgeV[e]]++] = e;
    }
  }

  lon(i: number): number { return this.a.nodeLon[i] / 1e6; }
  lat(i: number): number { return this.a.nodeLat[i] / 1e6; }
  other(e: number, from: number): number {
    return this.a.edgeU[e] === from ? this.a.edgeV[e] : this.a.edgeU[e];
  }
  name(e: number): string {
    const k = this.a.edgeName[e];
    return k >= 0 ? this.meta.names[k] : '';
  }
  edgePois(e: number): Uint32Array {
    return this.a.poiIdx.subarray(this.a.poiOff[e], this.a.poiOff[e + 1]);
  }

  private buildGrid(): GridIndex {
    const g = new GridIndex(this.proj, 120);
    for (let e = 0; e < this.m; e++) {
      const u = this.a.edgeU[e], v = this.a.edgeV[e];
      g.insertBBox(e,
        Math.min(this.lon(u), this.lon(v)), Math.min(this.lat(u), this.lat(v)),
        Math.max(this.lon(u), this.lon(v)), Math.max(this.lat(u), this.lat(v)));
    }
    return g;
  }

  /**
   * Snap a coordinate onto the nearest edge usable by `usable(e)`.
   * Returns the edge, the fraction along u->v, the snapped point and distance.
   */
  snap(lon: number, lat: number, usable: (e: number) => boolean, maxM = 600):
    { edge: number; t: number; lon: number; lat: number; distM: number } | null {
    if (!this.grid) this.grid = this.buildGrid();
    for (let r = 60; r <= maxM; r *= 2) {
      let best: { edge: number; t: number; lon: number; lat: number; distM: number } | null = null;
      for (const e of this.grid.near(lon, lat, r)) {
        if (!usable(e)) continue;
        const u = this.a.edgeU[e], v = this.a.edgeV[e];
        const ax = this.proj.x(this.lon(u)), ay = this.proj.y(this.lat(u));
        const bx = this.proj.x(this.lon(v)), by = this.proj.y(this.lat(v));
        const px = this.proj.x(lon), py = this.proj.y(lat);
        const dx = bx - ax, dy = by - ay;
        const l2 = dx * dx + dy * dy;
        let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
        t = Math.max(0, Math.min(1, t));
        const cx = ax + t * dx, cy = ay + t * dy;
        const d = Math.hypot(cx - px, cy - py);
        if (d <= r && (!best || d < best.distM)) {
          best = {
            edge: e, t, distM: d,
            lon: this.lon(u) + t * (this.lon(v) - this.lon(u)),
            lat: this.lat(u) + t * (this.lat(v) - this.lat(u)),
          };
        }
      }
      if (best) return best;
    }
    return null;
  }
}
