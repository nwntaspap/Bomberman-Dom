/**
 * shared/protocol.js — WebSocket message contracts.
 *
 * Messages are JSON envelopes: { type, ...payload }. This module is the single
 * place that names message types and packs/unpacks them, so the client and the
 * server can never drift apart on a message name or shape.
 */

export const MSG = Object.freeze({
  // client → server
  JOIN: 'join', // { nickname } — leaving is implicit on disconnect
  CHAT: 'chat', // { text }
  INPUT: 'input', // { dir, moving } — e.g. { dir: 'up', moving: true }
  PLACE_BOMB: 'placeBomb', // {}

  // server → client
  WELCOME: 'welcome', // { id, nickname, color, slot }
  LOBBY: 'lobby', // { players: [{id, nickname, slot}], state, countdown: null | seconds }
  CHAT_MSG: 'chatMessage', // { from, text, ts }
  GAME_START: 'gameStart', // { map: { cols, rows, tiles, spawns }, players, you }
  SNAPSHOT: 'snapshot', // { tick, state, players, bombs, explosions, blocksDestroyed, powerups }
  // players: [{ id, x, y (px), dir, moving, lives, alive, respawnUntil, powerups: {bombs, flames, speed} }]
  // bombs: [{ id, x, y (px), ownerId, fuseAt }] · explosions: [{ x, y (px), until }]
  // blocksDestroyed: [{ x, y (px) }] (only newly destroyed this tick)
  // powerups: [{ id, x, y (px), type }] · state: 'running' | 'over'
  // Removed entities (exploded bombs, picked-up powerups) are inferred from
  // their absence in the next snapshot; no explicit remove messages.
  LIFE_LOST: 'lifeLost', // { id, livesLeft } — unused; snapshots already carry lives
  // { id } — sent when a player runs out of lives. Dead players are omitted
  // from snapshots, so this is the only signal that their last life is gone.
  ELIMINATED: 'eliminated',
  GAME_OVER: 'gameOver', // { winnerId } — null on a draw
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
