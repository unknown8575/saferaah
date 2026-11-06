// Compact binary road graph shared by pipeline, server and browser.
//
// Layout: "SRG1" | u32 headerBytes | header JSON | padding to 8 | typed arrays...
// The header lists each array's name, type, offset and length.
//
// Nodes are junctions (and cut points on long roads); each edge keeps the points
// between its two nodes as "shape" geometry, oriented from edgeU to edgeV. This keeps
// a city-wide graph small enough for a phone and fast to search.

import { LocalProjection, GridIndex, type LonLat } from './geo.ts';

type ArrType = 'i32' | 'u32' | 'f32' | 'u16' | 'u8';
const CTORS = {
  i32: Int32Array, u32: Uint32Array, f32: Float32Array, u16: Uint16Array, u8: Uint8Array,
} as const;

export interface GraphArrays {
  nodeLon: Int32Array; // micro-degrees
  nodeLat: Int32Array;
  edgeU: Uint32Array;
  edgeV: Uint32Array;
  edgeLen: Float32Array; // metres, along the shape
  edgeClass: Uint8Array;
  edgeFlags: Uint8Array;
  edgeName: Int32Array; // -1 = unnamed
  edgePoliceM: Uint16Array; // distance to nearest police station
  edgeStationM: Uint16Array; // distance to nearest metro/rail station
  edgeBldg: Uint8Array; // activity points (buildings, shops, stops, schools…) within 50 m
  edgeGreen: Uint8Array; // bit0: inside park/forest; bit1: beside large park; bit2: inside industrial/cemetery
  poiOff: Uint32Array; // CSR offsets, length E+1
  poiIdx: Uint32Array; // POI ids within 50 m of each edge
  shapeOff: Uint32Array; // CSR offsets into shapeLon/shapeLat, length E+1
  shapeLon: Int32Array; // intermediate points, micro-degrees, oriented u -> v
  shapeLat: Int32Array;
}

export interface GraphMeta {
  bbox: [number, number, number, number];
  snapshot: string;
  source: string;
  onewayKnown: boolean;
  names: string[];
  area?: string;
}

const ORDER: [keyof GraphArrays, ArrType][] = [
  ['nodeLon', 'i32'], ['nodeLat', 'i32'], ['edgeU', 'u32'], ['edgeV', 'u32'],
  ['edgeLen', 'f32'], ['edgeName', 'i32'], ['edgePoliceM', 'u16'], ['edgeStationM', 'u16'],
  ['poiOff', 'u32'], ['poiIdx', 'u32'], ['shapeOff', 'u32'], ['shapeLon', 'i32'], ['shapeLat', 'i32'],
  ['edgeClass', 'u8'], ['edgeFlags', 'u8'], ['edgeBldg', 'u8'], ['edgeGreen', 'u8'],
];

export function encodeGraph(a: Omit<GraphArrays, 'shapeOff' | 'shapeLon' | 'shapeLat'> & Partial<GraphArrays>, meta: GraphMeta): Uint8Array {
  const full = {
    ...a,
    shapeOff: a.shapeOff ?? new Uint32Array(a.edgeU.length + 1),
    shapeLon: a.shapeLon ?? new Int32Array(0),
    shapeLat: a.shapeLat ?? new Int32Array(0),
  } as GraphArrays;
  const entries: { name: string; type: ArrType; offset: number; length: number }[] = [];
  let off = 0;
  for (const [name, type] of ORDER) {
    off = Math.ceil(off / 8) * 8;
    entries.push({ name, type, offset: off, length: full[name].length });
    off += full[name].byteLength;
  }
  const header = new TextEncoder().encode(JSON.stringify({ meta, arrays: entries }));
  const base = Math.ceil((8 + header.length) / 8) * 8;
  const out = new Uint8Array(base + off);
  out.set([0x53, 0x52, 0x47, 0x31], 0);
  new DataView(out.buffer).setUint32(4, header.length, true);
  out.set(header, 8);
  for (const e of entries) {
    const src = full[e.name as keyof GraphArrays];
    out.set(new Uint8Array(src.buffer, src.byteOffset, src.byteLength), base + e.offset);
  }
  return out;
}

