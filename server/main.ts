// Start the SafeRaah server:  npm start   (PORT, DB_PATH, STATIC_DIR env vars)
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createApp } from './app.ts';
import { openDb } from './db.ts';

const port = Number(process.env.PORT ?? 8787);
const staticDir = resolve(process.env.STATIC_DIR ?? 'web/dist');
const dbPath = resolve(process.env.DB_PATH ?? 'data/saferaah.db');
mkdirSync(dirname(dbPath), { recursive: true });

let graphVersion = 'dev';
try {
  graphVersion = createHash('sha1').update(readFileSync(resolve(staticDir, 'data/graph.bin'))).digest('hex').slice(0, 12);
} catch {
  console.warn('graph.bin not found in', staticDir, '— run `npm run build` first');
}
const server = createApp({ db: openDb(dbPath), staticDir, graphVersion });
server.listen(port, () => console.log(`SafeRaah running on http://localhost:${port}  (graph ${graphVersion})`));
