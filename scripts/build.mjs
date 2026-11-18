import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (name, encoding) => readFile(new URL(name, root), encoding);
const files = [
  ['/', 'index.html', 'text/html; charset=utf-8'],
  ['/terms', 'terms.html', 'text/html; charset=utf-8'],
  ['/copyright', 'copyright.html', 'text/html; charset=utf-8'],
  ['/app.css', 'app.css', 'text/css; charset=utf-8'],
  ['/app.js', 'app.js', 'text/javascript; charset=utf-8'],
  ['/pictures.js', 'pictures.js', 'text/javascript; charset=utf-8'],
  ['/voice.js', 'voice.js', 'text/javascript; charset=utf-8'],
  ['/board.js', 'board.js', 'text/javascript; charset=utf-8'],
  ['/social.js', 'social.js', 'text/javascript; charset=utf-8'],
  ['/formatting.js', 'formatting.js', 'text/javascript; charset=utf-8'],
  ['/favicon.svg', 'favicon.svg', 'image/svg+xml'],
  ['/pluma.png', 'pluma.png', 'image/png'],
];
const entries = await Promise.all(files.map(async ([route, name, type]) => {
  const binary = type === 'image/png';
  const data = await read(`src/${name}`, binary ? 'base64' : 'utf8');
  const contents = binary ? `Uint8Array.from(atob(${JSON.stringify(data)}), char => char.charCodeAt(0))` : JSON.stringify(data);
  const etag = `"${createHash('sha256').update(data).digest('hex').slice(0, 32)}"`;
  return `${JSON.stringify(route)}: [${JSON.stringify(type)}, ${contents}, ${JSON.stringify(etag)}]`;
}));
const worker = (await read('src/worker.js', 'utf8')).replace("import { assets } from './assets.js';", `const assets = {\n${entries.join(',\n')}\n};`);
await mkdir(new URL('dist/server/', root), { recursive: true });
await writeFile(new URL('dist/server/index.js', root), worker);
console.log('Built Lobby.');