export interface SnapResult { edge: number; t: number; lon: number; lat: number; distM: number }

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
    // Uint8Array.prototype.slice always copies (Node's Buffer#slice would return a pooled view)
    const body = Uint8Array.prototype.slice.call(bytes, base).buffer as ArrayBuffer;
    const a: Partial<GraphArrays> = {};
    for (const e of head.arrays) {
      const C = CTORS[e.type as ArrType];
      (a as Record<string, unknown>)[e.name] = new C(body, e.offset, e.length);
    }
    this.n = a.nodeLon!.length;
    this.m = a.edgeU!.length;
    a.shapeOff ??= new Uint32Array(this.m + 1);
    a.shapeLon ??= new Int32Array(0);
    a.shapeLat ??= new Int32Array(0);
    this.a = a as GraphArrays;
    this.meta = head.meta;
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

  /** Full geometry of an edge from u to v. */
  polyline(e: number): LonLat[] {
    const a = this.a, u = a.edgeU[e], v = a.edgeV[e];
    const pts: LonLat[] = [[this.lon(u), this.lat(u)]];
    for (let k = a.shapeOff[e]; k < a.shapeOff[e + 1]; k++) pts.push([a.shapeLon[k] / 1e6, a.shapeLat[k] / 1e6]);
    pts.push([this.lon(v), this.lat(v)]);
    return pts;
  }

  /** Point at fraction t (0 = u, 1 = v) of an edge's length. */
  pointAt(e: number, t: number): LonLat {
    return this.cut(e, t, t)[0];
  }

  /**
   * Geometry between fractions t0 and t1 of the edge's length, in travel
   * order (t0 > t1 walks the edge backwards).
   */
  cut(e: number, t0: number, t1: number): LonLat[] {
    const pts = this.polyline(e);
    const rev = t1 < t0;
    if (rev) { pts.reverse(); t0 = 1 - t0; t1 = 1 - t1; }
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + this.proj.dist(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
    const L = cum[cum.length - 1] || 1;
    const at = (d: number): LonLat => {
      let i = 1;
      while (i < cum.length - 1 && cum[i] < d) i++;
      const seg = cum[i] - cum[i - 1] || 1;
      const f = Math.min(1, Math.max(0, (d - cum[i - 1]) / seg));
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f];
    };
    const d0 = t0 * L, d1 = t1 * L;
    const out: LonLat[] = [at(d0)];
    for (let i = 1; i < pts.length - 1; i++) if (cum[i] > d0 && cum[i] < d1) out.push(pts[i]);
    if (d1 > d0) out.push(at(d1));
    return out;
  }

  private buildGrid(): GridIndex {
    const g = new GridIndex(this.proj, 150);
    const a = this.a;
    for (let e = 0; e < this.m; e++) {
      let x0 = Math.min(a.nodeLon[a.edgeU[e]], a.nodeLon[a.edgeV[e]]), x1 = Math.max(a.nodeLon[a.edgeU[e]], a.nodeLon[a.edgeV[e]]);
      let y0 = Math.min(a.nodeLat[a.edgeU[e]], a.nodeLat[a.edgeV[e]]), y1 = Math.max(a.nodeLat[a.edgeU[e]], a.nodeLat[a.edgeV[e]]);
      for (let k = a.shapeOff[e]; k < a.shapeOff[e + 1]; k++) {
        x0 = Math.min(x0, a.shapeLon[k]); x1 = Math.max(x1, a.shapeLon[k]);
        y0 = Math.min(y0, a.shapeLat[k]); y1 = Math.max(y1, a.shapeLat[k]);
      }
      g.insertBBox(e, x0 / 1e6, y0 / 1e6, x1 / 1e6, y1 / 1e6);
    }
    return g;
  }

  /**
   * Snap a coordinate onto the nearest edge usable by `usable(e)`.
   * Returns the edge, the fraction of its length from u, the snapped point and distance.
   */
  snap(lon: number, lat: number, usable: (e: number) => boolean, maxM = 600): SnapResult | null {
    if (!this.grid) this.grid = this.buildGrid();
    const P = this.proj, px = P.x(lon), py = P.y(lat);
    for (let r = 60; r <= maxM; r *= 2) {
      let best: SnapResult | null = null;
      for (const e of this.grid.near(lon, lat, r)) {
        if (!usable(e)) continue;
        const pts = this.polyline(e);
        let along = 0, total = 0, bestD = Infinity, bestAlong = 0, bx = 0, by = 0;
        for (let i = 1; i < pts.length; i++) {
          const ax = P.x(pts[i - 1][0]), ay = P.y(pts[i - 1][1]), cx = P.x(pts[i][0]), cy = P.y(pts[i][1]);
          const dx = cx - ax, dy = cy - ay, l2 = dx * dx + dy * dy, len = Math.sqrt(l2);
          let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
          t = Math.max(0, Math.min(1, t));
          const qx = ax + t * dx, qy = ay + t * dy;
          const d = Math.hypot(qx - px, qy - py);
          if (d < bestD) { bestD = d; bestAlong = along + t * len; bx = qx; by = qy; }
          along += len;
        }
        total = along;
        if (bestD <= r && (!best || bestD < best.distM)) {
          best = { edge: e, t: total > 0 ? bestAlong / total : 0, distM: bestD, lon: bx / P.kx, lat: by / P.ky };
        }
      }
      if (best) return best;
    }
    return null;
  }
}
