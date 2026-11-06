// All safety logic runs on Delhi local time (IST, UTC+05:30, no DST),
// regardless of the timezone of the device or server running it.

export const IST_OFFSET_MIN = 330;

export interface LocalTime {
  /** 0 = Sunday */
  dow: number;
  /** minutes since local midnight */
  minutes: number;
  hour: number;
}

export function istTime(date: Date): LocalTime {
  const t = new Date(date.getTime() + IST_OFFSET_MIN * 60000);
  const minutes = t.getUTCHours() * 60 + t.getUTCMinutes();
  return { dow: t.getUTCDay(), minutes, hour: minutes / 60 };
}

/**
 * A Date whose *local* fields equal IST wall-clock time. The opening_hours
 * library reads local fields, so we hand it this shifted date.
 */
export function istWallClockDate(date: Date): Date {
  const t = new Date(date.getTime() + IST_OFFSET_MIN * 60000);
  return new Date(
    t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(),
    t.getUTCHours(), t.getUTCMinutes(), t.getUTCSeconds(),
  );
}

export type Band = 'day' | 'evening' | 'night';

/** Daylight 06:00–18:00, evening 18:00–22:00, night 22:00–06:00 (IST). */
export function bandOf(date: Date): Band {
  const h = istTime(date).hour;
  if (h >= 6 && h < 18) return 'day';
  if (h >= 18 && h < 22) return 'evening';
  return 'night';
}

/** Darkness 0..1: 0 in full daylight, 1 after ~19:30 until ~05:30 (Delhi). */
export function darkness(date: Date): number {
  const h = istTime(date).hour;
  if (h >= 7 && h < 17.5) return 0;
  if (h >= 17.5 && h < 19) return (h - 17.5) / 1.5;
  if (h >= 5.5 && h < 7) return 1 - (h - 5.5) / 1.5;
  return 1;
}

/**
 * How much the hour itself raises street risk, τ ∈ [0.35, 1].
 * Full daylight 0.35; dusk ramps up; busy evenings (19–21 h) stay moderate
 * because Delhi markets are active; late night (23–05 h) is 1.0.
 */
const TAU_KEYS: [number, number][] = [
  [0, 1], [5, 1], [7, 0.35], [17.5, 0.35], [19, 0.6], [21, 0.75], [23, 1], [24, 1],
];
export function timeScale(date: Date): number {
  const h = istTime(date).hour;
  for (let i = 1; i < TAU_KEYS.length; i++) {
    const [h0, v0] = TAU_KEYS[i - 1], [h1, v1] = TAU_KEYS[i];
    if (h >= h0 && h <= h1) return v0 + ((h - h0) / (h1 - h0)) * (v1 - v0);
  }
  return 1;
}

export function isPeakIST(date: Date): boolean {
  const { dow, hour } = istTime(date);
  if (dow === 0) return false;
  return (hour >= 8.5 && hour < 11) || (hour >= 17.5 && hour < 20.5);
}
