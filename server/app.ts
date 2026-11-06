// SafeRaah API + static file server (plain node:http, no framework).
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { DatabaseSync } from 'node:sqlite';
import { JourneyMonitor, reviewEligibility, type Fix } from '../shared/journey.ts';
import { MODES, type Mode } from '../shared/modes.ts';
import { REPORT_KINDS, isReportKind } from '../shared/live.ts';
import { haversine } from '../shared/geo.ts';
import type { LonLat } from '../shared/geo.ts';
import { sendSms, smsConfigured } from './notify.ts';

export interface AppOptions {
  db: DatabaseSync;
  staticDir?: string;
  graphVersion: string;
  /** ms clock, injectable for tests */
  now?: () => number;
  rateLimitPerMin?: number;
}

class HttpError extends Error {
  constructor(readonly status: number, msg: string) { super(msg); }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.woff': 'font/woff',
  '.json': 'application/json', '.bin': 'application/octet-stream', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.gif': 'image/gif', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.pbf': 'application/x-protobuf', '.webp': 'image/webp', '.mp4': 'video/mp4', '.md': 'text/markdown; charset=utf-8',
};

const TAGS = new Set(['felt_safe', 'well_lit', 'busy', 'police_seen', 'shops_open', 'dark', 'deserted',
  'harassment', 'followed', 'stray_dogs', 'bad_footpath', 'drunk_people']);

function isLonLat(p: unknown): p is LonLat {
  return Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === 'number' && Number.isFinite(v)) &&
    Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
}

