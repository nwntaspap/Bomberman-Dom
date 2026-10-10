/**
 * server/net.js — wires the WebSocket server to the room.
 *
 * One WebSocketServer on the same HTTP server, upgrade path `/ws`. Incoming
 * frames are unpacked via the shared protocol and routed to the room. A single
 * room instance serves everyone (see room.js).
 */
import { WebSocketServer } from 'ws';
import { WS_PATH } from '../shared/constants.js';
import { MSG, unpack } from '../shared/protocol.js';
import { createRoom } from './room.js';

/**
 * Attaches the WebSocket server and room to an existing HTTP server.
 *
 * @param {import('node:http').Server} httpServer
 * @param {object} [options]
 * @param {((players: Array) => void)|null} [options.onMatchReady] - passed to the room
 * @returns {{ room: ReturnType<typeof createRoom>, wss: WebSocketServer }}
 */
export function createGameServer(httpServer, { onMatchReady = null } = {}) {
  const wss = new WebSocketServer({ server: httpServer, path: WS_PATH });
  const room = createRoom({ onMatchReady });

  wss.on('connection', ws => {
    ws.on('message', raw => {
      const msg = unpack(raw);
      if (msg) route(ws, room, msg);
    });
    ws.on('close', () => room.handleLeave(ws));
    ws.on('error', () => room.handleLeave(ws));
  });

  return { room, wss };
}

function route(ws, room, msg) {
  switch (msg.type) {
    case MSG.JOIN:
      room.handleJoin(ws, msg.nickname);
      break;
    case MSG.CHAT:
      room.handleChat(ws, msg.text);
      break;
    // MSG.INPUT / MSG.PLACE_BOMB are consumed by the game in Phase 4.
  }
}
