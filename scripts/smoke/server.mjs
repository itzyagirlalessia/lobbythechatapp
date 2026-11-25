// TEST-ONLY server for run.mjs. Never deploy or expose it: it trusts a `testuser` cookie as the signed-in identity.
// Like scripts/preview.mjs, but fakes the Sites identity headers from that cookie, listens on 127.0.0.1 only,
// and starts with an empty in-memory database. Optional env: ALLOWED (DUO_ALLOWED_EMAILS), ENVIRONMENT (DUO_ENVIRONMENT).
// Usage: node scripts/smoke/server.mjs [port]
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const load = path => import(pathToFileURL(resolve(root, path)).href);
const { openLocalDatabase } = await load('scripts/local-db.mjs');
await load('scripts/build.mjs');
const { default: app } = await import(pathToFileURL(resolve(root, 'dist/server/index.js')).href + '?' + Date.now());
const env = { DB: openLocalDatabase(':memory:'), ROOM_KEY_ENCRYPTION: randomBytes(32).toString('base64'),
  DUO_ALLOWED_EMAILS: process.env.ALLOWED, DUO_ENVIRONMENT: process.env.ENVIRONMENT };
const context = { waitUntil: task => task.catch(() => {}) };
const port = Number(process.argv[2] || 3999);
createServer(async (incoming, outgoing) => {
  try {
    const headers = new Headers(incoming.headers);
    headers.delete('oai-authenticated-user-id');
    headers.delete('oai-authenticated-user-email');
    const user = (incoming.headers.cookie || '').match(/testuser=(\w+)/)?.[1];
    if (user) { headers.set('oai-authenticated-user-id', `acct-${user}`); headers.set('oai-authenticated-user-email', `${user}@example.test`); }
    const request = new Request(`http://127.0.0.1:${port}${incoming.url}`, { method: incoming.method, headers,
      ...(incoming.method === 'GET' || incoming.method === 'HEAD' ? {} : { body: Readable.toWeb(incoming), duplex: 'half' }) });
    const response = await app.fetch(request, env, context);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) await pipeline(Readable.fromWeb(response.body), outgoing); else outgoing.end();
  } catch (error) {
    console.error(error);
    if (!outgoing.headersSent) outgoing.writeHead(500);
    outgoing.end();
  }
}).listen(port, '127.0.0.1', () => console.log(`Smoke server ready on http://127.0.0.1:${port}`));
