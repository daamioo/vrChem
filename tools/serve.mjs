#!/usr/bin/env node
// Tiny static file server (no dependencies).
//   node tools/serve.mjs            -> http://localhost:8000   (use with `adb reverse tcp:8000 tcp:8000` on Quest)
//   node tools/serve.mjs --https    -> https://<lan-ip>:8000   (needs certs/; create with `npm run cert`)
import http from 'node:http';
import https from 'node:https';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.env.PORT ?? 8000);
const useHttps = process.argv.includes('--https');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };

const handler = async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(root, path));
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(await readFile(file));
  } catch { res.writeHead(404).end('Not found'); }
};

let server;
if (useHttps) {
  const key = join(root, 'certs/key.pem'), cert = join(root, 'certs/cert.pem');
  if (!existsSync(key) || !existsSync(cert)) { console.error('Missing certs/. Run: npm run cert'); process.exit(1); }
  server = https.createServer({ key: readFileSync(key), cert: readFileSync(cert) }, handler);
} else server = http.createServer(handler);

server.listen(port, '0.0.0.0', () => {
  const scheme = useHttps ? 'https' : 'http';
  console.log(`\nVR Chemistry Lab\n  local:   ${scheme}://localhost:${port}`);
  for (const addrs of Object.values(networkInterfaces())) for (const a of addrs ?? []) {
    if (a.family === 'IPv4' && !a.internal) console.log(`  network: ${scheme}://${a.address}:${port}`);
  }
  console.log(useHttps ? '\nOpen the network URL in the Quest Browser and accept the certificate warning.'
    : '\nQuest: run `adb reverse tcp:' + port + ' tcp:' + port + '` then open http://localhost:' + port + ' in the Quest Browser.');
});
