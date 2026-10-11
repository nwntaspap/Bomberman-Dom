/**
 * shared/constants.js — single source of truth for game-wide constants.
 * Imported by both the client (browser) and the server (Node). No DOM, no
 * Node-only APIs: pure values, safe to share.
 */

// ---- Match setup ----------------------------------------------------------
export const MAX_PLAYERS = 4;
export const MIN_PLAYERS_TO_START = 2;
export const START_LIVES = 3;
export const MATCH_END_RESET_MS = 4_000; // how long the result stays on screen before the room reopens

// ---- Map ------------------------------------------------------------------
export const MAP_COLS = 15;
export const MAP_ROWS = 13;
export const TILE_SIZE = 32; // px — used by the client renderer
export const BLOCK_DENSITY = 0.55;

// ---- Tiles ----------------------------------------------------------------
export const TILES = Object.freeze({
  EMPTY: 0,
  WALL: 1,
  BLOCK: 2,
});

// ---- Lobby / countdown ------------------------------------------------------
export const LOBBY_WAIT_MS = 20_000; // window to fill the room before forcing a start
export const COUNTDOWN_MS = 10_000; // "get ready" countdown before the match starts

// ---- Simulation (server) ----------------------------------------------------
// 30 Hz authoritative tick + one snapshot per tick (30 Hz), client interpolates
// between snapshots — see docs/specs/netcode-timings.md.
export const SIM_TICK_MS = 1000 / 30;
export const BOMB_FUSE_MS = 2_000; // time from placement to explosion
export const EXPLOSION_MS = 400; // how long flames stay visible/lethal
export const BASE_MOVE_MS = 140; // time to step one tile at base speed
export const SPEED_STEP_MS = 20; // reduction per Speed power-up
export const MIN_MOVE_MS = 70; // movement speed floor
export const RESPAWN_INVULNERABLE_MS = 1_500;

// ---- Power-ups --------------------------------------------------------------
export const POWERUPS = Object.freeze({
  BOMBS: 1, // +1 max bomb at a time
  FLAMES: 2, // +1 explosion range in all four directions
  SPEED: 3, // +1 movement speed
});
export const POWERUP_CHANCE = 0.3; // probability a destroyed block drops one

// ---- Players ----------------------------------------------------------------
export const PLAYER_COLORS = Object.freeze(['#2ecc71', '#3498db', '#e74c3c', '#f1c40f']);

// ---- Networking ---------------------------------------------------------------
export const WS_PATH = '/ws';
