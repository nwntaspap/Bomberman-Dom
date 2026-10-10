/**
 * server/index.js — entry point.
 *
 * Serves the static client AND the WebSocket endpoint on the same port: one
 * process, no CORS, no build step. Node's http module + `ws` only.
 */
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGameServer } from './net.js';
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

const game = createGameServer(server, {
  onMatchReady: players => {
    // Phase 4 replaces this placeholder with the authoritative match. Until
    // then, return the room to the lobby so the countdown flow can be demoed
    // and re-run.
    console.log(`countdown finished — match start lands in Phase 4 (${players.length} players)`);
    game.room.reset();
  },
});

server.listen(PORT, () => {
  console.log(`Bomberman-Dom listening on http://localhost:${PORT}`);
});
