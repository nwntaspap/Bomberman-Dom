/**
 * shared/protocol.js — WebSocket message contracts.
 *
 * Messages are JSON envelopes: { type, ...payload }. This module is the single
 * place that names message types and packs/unpacks them, so the client and the
 * server can never drift apart on a message name or shape.
 */

export const MSG = Object.freeze({
  // client → server
  JOIN: 'join', // { nickname }
  LEAVE: 'leave', // (implicit on disconnect)
  CHAT: 'chat', // { text }
  INPUT: 'input', // { dir, moving } — e.g. { dir: 'up', moving: true }
  PLACE_BOMB: 'placeBomb', // {}

  // server → client
  WELCOME: 'welcome', // { id, nickname, color, slot }
  LOBBY: 'lobby', // { players: [{id, nickname, slot}], state, countdown: null | seconds }
  CHAT_MSG: 'chatMessage', // { from, text, ts }
  GAME_START: 'gameStart', // { map: { cols, rows, tiles, spawns }, players, you }
  SNAPSHOT: 'snapshot', // { tick, players, bombs, explosions, blocksDestroyed, powerups }
  LIFE_LOST: 'lifeLost', // { id, livesLeft }
  ELIMINATED: 'eliminated', // { id }
  GAME_OVER: 'gameOver', // { winnerId }
  ERROR: 'error', // { code, message }
});

/**
 * Serializes a message to its wire form.
 * @param {string} type - a MSG key value
 * @param {object} [payload]
 * @returns {string} JSON string
 */
export function pack(type, payload = {}) {
  return JSON.stringify({ type, ...payload });
}

/**
 * Parses a raw WebSocket frame into a message object, or null when it is not
 * valid JSON / has no type. Malformed frames are dropped instead of crashing
 * the handler.
 * @param {string|Buffer} raw
 * @returns {{ type: string } | null}
 */
export function unpack(raw) {
  try {
    const msg = JSON.parse(String(raw));
    return msg && typeof msg.type === 'string' ? msg : null;
  } catch {
    return null;
  }
}
