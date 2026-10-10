/**
 * server/index.js — entry point.
 *
 * Serves the static client and (from Phase 2) upgrades to WebSocket on the
 * same port. Keep it dependency-light: Node's http module only.
 */
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStaticHandler } from './static.js';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const PORT = Number(process.env.PORT) || 3001;

// The client is a History-API SPA, so unknown navigation paths fall back to
// the app entry point (e.g. refreshing on /game).
const serveStatic = createStaticHandler(ROOT, {
  allow: ['client', 'framework'],
  fallback: resolve(ROOT, 'client/index.html'),
});

const server = createServer((req, res) => {
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Bomberman-Dom listening on http://localhost:${PORT}`);
});
