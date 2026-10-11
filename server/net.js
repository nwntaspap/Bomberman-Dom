/**
 * server/net.js — wires the WebSocket server to the room and the match.
 *
 * One WebSocketServer on the same HTTP server, upgrade path `/ws`. Incoming
 * frames are unpacked via the shared protocol and routed:
 *  - while no match is running → the room (join/chat),
 *  - while a match is running → `input`/`placeBomb` go to the match, the rest
 *    still goes to the room (chat keeps working in-game).
 *
 * Lifecycle: the room's countdown reaching zero fires `onMatchReady`, which
 * creates the authoritative match; when the match ends, the result stays on
 * screen for MATCH_END_RESET_MS and then the room reopens for the lobby.
 */
import { WebSocketServer } from 'ws';
import { MATCH_END_RESET_MS, WS_PATH } from '../shared/constants.js';
import { MSG, unpack } from '../shared/protocol.js';
import { createMatch } from './game.js';
import { createRoom } from './room.js';

/**
 * Attaches the WebSocket server, the room, and the match lifecycle to an
 * existing HTTP server.
 *
 * @param {import('node:http').Server} httpServer
 * @returns {{ room: ReturnType<typeof createRoom>, wss: WebSocketServer }}
 */
export function createGameServer(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: WS_PATH });
  const room = createRoom({ onMatchReady: startMatch });

  let match = null;

  function startMatch(roster) {
    console.log(`match starting with ${roster.length} players`);
    match = createMatch({
      players: roster,
      onEnd: ({ winnerId }) => {
        match = null;
        console.log(`match over — winner: ${winnerId ?? 'draw'}`);
        setTimeout(() => room.reset(), MATCH_END_RESET_MS);
      },
    });
    match.start();
  }

  wss.on('connection', ws => {
    ws.on('message', raw => {
      const msg = unpack(raw);
      if (!msg) return;
      if (match && (msg.type === MSG.INPUT || msg.type === MSG.PLACE_BOMB)) {
        match.handleMessage(ws, msg);
      } else {
        route(ws, room, msg);
      }
    });
    const leave = () => {
      if (match) match.handleLeave(ws);
      room.handleLeave(ws);
    };
    ws.on('close', leave);
    ws.on('error', leave);
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
    default:
      break;
  }
}
