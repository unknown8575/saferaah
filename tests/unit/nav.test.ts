import { describe, it, expect } from 'vitest';
import { sayDistance, fmtShort } from '../../web/src/nav.ts';

describe('spoken guidance', () => {
  it('TC-127 distances are rounded the way people say them', () => {
    expect(sayDistance(7)).toBe('10 metres');
    expect(sayDistance(84)).toBe('80 metres');
    expect(sayDistance(236)).toBe('250 metres');
    expect(sayDistance(960)).toBe('1 kilometre');
    expect(sayDistance(1540)).toBe('1.5 kilometres');
    expect(sayDistance(3000)).toBe('3 kilometres');
    expect(fmtShort(4)).toBe('10 m');
    expect(fmtShort(1234)).toBe('1.2 km');
  });
});
