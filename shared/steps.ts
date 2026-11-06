// Simple turn-by-turn steps from a routed edge chain.
import type { Graph } from './graph.ts';
import { ROAD_CLASSES } from './modes.ts';
import type { LonLat } from './geo.ts';

export interface Step {
  text: string;
  turn: 'start' | 'straight' | 'slight_left' | 'left' | 'sharp_left' | 'slight_right' | 'right' | 'sharp_right' | 'uturn' | 'arrive';
  distM: number; // distance to travel on this step
  at: LonLat; // where the step begins
  /** index into route coords where the step begins */
  idx: number;
}

function bearing(a: LonLat, b: LonLat): number {
  const toR = Math.PI / 180;
  const y = Math.sin((b[0] - a[0]) * toR) * Math.cos(b[1] * toR);
  const x = Math.cos(a[1] * toR) * Math.sin(b[1] * toR) - Math.sin(a[1] * toR) * Math.cos(b[1] * toR) * Math.cos((b[0] - a[0]) * toR);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

export function turnOf(inB: number, outB: number): Step['turn'] {
  let d = outB - inB;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  const a = Math.abs(d);
  if (a < 25) return 'straight';
  if (a > 160) return 'uturn';
  const side = d < 0 ? 'left' : 'right';
  if (a < 60) return `slight_${side}` as Step['turn'];
  if (a < 125) return side;
  return `sharp_${side}` as Step['turn'];
}

const TURN_WORDS: Record<Step['turn'], string> = {
  start: 'Head', straight: 'Continue', slight_left: 'Bear left', left: 'Turn left', sharp_left: 'Turn sharp left',
  slight_right: 'Bear right', right: 'Turn right', sharp_right: 'Turn sharp right', uturn: 'Make a U-turn', arrive: 'Arrive',
};

const GENERIC = new Set(['the footpath', 'the steps', 'the lane', 'the road']);
function stepText(turn: Step['turn'], name: string): string {
  if (!GENERIC.has(name)) return `${TURN_WORDS[turn]} onto ${name}`;
  if (turn === 'straight') return 'Continue straight';
  if (name === 'the steps') return `${TURN_WORDS[turn]} and take the steps`;
  return `${TURN_WORDS[turn]} into ${name}`;
}

function roadLabel(g: Graph, e: number): string {
  const n = g.name(e);
  if (n) return n;
  const c = ROAD_CLASSES[g.a.edgeClass[e]];
  if (c === 'footway' || c === 'path' || c === 'pedestrian') return 'the footpath';
  if (c === 'steps') return 'the steps';
  if (c === 'service' || c === 'residential' || c === 'living_street') return 'the lane';
  return 'the road';
}

/** coords[i]→coords[i+1] travels along edges[i]. */
export function buildSteps(g: Graph, edges: number[], coords: LonLat[]): Step[] {
  const steps: Step[] = [];
  if (coords.length < 2) return steps;
  const segLen = (i: number) => g.proj.dist(coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1]);
  let cur: Step = { text: GENERIC.has(roadLabel(g, edges[0])) ? 'Start along the route' : `Head along ${roadLabel(g, edges[0])}`, turn: 'start', distM: 0, at: coords[0], idx: 0 };
  let curName = roadLabel(g, edges[0]);
  for (let i = 0; i < coords.length - 1; i++) {
    const e = edges[Math.min(i, edges.length - 1)];
    const name = roadLabel(g, e);
    if (i > 0 && name !== curName) {
      const inB = bearing(coords[i - 1], coords[i]);
      const outB = bearing(coords[i], coords[i + 1]);
      const turn = turnOf(inB, outB);
      // merge tiny unnamed hops into the current step
      if (cur.distM < 15 && cur.turn !== 'start' && steps.length) {
        cur = { ...cur, text: stepText(turn, name), turn };
      } else {
        steps.push(cur);
        cur = { text: stepText(turn, name), turn, distM: 0, at: coords[i], idx: i };
      }
      curName = name;
    }
    cur.distM += segLen(i);
  }
  steps.push(cur);
  steps.push({ text: 'You have arrived', turn: 'arrive', distM: 0, at: coords[coords.length - 1], idx: coords.length - 1 });
  return steps.map((s) => ({ ...s, distM: Math.round(s.distM) }));
}
