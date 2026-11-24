import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fixtureResponse, port } from './fixtures';

const dist = resolve(import.meta.dir, '../../dist');
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-Match, X-Requested-With',
  'Access-Control-Allow-Private-Network': 'true',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
};

Bun.serve({
  port,
  hostname: '127.0.0.1',
  async fetch(request, server) {
    const pathname = decodeURIComponent(new URL(request.url).pathname);
    if (pathname === '/api/v1/sync/ws' && server.upgrade(request)) return;
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const fixture = await fixtureResponse(request);
    if (fixture) {
      const headers = new Headers(fixture.headers);
      for (const [key, value] of Object.entries(cors)) headers.set(key, value);
      return new Response(fixture.body, { status: fixture.status, headers });
    }

    const path = resolve(dist, `.${pathname}`);
    if (path.startsWith(dist + sep) && existsSync(path) && !pathname.endsWith('/')) {
      const file = Bun.file(path);
      if (await file.exists()) return new Response(file);
    }
    if (pathname.startsWith('/assets/')) return new Response('Not found', { status: 404 });
    return new Response(Bun.file(join(dist, 'index.html')));
  },
  websocket: { message() {} },
});

console.log(`Screenshot fixtures ready on loopback port ${port}`);
