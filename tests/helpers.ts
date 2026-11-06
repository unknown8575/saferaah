import { readFileSync } from 'node:fs';
import { Graph } from '../shared/graph.ts';
import { Router } from '../shared/router.ts';
import type { Poi } from '../shared/places.ts';

let cache: { g: Graph; router: Router; pois: Poi[] } | null = null;
export function delhi() {
  if (!cache) {
    const g = new Graph(readFileSync('web/public/data/graph.bin'));
    const pois: Poi[] = JSON.parse(readFileSync('web/public/data/pois.json', 'utf8'));
    cache = { g, router: new Router(g), pois };
  }
  return cache;
}

/** An IST wall-clock time on Friday 6 Nov 2026. */
export const ist = (hhmm: string, day = '2026-11-06') => new Date(`${day}T${hhmm}:00+05:30`);

export const TRIPS = {
  lajpatSoami: { from: [77.24318, 28.57009] as [number, number], to: [77.22429, 28.54259] as [number, number] },
  narelaNajafgarh: { from: [77.093, 28.852] as [number, number], to: [76.98, 28.61] as [number, number] },
  dwarkaLaxmi: { from: [77.0583, 28.5523] as [number, number], to: [77.2776, 28.6304] as [number, number] },
  mangolSultan: { from: [77.0853, 28.6977] as [number, number], to: [77.0634, 28.6927] as [number, number] },
  cpIndiaGate: { from: [77.2197, 28.6328] as [number, number], to: [77.2295, 28.6129] as [number, number] },
  chandniNdls: { from: [77.2303, 28.6506] as [number, number], to: [77.219, 28.643] as [number, number] },
  hkvGreenPark: { from: [77.194, 28.5535] as [number, number], to: [77.207, 28.5596] as [number, number] },
};
