/**
 * client/game/renderer.js — the game board renderer (direct DOM, no framework).
 *
 * The framework builds the board *structure* once (an empty `.board` element);
 * this module owns everything inside it and never goes through `setState`.
 *
 * Layout: a static tile layer (walls + destructible blocks, built once) and an
 * entity layer (players, bombs, flames, power-ups). Static nodes never move;
 * only players are re-positioned every frame with `transform: translate3d`, so
 * the compositor moves them without repainting the tiles (PLAN §3).
 *
 * Snapshots arrive at 30 Hz; the rAF loop calls `render(now)`, which picks the
 * two buffered snapshots bracketing `now - INTERP_DELAY_MS` and lerps player
 * positions between them (see docs/specs/netcode-timings.md). Discrete entities
 * (bombs, flames, power-ups) are diffed by id/cell against the newest snapshot:
 * anything that vanished was exploded, picked up, or burnt away.
 */
import {
  INTERP_DELAY_MS,
  POWERUPS,
  SNAPSHOT_BUFFER_MAX,
  TILE_SIZE,
  TILES,
} from '../../shared/constants.js';
import { index } from '../../shared/map.js';

const T = TILE_SIZE;

const POWERUP_CLASS = {
  [POWERUPS.BOMBS]: 'powerup-bombs',
  [POWERUPS.FLAMES]: 'powerup-flames',
  [POWERUPS.SPEED]: 'powerup-speed',
};
const POWERUP_LABEL = {
  [POWERUPS.BOMBS]: 'B',
  [POWERUPS.FLAMES]: 'F',
  [POWERUPS.SPEED]: 'S',
};

const cellKey = (x, y) => `${x},${y}`;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

function el(className) {
  const node = document.createElement('div');
  node.className = className;
  return node;
}

/**
 * Positions a sprite. `translate3d` keeps the sprite on its own composited
 * layer while it moves, so the browser doesn't repaint the whole board.
 */
function place(node, x, y) {
  node.style.transform = `translate3d(${x}px, ${y}px, 0)`;
}

/** A tiny node pool: `release` hides a node and keeps it for the next `acquire`. */
function createPool(create) {
  const free = [];
  return {
    acquire() {
      const node = free.pop() || create();
      node.style.display = '';
      return node;
    },
    release(node) {
      node.style.display = 'none';
      free.push(node);
    },
    clear() {
      free.length = 0;
    },
  };
}

/**
 * @param {HTMLElement} root - the empty `.board` element built by the framework
 * @param {{cols: number, rows: number, tiles: Array<number>}} map - from `gameStart`
 * @param {Array<{id: number, nickname: string, color: string}>} players - roster meta
 * @returns {{ setSnapshot: (snap: object) => void, render: (now: number) => void, destroy: () => void }}
 */