export function createApp(opts: AppOptions): Server {
  const { db } = opts;
  const now = opts.now ?? Date.now;
  const limit = opts.rateLimitPerMin ?? 240;
  const buckets = new Map<string, { n: number; reset: number }>();
  const staticRoot = opts.staticDir ? resolve(opts.staticDir) : null;

  function rateLimit(key: string) {
    const t = now();
    let b = buckets.get(key);
    if (!b || t > b.reset) { b = { n: 0, reset: t + 60000 }; buckets.set(key, b); }
    if (++b.n > limit) throw new HttpError(429, 'Too many requests, slow down');
    if (buckets.size > 10000) for (const [k, v] of buckets) if (t > v.reset) buckets.delete(k);
  }

  async function body(req: IncomingMessage): Promise<any> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > 512 * 1024) throw new HttpError(413, 'Request too large');
      chunks.push(c as Buffer);
    }
    if (!size) return {};
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new HttpError(400, 'Invalid JSON'); }
  }

  function device(req: IncomingMessage): string {
    const d = String(req.headers['x-device-id'] ?? '');
    if (!/^[A-Za-z0-9-]{16,64}$/.test(d)) throw new HttpError(400, 'Missing or invalid x-device-id header');
    return d;
  }

  function journeyFor(id: string, token: string): any {
    const j = db.prepare('SELECT * FROM journeys WHERE id = ?').get(id) as any;
    if (!j) throw new HttpError(404, 'Journey not found');
    if (typeof token !== 'string' || token !== j.token) throw new HttpError(403, 'Bad journey token');
    return j;
  }

  function monitorFor(j: any): JourneyMonitor {
    const m = new JourneyMonitor({
      mode: j.mode as Mode, route: JSON.parse(j.route_json), dest: [j.dest_lon, j.dest_lat],
      etaS: j.eta_s, startedAt: j.started_at,
    });
    const fixes = db.prepare('SELECT t, lon, lat, acc FROM fixes WHERE journey_id = ? ORDER BY t').all(j.id) as unknown as Fix[];
    for (const f of fixes) m.feed(f);
    return m;
  }

  const routes: Record<string, (req: IncomingMessage, m: RegExpMatchArray) => Promise<unknown>> = {
    'GET /api/health': async () => ({
      ok: true, graphVersion: opts.graphVersion, sms: smsConfigured(),
    }),

    'POST /api/journeys': async (req) => {
      const dev = device(req);
      rateLimit('j:' + dev);
      const b = await body(req);
      if (!MODES.includes(b.mode)) throw new HttpError(400, 'Invalid mode');
      if (!Array.isArray(b.route) || b.route.length < 2 || b.route.length > 20000 || !b.route.every(isLonLat))
        throw new HttpError(400, 'Invalid route');
      if (!Array.isArray(b.edges) || b.edges.length > 50000 || !b.edges.every((e: unknown) => Number.isInteger(e) && (e as number) >= 0))
        throw new HttpError(400, 'Invalid edges');
      if (!isLonLat(b.dest)) throw new HttpError(400, 'Invalid destination');
      if (typeof b.etaS !== 'number' || !(b.etaS > 0) || b.etaS > 6 * 3600) throw new HttpError(400, 'Invalid ETA');
      const id = randomUUID(), token = randomBytes(24).toString('base64url'), shareId = randomBytes(16).toString('base64url');
      const name = typeof b.name === 'string' ? b.name.slice(0, 40) : null;
      db.prepare(`INSERT INTO journeys (id, device, token, share_id, graph_version, mode, route_json, edges_json,
        dest_lon, dest_lat, eta_s, started_at, traveller_name, simulated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, dev, token, shareId, String(b.graphVersion ?? opts.graphVersion), b.mode, JSON.stringify(b.route),
          JSON.stringify(b.edges), b.dest[0], b.dest[1], b.etaS, now(), name, b.simulated ? 1 : 0);
      return { id, token, shareId };
    },

    'POST /api/journeys/([\\w-]+)/fixes': async (req, m) => {
      const b = await body(req);
      const j = journeyFor(m[1], b.token);
      rateLimit('f:' + j.id);
      if (!Array.isArray(b.fixes) || b.fixes.length > 500) throw new HttpError(400, 'Invalid fixes');
      const ins = db.prepare('INSERT OR IGNORE INTO fixes (journey_id, t, lon, lat, acc) VALUES (?,?,?,?,?)');
      let n = 0;
      for (const f of b.fixes) {
        if (!isLonLat([f?.lon, f?.lat]) || !Number.isFinite(f.t) || !Number.isFinite(f.acc) || f.acc < 0) continue;
        if (f.t > now() + 60000 || f.t < j.started_at - 60000) continue; // reject clock games
        ins.run(j.id, Math.round(f.t), f.lon, f.lat, f.acc);
        n++;
      }
      return { ok: true, stored: n, status: j.status };
    },

    'POST /api/journeys/([\\w-]+)/finish': async (req, m) => {
      const b = await body(req);
      const j = journeyFor(m[1], b.token);
      const mon = monitorFor(j);
      const el = reviewEligibility(mon);
      if (j.simulated) { el.eligible = false; el.reasons.unshift('this was a demo trip with simulated movement'); }
      const reviewToken = el.eligible ? randomBytes(18).toString('base64url') : null;
      db.prepare(`UPDATE journeys SET status = ?, arrived_at = ?, eligible = ?, coverage = ?, review_token = ? WHERE id = ?`)
        .run(mon.arrivedAt ? 'arrived' : 'ended', mon.arrivedAt, el.eligible ? 1 : 0, el.coverage, reviewToken, j.id);
      return { arrived: !!mon.arrivedAt, eligible: el.eligible, coverage: el.coverage, reasons: el.reasons, reviewToken };
    },

    'POST /api/journeys/([\\w-]+)/sos': async (req, m) => {
      const b = await body(req);
      const j = journeyFor(m[1], b.token);
      db.prepare(`UPDATE journeys SET status = 'sos' WHERE id = ?`).run(j.id);
      let sent = 0;
      if (Array.isArray(b.contacts) && typeof b.message === 'string' && smsConfigured()) {
        for (const to of b.contacts.slice(0, 5)) if (await sendSms(String(to), b.message.slice(0, 600))) sent++;
      }
      return { ok: true, shareId: j.share_id, smsSent: sent };
    },

    'POST /api/journeys/([\\w-]+)/notify': async (req, m) => {
      const b = await body(req);
      const j = journeyFor(m[1], b.token);
      rateLimit('n:' + j.id);
      let sent = 0;
      if (Array.isArray(b.contacts) && typeof b.message === 'string' && smsConfigured()) {
        for (const to of b.contacts.slice(0, 5)) if (await sendSms(String(to), b.message.slice(0, 600))) sent++;
      }
      return { ok: true, smsSent: sent };
    },

    'POST /api/journeys/([\\w-]+)/route': async (req, m) => {
      // re-routed mid-journey: verification and review use the new route from here on
      const b = await body(req);
      const j = journeyFor(m[1], b.token);
      if (!Array.isArray(b.route) || b.route.length < 2 || b.route.length > 20000 || !b.route.every(isLonLat))
        throw new HttpError(400, 'Invalid route');
      if (!Array.isArray(b.edges) || b.edges.length > 50000 || !b.edges.every((e: unknown) => Number.isInteger(e) && (e as number) >= 0))
        throw new HttpError(400, 'Invalid edges');
      if (typeof b.etaS !== 'number' || !(b.etaS > 0) || b.etaS > 6 * 3600) throw new HttpError(400, 'Invalid ETA');
      db.prepare('UPDATE journeys SET route_json = ?, edges_json = ?, eta_s = ?, started_at = ? WHERE id = ?')
        .run(JSON.stringify(b.route), JSON.stringify(b.edges), b.etaS, now(), j.id);
      db.prepare('DELETE FROM fixes WHERE journey_id = ? AND t < ?').run(j.id, now() - 60000);
      return { ok: true };
    },

    'POST /api/reports': async (req) => {
      const dev = device(req);
      const b = await body(req);
      if (!isReportKind(b.kind)) throw new HttpError(400, 'Unknown report type');
      if (!isLonLat([b.lon, b.lat]) || !isLonLat([b.at?.lon, b.at?.lat])) throw new HttpError(400, 'Location needed');
      const acc = Math.min(200, Math.max(0, Number(b.at.acc) || 0));
      // you can only report a spot you are near
      if (haversine(b.lon, b.lat, b.at.lon, b.at.lat) > 300 + acc) throw new HttpError(403, 'Report only places near where you are');
      const t = now();
      const recent = (db.prepare('SELECT COUNT(*) AS n FROM reports WHERE device = ? AND created_at > ?').get(dev, t - 3600000) as { n: number }).n;
      if (recent >= 6) throw new HttpError(429, 'Too many reports in the last hour');
      // the same problem already reported close by counts as a confirmation
      const near = (db.prepare('SELECT id, lon, lat FROM reports WHERE kind = ? AND expires_at > ? AND lon BETWEEN ? AND ? AND lat BETWEEN ? AND ?')
        .all(b.kind, t, b.lon - 0.001, b.lon + 0.001, b.lat - 0.001, b.lat + 0.001) as { id: string; lon: number; lat: number }[])
        .find((r) => haversine(r.lon, r.lat, b.lon, b.lat) <= 80);
      let id = near?.id;
      if (!id) {
        id = randomUUID();
        db.prepare('INSERT INTO reports (id, kind, lon, lat, device, created_at, expires_at) VALUES (?,?,?,?,?,?,?)')
          .run(id, b.kind, b.lon, b.lat, dev, t, t + REPORT_KINDS[b.kind as keyof typeof REPORT_KINDS].hours * 3600000);
      }
      db.prepare(`INSERT INTO report_votes (report_id, device, still, at) VALUES (?,?,1,?)
        ON CONFLICT(report_id, device) DO UPDATE SET still = 1, at = excluded.at`).run(id, dev, t);
      return { ok: true, id, merged: !!near };
    },

    'POST /api/reports/([\\w-]+)/vote': async (req, m) => {
      const dev = device(req);
      rateLimit('rv:' + dev);
      const b = await body(req);
      const r = db.prepare('SELECT * FROM reports WHERE id = ?').get(m[1]) as any;
      if (!r || r.expires_at <= now()) throw new HttpError(404, 'Report has expired');
      if (typeof b.still !== 'boolean') throw new HttpError(400, 'Say whether it is still there');
      if (!isLonLat([b.at?.lon, b.at?.lat]) || haversine(r.lon, r.lat, b.at.lon, b.at.lat) > 500 + Math.min(200, Number(b.at.acc) || 0))
        throw new HttpError(403, 'Only people near the spot can confirm it');
      db.prepare(`INSERT INTO report_votes (report_id, device, still, at) VALUES (?,?,?,?)
        ON CONFLICT(report_id, device) DO UPDATE SET still = excluded.still, at = excluded.at`).run(r.id, dev, b.still ? 1 : 0, now());
      return { ok: true };
    },

    'GET /api/reports': async (req) => {
      const q = new URL(req.url ?? '', 'http://x').searchParams.get('bbox') ?? '';
      const [w, s, e, n] = q.split(',').map(Number);
      if (![w, s, e, n].every(Number.isFinite) || e - w > 2 || n - s > 2) throw new HttpError(400, 'bbox=w,s,e,n needed (max 2°)');
      const t = now();
      const rows = db.prepare(`SELECT r.id, r.kind, r.lon, r.lat, r.created_at AS createdAt, r.expires_at AS expiresAt,
          COALESCE(SUM(v.still = 1), 0) AS confirms, COALESCE(SUM(v.still = 0), 0) AS dismisses
        FROM reports r LEFT JOIN report_votes v ON v.report_id = r.id
        WHERE r.expires_at > ? AND r.lon BETWEEN ? AND ? AND r.lat BETWEEN ? AND ?
        GROUP BY r.id ORDER BY r.created_at DESC LIMIT 500`).all(t, w, e, s, n) as any[];
      return { now: t, reports: rows.filter((r) => r.dismisses <= r.confirms) };
    },

    'POST /api/reviews': async (req) => {
      const dev = device(req);
      rateLimit('r:' + dev);
      const b = await body(req);
      const j = db.prepare('SELECT * FROM journeys WHERE id = ?').get(String(b.journeyId)) as any;
      if (!j) throw new HttpError(404, 'Journey not found');
      if (!j.eligible || !j.review_token || b.reviewToken !== j.review_token)
        throw new HttpError(403, 'This journey is not verified for a review');
      if (j.device !== dev) throw new HttpError(403, 'Only the traveller can review this journey');
      if (j.reviewed) throw new HttpError(409, 'Already reviewed');
      const rating = b.rating;
      if (typeof rating !== 'number' || !Number.isInteger(rating) || rating < 1 || rating > 5)
        throw new HttpError(400, 'Rating must be a whole number from 1 to 5');
      const tags = Array.isArray(b.tags) ? b.tags.filter((t: unknown) => typeof t === 'string' && TAGS.has(t)).slice(0, 8) : [];
      const comment = typeof b.comment === 'string' ? b.comment.slice(0, 500) : null;
      const t = now();
      db.exec('BEGIN');
      try {
        db.prepare('INSERT INTO reviews (journey_id, device, rating, tags, comment, created_at) VALUES (?,?,?,?,?,?)')
          .run(j.id, dev, rating, JSON.stringify(tags), comment, t);
        const up = db.prepare(`INSERT INTO edge_votes (graph_version, edge, device, rating, updated_at) VALUES (?,?,?,?,?)
          ON CONFLICT(graph_version, edge, device) DO UPDATE SET rating = excluded.rating, updated_at = excluded.updated_at`);
        for (const e of new Set<number>(JSON.parse(j.edges_json))) up.run(j.graph_version, e, dev, rating, t);
        db.prepare('UPDATE journeys SET reviewed = 1 WHERE id = ?').run(j.id);
        db.exec('COMMIT');
      } catch (err) { db.exec('ROLLBACK'); throw err; }
      return { ok: true };
    },

    'GET /api/crowd': async (req) => {
      const v = new URL(req.url ?? '', 'http://x').searchParams.get('v') ?? opts.graphVersion;
      // Each device counts once per segment; votes decay with a 90-day half-life.
      const rows = db.prepare(`SELECT edge, rating, updated_at FROM edge_votes WHERE graph_version = ?`)
        .all(v) as { edge: number; rating: number; updated_at: number }[];
      const agg = new Map<number, { w: number; s: number }>();
      const t = now(), HALF = 90 * 86400000;
      for (const r of rows) {
        const w = Math.pow(0.5, Math.max(0, t - r.updated_at) / HALF);
        const a = agg.get(r.edge) ?? { w: 0, s: 0 };
        a.w += w; a.s += w * r.rating;
        agg.set(r.edge, a);
      }
      return { v, stats: [...agg].map(([e, a]) => [e, +a.w.toFixed(2), +(a.s / a.w).toFixed(3)]) };
    },

    'GET /api/share/([\\w-]+)': async (_req, m) => {
      const j = db.prepare('SELECT * FROM journeys WHERE share_id = ?').get(m[1]) as any;
      if (!j) throw new HttpError(404, 'Shared trip not found');
      const last = db.prepare('SELECT t, lon, lat, acc FROM fixes WHERE journey_id = ? ORDER BY t DESC LIMIT 1').get(j.id);
      const stale = now() - j.started_at > 12 * 3600 * 1000;
      return {
        status: stale && j.status === 'active' ? 'expired' : j.status, mode: j.mode, name: j.traveller_name,
        route: JSON.parse(j.route_json), dest: [j.dest_lon, j.dest_lat], etaS: j.eta_s,
        startedAt: j.started_at, arrivedAt: j.arrived_at, last,
      };
    },
  };
  const compiled = Object.entries(routes).map(([k, fn]) => {
    const [method, path] = k.split(' ');
    return { method, re: new RegExp(`^${path}$`), fn };
  });

  async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    if (!staticRoot || (req.method !== 'GET' && req.method !== 'HEAD')) return false;
    let p = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = normalize(join(staticRoot, p));
    if (!file.startsWith(staticRoot)) return false;
    let s;
    try { s = await stat(file); } catch { return false; }
    if (!s.isFile()) return false;
    let data: Buffer = await readFile(file);
    const type = MIME[extname(file)] ?? 'application/octet-stream';
    const headers: Record<string, string> = { 'content-type': type };
    headers['cache-control'] = p.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
    if (/gzip/.test(String(req.headers['accept-encoding'])) && /json|javascript|css|html|octet|svg|protobuf/.test(type) && data.length > 1024) {
      data = gzipSync(data);
      headers['content-encoding'] = 'gzip';
    }
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : data);
    return true;
  }

  // The Android/iOS apps load the UI from the device (capacitor://localhost or
  // https://localhost) and call this server, so those origins may use the API.
  const allowed = new Set(['capacitor://localhost', 'https://localhost', 'http://localhost',
    ...(process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean)]);

  return createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    const origin = String(req.headers.origin ?? '');
    if (path.startsWith('/api/') && allowed.has(origin)) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'origin');
      res.setHeader('access-control-allow-headers', 'content-type, x-device-id');
      res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    }
    try {
      if (path.startsWith('/api/')) {
        rateLimit('ip:' + (req.socket.remoteAddress ?? '?'));
        const route = compiled.find((r) => r.method === req.method && r.re.test(path));
        if (!route) throw new HttpError(404, 'No such endpoint');
        const out = await route.fn(req, path.match(route.re)!);
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify(out));
        return;
      }
      if (await serveStatic(req, res)) return;
      // SPA fallback
      if (staticRoot && req.method === 'GET') {
        const html = await readFile(join(staticRoot, 'index.html')).catch(() => null);
        if (html) { res.writeHead(200, { 'content-type': MIME['.html'] }); res.end(html); return; }
      }
      throw new HttpError(404, 'Not found');
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: err instanceof HttpError ? err.message : 'Internal error' }));
    }
  });
}
