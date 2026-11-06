// Geometry helpers shared by the data pipeline, router, server and web app.
// All coordinates are [lon, lat] in WGS84 degrees unless named otherwise.

export type LonLat = [number, number];

const R_EARTH = 6371008.8; // metres
const DEG = Math.PI / 180;

/** Great-circle distance in metres. */
export function haversine(aLon: number, aLat: number, bLon: number, bLat: number): number {
  const dLat = (bLat - aLat) * DEG;
  const dLon = (bLon - aLon) * DEG;
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(aLat * DEG) * Math.cos(bLat * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Fast local equirectangular projection around a reference latitude.
 * Accurate to well under 1% over a city, which is all we need for
 * "within 50 m" style checks.
 */
export class LocalProjection {
  readonly kx: number;
  readonly ky: number;
  constructor(refLat: number) {
    this.ky = R_EARTH * DEG;
    this.kx = R_EARTH * DEG * Math.cos(refLat * DEG);
  }
  x(lon: number): number {
    return lon * this.kx;
  }
  y(lat: number): number {
    return lat * this.ky;
  }
  /** Squared planar distance in m^2. */
  dist2(aLon: number, aLat: number, bLon: number, bLat: number): number {
    const dx = (aLon - bLon) * this.kx;
    const dy = (aLat - bLat) * this.ky;
    return dx * dx + dy * dy;
  }
  dist(aLon: number, aLat: number, bLon: number, bLat: number): number {
    return Math.sqrt(this.dist2(aLon, aLat, bLon, bLat));
  }
  /** Distance in metres from point P to segment AB. */
  pointSegDist(
    pLon: number, pLat: number,
    aLon: number, aLat: number,
    bLon: number, bLat: number,
  ): number {
    const px = pLon * this.kx, py = pLat * this.ky;
    const ax = aLon * this.kx, ay = aLat * this.ky;
    const bx = bLon * this.kx, by = bLat * this.ky;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx - px, cy = ay + t * dy - py;
    return Math.sqrt(cx * cx + cy * cy);
  }
}

/** Distance from a point to a polyline, in metres. */
export function pointPolylineDist(proj: LocalProjection, p: LonLat, line: LonLat[]): number {
  if (line.length === 0) return Infinity;
  if (line.length === 1) return proj.dist(p[0], p[1], line[0][0], line[0][1]);
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const d = proj.pointSegDist(p[0], p[1], line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]);
    if (d < best) best = d;
  }
  return best;
}

export function polylineLength(line: LonLat[]): number {
  let s = 0;
  for (let i = 1; i < line.length; i++) s += haversine(line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]);
  return s;
}

/** Ray-casting point-in-polygon for a single ring. */
export function pointInRing(lon: number, lat: number, ring: LonLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Point in polygon with holes ([outer, ...holes]). */
export function pointInPolygon(lon: number, lat: number, rings: LonLat[][]): boolean {
  if (!rings.length || !pointInRing(lon, lat, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) if (pointInRing(lon, lat, rings[i])) return false;
  return true;
}

/** Shoelace area of a ring in m^2 (approximate, local projection). */
export function ringAreaM2(proj: LocalProjection, ring: LonLat[]): number {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    s += proj.x(ring[j][0]) * proj.y(ring[i][1]) - proj.x(ring[i][0]) * proj.y(ring[j][1]);
  }
  return Math.abs(s) / 2;
}

/**
 * Uniform grid spatial index over integer ids. Cells are `cellM` metres.
 * Used both offline (pipeline) and at runtime (snapping a GPS fix to the graph).
 */
export class GridIndex {
  private cells = new Map<number, number[]>();
  private readonly cdLon: number;
  private readonly cdLat: number;
  constructor(proj: LocalProjection, readonly cellM: number) {
    this.cdLon = cellM / proj.kx;
    this.cdLat = cellM / proj.ky;
  }
  private key(cx: number, cy: number): number {
    return (cx + 50000) * 100000 + (cy + 50000);
  }
  cellOf(lon: number, lat: number): [number, number] {
    return [Math.floor(lon / this.cdLon), Math.floor(lat / this.cdLat)];
  }
  insertPoint(id: number, lon: number, lat: number): void {
    const [cx, cy] = this.cellOf(lon, lat);
    const k = this.key(cx, cy);
    let a = this.cells.get(k);
    if (!a) this.cells.set(k, (a = []));
    a.push(id);
  }
  insertBBox(id: number, minLon: number, minLat: number, maxLon: number, maxLat: number): void {
    const [x0, y0] = this.cellOf(minLon, minLat);
    const [x1, y1] = this.cellOf(maxLon, maxLat);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const k = this.key(x, y);
        let a = this.cells.get(k);
        if (!a) this.cells.set(k, (a = []));
        a.push(id);
      }
  }
  /** Ids in cells overlapping a radius around a point (caller filters exactly). */
  near(lon: number, lat: number, radiusM: number, out: Set<number> = new Set()): Set<number> {
    const r = Math.ceil(radiusM / this.cellM);
    const [cx, cy] = this.cellOf(lon, lat);
    for (let x = cx - r; x <= cx + r; x++)
      for (let y = cy - r; y <= cy + r; y++) {
        const a = this.cells.get(this.key(x, y));
        if (a) for (const id of a) out.add(id);
      }
    return out;
  }
}
