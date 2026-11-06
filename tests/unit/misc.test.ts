import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { normalisePhone } from '../../web/src/store.ts';
import { normalizeIndianPhone } from '../../server/notify.ts';
import { PlaceSearch, type Entry } from '../../web/src/search.ts';
import { smsLink, whatsappLink, sosText, arrivalText, telLink } from '../../web/src/messages.ts';
import { Graph } from '../../shared/graph.ts';
import { delhi } from '../helpers.ts';

describe('phone numbers (FR-21)', () => {
  it('TC-80 normalises Indian mobile formats', () => {
    for (const raw of ['98765 43210', '09876543210', '+91 98765-43210', '919876543210']) {
      expect(normalisePhone(raw)).toBe('+919876543210');
      expect(normalizeIndianPhone(raw)).toBe('+919876543210');
    }
    expect(normalisePhone('+44 7700 900123')).toBe('+447700900123');
  });
  it('TC-81 rejects invalid numbers', () => {
    for (const raw of ['12345', '5876543210', 'call me', '', '98765']) expect(normalisePhone(raw)).toBeNull();
  });
});

describe('offline search (FR-1)', () => {
  const s = new PlaceSearch(JSON.parse(readFileSync('web/public/data/search.json', 'utf8')) as Entry[]);
  it('TC-82 finds metro, police and markets for "lajpat"', () => {
    const hits = s.query('lajpat', 8);
    expect(hits.length).toBeGreaterThanOrEqual(4);
    expect(hits[0].type).toBe('station');
    expect(hits.some((h) => h.type === 'police')).toBe(true);
    expect(s.query('india gate')[0].name.toLowerCase()).toContain('india gate');
  });
  it('TC-83 short, gibberish and messy queries', () => {
    expect(s.query('l')).toEqual([]);
    expect(s.query('zzqxv')).toEqual([]);
    expect(s.query('  RAJIV   chowk!! ').length).toBeGreaterThan(0);
  });
});

describe('messages (FR-12, FR-15)', () => {
  it('TC-84 builds SMS, WhatsApp and SOS texts', () => {
    const body = arrivalText('Riya', 'Giri Nagar', '10:42 pm');
    expect(body).toBe('Riya reached Giri Nagar safely at 10:42 pm. (SafeRaah)');
    const link = smsLink(['+919876543210', '+919123456780'], body);
    expect(link.startsWith('sms:+919876543210,+919123456780')).toBe(true);
    expect(link).toContain(encodeURIComponent('Giri Nagar'));
    expect(whatsappLink('+919876543210', 'hi there')).toBe('https://wa.me/919876543210?text=hi%20there');
    const sos = sosText('Riya', 77.24, 28.56, 'https://x/?track=abc');
    expect(sos).toContain('mlat=28.56000');
    expect(sos).toContain('112');
    expect(telLink('112')).toBe('tel:112');
  });
});

describe('graph file (TC-85)', () => {
  it('loads the real graph with consistent arrays', () => {
    const { g } = delhi();
    expect(g.n).toBeGreaterThan(100000);
    expect(g.a.poiOff.length).toBe(g.m + 1);
    expect(g.adjOff[g.n]).toBe(g.m * 2);
    for (let e = 0; e < g.m; e += 997) {
      expect(g.lon(g.a.edgeU[e])).toBeGreaterThan(77);
      expect(g.lat(g.a.edgeU[e])).toBeLessThan(29);
    }
  });
  it('rejects a corrupt file', () => {
    expect(() => new Graph(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(/Not a SafeRaah graph/);
  });
});
