// Road classes, travel modes and per-mode speeds.

export const ROAD_CLASSES = [
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified',
  'residential', 'living_street', 'service', 'pedestrian', 'footway',
  'path', 'steps', 'track', 'cycleway', 'other',
] as const;
export type RoadClass = (typeof ROAD_CLASSES)[number];
export const RC: Record<RoadClass, number> = Object.fromEntries(
  ROAD_CLASSES.map((c, i) => [c, i]),
) as Record<RoadClass, number>;

/** Map an OSM highway=* value to our road class (null = not routable). */
export function roadClassOf(highway: string | undefined): RoadClass | null {
  if (!highway) return null;
  const h = highway.replace(/_link$/, '');
  switch (h) {
    case 'motorway': case 'trunk': case 'primary': case 'secondary': case 'tertiary':
    case 'unclassified': case 'residential': case 'living_street': case 'service':
    case 'pedestrian': case 'footway': case 'path': case 'steps': case 'track': case 'cycleway':
      return h;
    case 'road': return 'unclassified';
    case 'corridor': return 'footway';
    case 'busway': case 'bus_stop': case 'construction': case 'proposed': case 'platform':
      return null;
    default: return null;
  }
}

export type Mode = 'walk' | 'twowheeler' | 'auto' | 'car';
export const MODES: Mode[] = ['walk', 'twowheeler', 'auto', 'car'];

export interface ModeInfo {
  id: Mode;
  label: string;
  emoji: string;
  /** How strongly street-environment risk matters for this mode, 0..1. */
  exposure: number;
}

export const MODE_INFO: Record<Mode, ModeInfo> = {
  walk: { id: 'walk', label: 'Walk', emoji: '🚶‍♀️', exposure: 1.0 },
  twowheeler: { id: 'twowheeler', label: 'Scooty / Bike', emoji: '🛵', exposure: 0.75 },
  auto: { id: 'auto', label: 'Auto', emoji: '🛺', exposure: 0.6 },
  car: { id: 'car', label: 'Car / Cab', emoji: '🚗', exposure: 0.4 },
};

// Edge flag bits stored in the graph.
export const F_FOOT = 1;
export const F_VEHICLE = 2;
export const F_ONEWAY = 4; // vehicles may only go u -> v
export const F_ONEWAY_KNOWN = 8; // the source data carried oneway information at all

/** Typical urban Delhi speeds in km/h by road class for vehicles (before mode factor). */
const VEHICLE_KMH: Partial<Record<RoadClass, number>> = {
  motorway: 50, trunk: 34, primary: 26, secondary: 22, tertiary: 19,
  unclassified: 16, residential: 14, living_street: 10, service: 10, track: 8,
};
const MODE_FACTOR: Record<Exclude<Mode, 'walk'>, number> = {
  twowheeler: 1.1, auto: 0.85, car: 1.0,
};
export const WALK_KMH = 4.6;

/** Seconds to traverse an edge, or Infinity if the mode can't use it. */
export function edgeSeconds(mode: Mode, rc: number, flags: number, lengthM: number, peak: boolean): number {
  const cls = ROAD_CLASSES[rc];
  if (mode === 'walk') {
    if (!(flags & F_FOOT)) return Infinity;
    let kmh = WALK_KMH;
    if (cls === 'steps') kmh *= 0.5;
    if (cls === 'track' || cls === 'path') kmh *= 0.9;
    return lengthM / (kmh / 3.6);
  }
  if (!(flags & F_VEHICLE)) return Infinity;
  let kmh = VEHICLE_KMH[cls] ?? 12;
  if (mode === 'car' && cls === 'track') return Infinity;
  if (mode === 'auto' && cls === 'motorway') return Infinity; // autos are barred from expressways
  if (peak && (cls === 'trunk' || cls === 'primary' || cls === 'secondary')) kmh *= 0.7;
  kmh *= MODE_FACTOR[mode];
  return lengthM / (kmh / 3.6);
}
