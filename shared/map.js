/**
 * shared/map.js — deterministic Bomberman map generation.
 *
 * Pure logic (no DOM, no Node-only APIs) so the same code runs on the server
 * (authoritative board) and could run on the client too.
 *
 * Layout (classic Bomberman):
 *  - border walls on the outer ring,
 *  - fixed pillars on every interior even/even cell (indestructible),
 *  - destructible blocks randomly on the remaining cells, except the spawn
 *    corners, which are always kept clear so a player can retreat and dodge
 *    their own bomb.
 *
 * `generateMap` is seeded: the same seed always produces the same map.
 */
import { BLOCK_DENSITY, MAP_COLS, MAP_ROWS, TILES } from './constants.js';

/**
 * Small, fast, seedable PRNG (mulberry32). No external dependency.
 * @param {number} seed - any 32-bit integer
 * @returns {() => number} function returning values in [0, 1)
 */
export function createRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Flat-array index for cell (x, y) on a cols-wide grid. */
export function index(cols, x, y) {
  return y * cols + x;
}

/** Is (x, y) on the border ring of a cols×rows map? */
export function isBorder(x, y, cols, rows) {
  return x === 0 || y === 0 || x === cols - 1 || y === rows - 1;
}

/** Classic pillar pattern: interior even/even cells are indestructible walls. */
export function isPillar(x, y) {
  return x % 2 === 0 && y % 2 === 0;
}

/** The four spawn corners: top-left, top-right, bottom-left, bottom-right. */
export function spawnPoints(cols, rows) {
  return [
    { x: 1, y: 1 },
    { x: cols - 2, y: 1 },
    { x: 1, y: rows - 2 },
    { x: cols - 2, y: rows - 2 },
  ];
}

/**
 * True when (x, y) is the spawn cell or one of its two escape cells (one step
 * inwards along each axis), which must never be blocked by a wall or block.
 */
function inClearZone(x, y, spawns) {
  return spawns.some(spawn => {
    const dx = spawn.x === 1 ? 1 : -1;
    const dy = spawn.y === 1 ? 1 : -1;
    return (
      (spawn.x === x && spawn.y === y) ||
      (spawn.x + dx === x && spawn.y === y) ||
      (spawn.x === x && spawn.y + dy === y)
    );
  });
}

/**
 * Generates a map.
 * @param {object} [options]
 * @param {number} [options.cols] - number of columns (must be ≥ 5)
 * @param {number} [options.rows] - number of rows (must be ≥ 5)
 * @param {number} [options.seed] - any integer; same seed → same map
 * @returns {{ cols: number, rows: number, tiles: Uint8Array, spawns: Array<{x: number, y: number}> }}
 */
export function generateMap({ cols = MAP_COLS, rows = MAP_ROWS, seed = 1 } = {}) {
  const tiles = new Uint8Array(cols * rows);
  const spawns = spawnPoints(cols, rows);
  const rng = createRng(seed);

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (isBorder(x, y, cols, rows) || isPillar(x, y)) {
        tiles[index(cols, x, y)] = TILES.WALL;
      } else if (inClearZone(x, y, spawns)) {
        tiles[index(cols, x, y)] = TILES.EMPTY;
      } else {
        tiles[index(cols, x, y)] = rng() < BLOCK_DENSITY ? TILES.BLOCK : TILES.EMPTY;
      }
    }
  }

  return { cols, rows, tiles, spawns };
}

/** Tile value at (x, y). */
export function tileAt(map, x, y) {
  return map.tiles[index(map.cols, x, y)];
}

/** A cell is walkable when it is inside the map and empty. */
export function isWalkable(map, x, y) {
  if (x < 0 || y < 0 || x >= map.cols || y >= map.rows) return false;
  return tileAt(map, x, y) === TILES.EMPTY;
}

/** Number of destructible blocks on the map. */
export function countBlocks(map) {
  let count = 0;
  for (let i = 0; i < map.tiles.length; i++) {
    if (map.tiles[i] === TILES.BLOCK) count++;
  }
  return count;
}
