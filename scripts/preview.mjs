import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { openLocalDatabase } from './local-db.mjs';
import './build.mjs';

const { default: app } = await import('../dist/server/index.js');
const local = new URL('../.local/', import.meta.url);
mkdirSync(local, { recursive: true });
const keyFile = new URL('room-key', local);
let key = process.env.ROOM_KEY_ENCRYPTION;
if (!key) {
  try {
    writeFileSync(keyFile, randomBytes(32).toString('base64'), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  key = readFileSync(keyFile, 'utf8');
}
const env = { DB: openLocalDatabase(fileURLToPath(new URL('duo.sqlite', local))), ROOM_KEY_ENCRYPTION: key, DUO_ENVIRONMENT: process.env.DUO_ENVIRONMENT };
const context = { waitUntil: task => task.catch(() => console.error('A background reply could not be saved.')) };
const port = Number(process.env.DUO_PORT || 3957);

const server = createServer(async (incoming, outgoing) => {
  try {
    const headers = new Headers(incoming.headers);
    headers.delete('oai-authenticated-user-id');
    headers.delete('oai-authenticated-user-email');
    const request = new Request(`http://127.0.0.1:${port}${incoming.url}`, {
      method: incoming.method,
      headers,
      ...(incoming.method === 'GET' || incoming.method === 'HEAD' ? {} : { body: Readable.toWeb(incoming), duplex: 'half' }),
    });
    const response = await app.fetch(request, env, context);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) await pipeline(Readable.fromWeb(response.body), outgoing);
    else outgoing.end();
  } catch {
    if (!outgoing.headersSent) outgoing.writeHead(500);
    outgoing.end();
  }
});

server.listen(port, '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${port}`));