export function createRenderer(root, map, players) {
  const { cols, rows, tiles } = map;
  root.style.width = `${cols * T}px`;
  root.style.height = `${rows * T}px`;

  const tileLayer = el('layer layer-tiles');
  const entityLayer = el('layer layer-entities');
  root.append(tileLayer, entityLayer);

  const colorById = new Map(players.map(p => [p.id, p.color]));
  const nameById = new Map(players.map(p => [p.id, p.nickname]));

  // ---- static board: walls + destructible blocks (built once) --------------
  const blockEls = new Map(); // "x,y" -> block tile, so it can be removed later
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const tile = tiles[index(cols, x, y)];
      if (tile !== TILES.WALL && tile !== TILES.BLOCK) continue;
      const node = el(tile === TILES.WALL ? 'tile wall' : 'tile block');
      place(node, x * T, y * T);
      tileLayer.appendChild(node);
      if (tile === TILES.BLOCK) blockEls.set(cellKey(x, y), node);
    }
  }

  // ---- entity sprites (pooled shapes + id/cell keyed maps) -----------------
  const bombEls = new Map(); // bomb id -> node
  const flameEls = new Map(); // "x,y" -> node
  const powerupEls = new Map(); // powerup id -> node
  const playerEls = new Map(); // player id -> node

  const bombPool = createPool(() => {
    const node = el('sprite bomb');
    node.appendChild(el('bomb-core'));
    entityLayer.appendChild(node);
    return node;
  });
  const flamePool = createPool(() => {
    const node = el('sprite flame');
    entityLayer.appendChild(node);
    return node;
  });
  const powerupPool = createPool(() => {
    const node = el('sprite powerup');
    node.appendChild(document.createElement('span'));
    entityLayer.appendChild(node);
    return node;
  });

  // ---- snapshot buffer + interpolation -------------------------------------
  /** @type {Array<{recvAt: number, snap: object}>} */
  const buffer = [];

  function removeBlocks(destroyed) {
    for (const c of destroyed) {
      const key = cellKey(c.x, c.y);
      const node = blockEls.get(key);
      if (!node) continue;
      node.remove();
      blockEls.delete(key);
    }
  }

  function syncBombs(list) {
    const seen = new Set();
    for (const bomb of list) {
      seen.add(bomb.id);
      let node = bombEls.get(bomb.id);
      if (!node) {
        node = bombPool.acquire();
        bombEls.set(bomb.id, node);
      }
      place(node, bomb.x, bomb.y);
    }
    for (const [id, node] of bombEls) {
      if (seen.has(id)) continue;
      bombEls.delete(id);
      bombPool.release(node);
    }
  }

  function syncFlames(list) {
    const seen = new Set();
    for (const flame of list) {
      const key = cellKey(flame.x, flame.y);
      seen.add(key);
      let node = flameEls.get(key);
      if (!node) {
        node = flamePool.acquire();
        flameEls.set(key, node);
      }
      place(node, flame.x, flame.y);
    }
    for (const [key, node] of flameEls) {
      if (seen.has(key)) continue;
      flameEls.delete(key);
      flamePool.release(node);
    }
  }

  function syncPowerups(list) {
    const seen = new Set();
    for (const pu of list) {
      seen.add(pu.id);
      let node = powerupEls.get(pu.id);
      if (!node) {
        node = powerupPool.acquire();
        powerupEls.set(pu.id, node);
      }
      node.className = `sprite powerup ${POWERUP_CLASS[pu.type] || ''}`;
      node.firstChild.textContent = POWERUP_LABEL[pu.type] || '?';
      place(node, pu.x, pu.y);
    }
    for (const [id, node] of powerupEls) {
      if (seen.has(id)) continue;
      powerupEls.delete(id);
      powerupPool.release(node);
    }
  }

  function playerEl(id) {
    let node = playerEls.get(id);
    if (node) return node;
    node = el('sprite player');
    node.style.background = colorById.get(id) || '#ffffff';
    const name = document.createElement('span');
    name.className = 'player-name';
    name.textContent = nameById.get(id) || '';
    node.appendChild(name);
    entityLayer.appendChild(node);
    playerEls.set(id, node);
    return node;
  }

  /**
   * Picks the snapshot pair bracketing `renderTime = now - INTERP_DELAY_MS`.
   * On buffer underflow (a janky tab) it holds the newest snapshot instead of
   * extrapolating — sprites freeze rather than rubber-band.
   */
  function sample(now) {
    if (buffer.length === 0) return null;
    if (buffer.length === 1) return { from: buffer[0].snap, to: buffer[0].snap, t: 1 };
    const renderTime = now - INTERP_DELAY_MS;
    const newest = buffer[buffer.length - 1];
    if (renderTime >= newest.recvAt) return { from: newest.snap, to: newest.snap, t: 1 };
    let i = buffer.length - 2;
    while (i > 0 && buffer[i].recvAt > renderTime) i--;
    const a = buffer[i];
    const b = buffer[i + 1];
    const span = b.recvAt - a.recvAt;
    return { from: a.snap, to: b.snap, t: span <= 0 ? 1 : clamp01((renderTime - a.recvAt) / span) };
  }

  return {
    /** Buffers a new snapshot and applies its discrete (non-interpolated) state. */
    setSnapshot(snap) {
      buffer.push({ recvAt: performance.now(), snap });
      if (buffer.length > SNAPSHOT_BUFFER_MAX) buffer.shift();
      removeBlocks(snap.blocksDestroyed || []);
      syncBombs(snap.bombs || []);
      syncFlames(snap.explosions || []);
      syncPowerups(snap.powerups || []);
    },

    /** Per-frame: interpolate + reposition players. Called from the rAF loop. */
    render(now) {
      const s = sample(now);
      if (!s) return;
      const previous = new Map(s.from.players.map(p => [p.id, p]));
      const seen = new Set();
      for (const p of s.to.players) {
        seen.add(p.id);
        const node = playerEl(p.id);
        const from = previous.get(p.id) || p;
        place(node, lerp(from.x, p.x, s.t), lerp(from.y, p.y, s.t));
        node.dataset.dir = p.dir;
        node.classList.toggle('moving', Boolean(p.moving));
        node.classList.toggle('invuln', p.respawnUntil != null);
      }
      for (const [id, node] of playerEls) {
        if (seen.has(id)) continue;
        node.remove();
        playerEls.delete(id);
      }
    },

    destroy() {
      buffer.length = 0;
      root.replaceChildren();
      bombEls.clear();
      flameEls.clear();
      powerupEls.clear();
      playerEls.clear();
      blockEls.clear();
      bombPool.clear();
      flamePool.clear();
      powerupPool.clear();
    },
  };
}
