import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { inspectTree, PROJECT_ROOT, PUBLIC_FILES } from './build.mjs';

const CONTENT_TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };

export function resolveRequestPath(rawUrl) {
  let pathname;
  try { pathname = decodeURIComponent(rawUrl.split('?')[0]); } catch { return null; }
  if (!pathname.startsWith('/') || pathname.includes('\\') || pathname.includes('\0') || pathname.includes('%')) return null;
  if (pathname.split('/').some(segment => segment === '..' || segment === '.')) return null;
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  return PUBLIC_FILES.includes(relative) ? relative : null;
}

export function createPreviewServer(root = path.join(PROJECT_ROOT, 'dist')) {
  return http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end('Method not allowed'); return; }
    const relative = resolveRequestPath(request.url ?? '/');
    if (!relative) { response.writeHead(404); response.end('Not found'); return; }
    try {
      await inspectTree(root);
      const content = await readFile(path.join(root, relative));
      response.writeHead(200, { 'Content-Type': CONTENT_TYPES[path.extname(relative)], 'Content-Length': content.length });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch { response.writeHead(404); response.end('Not found'); }
  });
}

export function parsePort(args) {
  if (!args.length) return 4173;
  if (args.length !== 2 || args[0] !== '--port' || !/^\d+$/u.test(args[1])) throw new Error('Usage: npm run serve -- --port 4173');
  const port = Number(args[1]);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Port must be between 1024 and 65535');
  return port;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const port = parsePort(process.argv.slice(2));
    await inspectTree(path.join(PROJECT_ROOT, 'dist'));
    const server = createPreviewServer();
    server.on('error', error => { console.error(error.message); process.exitCode = 1; });
    server.listen(port, '127.0.0.1', () => console.log(`AgriTwin Showcase: http://127.0.0.1:${port}`));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
