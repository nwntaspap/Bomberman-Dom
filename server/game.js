/**
 * server/game.js — the authoritative Bomberman match simulation.
 *
 * The server owns everything: grid, players, bombs, explosions, power-ups,
 * respawns, and win detection. Clients only send inputs (`input{dir,moving}`,
 * `placeBomb`) and receive per-tick snapshots (see the netcode decision in
 * docs/specs/netcode-timings.md).
 *
 * Timing is *absolute*, not tick-counted: bombs carry `fuseAt`, movement
 * `moveUntil`, flames `until`, respawns `invulnUntil` — all ms timestamps on an
 * injectable clock (`now`), the same pattern as room.js. A tick only
 * re-evaluates "did X happen yet?", so a late/hiccuped tick can neither lose
 * nor double-apply time, and tests can jump the clock freely.
 *
 * All positions are grid cells (x, y); snapshots convert them to pixels.
 */
import {
  BASE_MOVE_MS,
  BOMB_FUSE_MS,
  EXPLOSION_MS,
  MIN_MOVE_MS,
  POWERUPS,
  POWERUP_CHANCE,
  RESPAWN_INVULNERABLE_MS,
  SIM_TICK_MS,
  SPEED_STEP_MS,
  START_LIVES,
  TILE_SIZE,
  TILES,
} from '../shared/constants.js';
import { createRng, generateMap, index } from '../shared/map.js';
import { MSG, pack } from '../shared/protocol.js';

const T = TILE_SIZE;
const OPEN = 1; // ws.readyState for an open connection

const DIRS = Object.freeze({
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
});

const RAYS = Object.freeze([
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]);

const POWERUP_TYPES = [POWERUPS.BOMBS, POWERUPS.FLAMES, POWERUPS.SPEED];

const key = (x, y) => `${x},${y}`;
const px = cell => cell * T;

/**
 * @param {object} [options]
 * @param {Array<{id: number, nickname: string, slot: number, color: string, ws: object}>} [options.players]
 *   the roster, straight from room.js's onMatchReady (full entries incl. ws).
 * @param {object} [options.map] - map from generateMap(); overridable in tests
 * @param {() => number} [options.now] - injectable clock, defaults to Date.now
 * @param {() => number} [options.rng] - injectable PRNG for power-up drops
 * @param {((result: {winnerId: number|null}) => void)|null} [options.onEnd]
 *   fired exactly once when the match ends (winnerId is null on a draw).
 */
export function createMatch({
  players: playerInfos = [],
  map = generateMap({ seed: (Math.random() * 0xffffffff) >>> 0 }),
  now = Date.now,
  rng = createRng((Math.random() * 0xffffffff) >>> 0),
  onEnd = null,
} = {}) {
  const cols = map.cols;
  const rows = map.rows;
  const tiles = Uint8Array.from(map.tiles); // working copy: blocks get destroyed

  /** @type {Map<number, object>} */
  const byId = new Map();
  /** @type {Map<object, object>} */
  const byWs = new Map();
  /** @type {Map<number, object>} */
  const bombs = new Map();
  /** @type {Map<string, object>} */
  const bombsAt = new Map();
  /** @type {Map<number, object>} */
  const powerups = new Map();
  /** @type {Map<string, number>} */
  const powerupsAt = new Map();
  /** @type {Map<string, {until: number, burstId: number}>} */
  const explosions = new Map();

  let nextBombId = 1;
  let nextPowerupId = 1;
  let burstCounter = 0;
  let tickCounter = 0;
  let timer = null;
  let ended = false;
  let pendingDestroyed = [];

  const players = playerInfos.map(p => {
    const player = {
      id: p.id,
      slot: p.slot,
      nickname: p.nickname,
      color: p.color,
      ws: p.ws,
      lives: START_LIVES,
      alive: true,
      // buffs
      maxBombs: 1,
      flameRange: 1,
      speedLevel: 0,
      // movement
      dir: 'down',
      moving: false,
      cx: 0,
      cy: 0,
      x: 0,
      y: 0,
      tx: null,
      ty: null,
      moveStart: 0,
      moveUntil: 0,
      // defense / counters
      invulnUntil: 0,
      lastBurstHit: 0,
      bombsPlaced: 0,
    };
    byId.set(player.id, player);
    byWs.set(player.ws, player);
    const spawn = map.spawns[player.slot] ?? map.spawns[0];
    placeAt(player, spawn.x, spawn.y);
    return player;
  });

  // ---- small helpers ------------------------------------------------------

  function send(ws, msg) {
    if (ws && ws.readyState === OPEN) ws.send(pack(msg.type, msg));
  }

  /** Roster-level event (elimination, game over): sent to every player. */
  function broadcast(msg) {
    for (const p of players) send(p.ws, msg);
  }

  function moveSpeed(player) {
    return Math.max(MIN_MOVE_MS, BASE_MOVE_MS - SPEED_STEP_MS * player.speedLevel);
  }

  /** Cell (x, y) is inside the map and free of solids (walls, blocks, bombs, players). */
  function passable(player, x, y) {
    if (x < 0 || y < 0 || x >= cols || y >= rows) return false;
    if (tiles[index(cols, x, y)] !== TILES.EMPTY) return false;
    if (bombsAt.has(key(x, y))) return false;
    return !players.some(q => q !== player && q.alive && q.cx === x && q.cy === y);
  }

  /** Snaps a player onto a cell (used at spawn, respawn, and debug.setPos). */
  function placeAt(player, x, y) {
    player.cx = x;
    player.cy = y;
    player.x = px(x);
    player.y = px(y);
    player.tx = null;
    player.ty = null;
    player.moveUntil = 0;
  }

  /** Starts a step toward `dir` when the target cell is free; no-op otherwise. */
  function tryMove(player, dir) {
    const [dx, dy] = DIRS[dir];
    const tx = player.cx + dx;
    const ty = player.cy + dy;
    if (!passable(player, tx, ty)) return;
    const startedAt = now();
    player.tx = tx;
    player.ty = ty;
    player.moveStart = startedAt;
    player.moveUntil = startedAt + moveSpeed(player);
  }

  /**
   * Pixel position a player should be drawn at right now. While a step is in
   * flight the client is lerping between snapshots, so the server reports the
   * sub-tile position along that step (px floats) instead of snapping to the
   * source cell until the step lands — otherwise 30 Hz snapshots would look
   * like full-tile teleports.
   */
  function renderPos(player, t) {
    if (player.tx === null) return { x: player.x, y: player.y };
    const span = player.moveUntil - player.moveStart;
    const progress = span <= 0 ? 1 : Math.min(1, Math.max(0, (t - player.moveStart) / span));
    return {
      x: player.x + (px(player.tx) - player.x) * progress,
      y: player.y + (px(player.ty) - player.y) * progress,
    };
  }

  // ---- inputs ---------------------------------------------------------------

  function handleInput(id, input) {
    const p = byId.get(id);
    if (!p || !p.alive) return;
    if (DIRS[input.dir]) p.dir = input.dir;
    p.moving = Boolean(input.moving);
  }

  function handlePlaceBomb(id) {
    const p = byId.get(id);
    if (!p || !p.alive || p.tx !== null) return; // must be standing still
    if (p.bombsPlaced >= p.maxBombs) return;
    const k = key(p.cx, p.cy);
    if (tiles[index(cols, p.cx, p.cy)] !== TILES.EMPTY) return;
    if (bombsAt.has(k) || powerupsAt.has(k)) return;
    if (players.some(q => q !== p && q.alive && q.cx === p.cx && q.cy === p.cy)) return;

    const bomb = {
      id: nextBombId++,
      cx: p.cx,
      cy: p.cy,
      ownerId: p.id,
      fuseAt: now() + BOMB_FUSE_MS,
    };
    bombs.set(bomb.id, bomb);
    bombsAt.set(k, bomb);
    p.bombsPlaced++;
  }

  /** A player who walked onto a power-up cell picks it up. */
  function pickup(player) {
    const k = key(player.cx, player.cy);
    const id = powerupsAt.get(k);
    if (id == null) return;
    const pu = powerups.get(id);
    powerupsAt.delete(k);
    powerups.delete(id);
    if (pu) applyPowerup(player.id, pu.type);
  }

  /** Applies a power-up's effect to a player. Returns false on unknown types. */
  function applyPowerup(id, type) {
    const p = byId.get(id);
    if (!p) return false;
    switch (type) {
      case POWERUPS.BOMBS:
        p.maxBombs++;
        return true;
      case POWERUPS.FLAMES:
        p.flameRange++;
        return true;
      case POWERUPS.SPEED:
        p.speedLevel++;
        return true;
      default:
        return false;
    }
  }

  // ---- movement --------------------------------------------------------------

  function advanceMovement(t) {
    for (const p of players) {
      if (!p.alive) continue;
      if (p.tx === null) {
        if (p.moving && p.dir) tryMove(p, p.dir);
        continue;
      }
      if (t < p.moveUntil) continue; // still walking
      if (!passable(p, p.tx, p.ty)) {
        // Something appeared in the target cell while we walked (bomb/player):
        // halt at the boundary of the cell we are leaving.
        placeAt(p, p.cx, p.cy);
        continue;
      }
      placeAt(p, p.tx, p.ty);
      pickup(p);
      if (p.moving && p.dir) tryMove(p, p.dir); // keep walking while held
    }
  }

  // ---- explosions -------------------------------------------------------------

  /** Drops a power-up on a destroyed block, using the injected rng. */
  function maybeDropPowerup(x, y) {
    if (rng() >= POWERUP_CHANCE) return;
    const type = POWERUP_TYPES[Math.floor(rng() * POWERUP_TYPES.length)];
    const pu = { id: nextPowerupId++, x, y, type };
    powerups.set(pu.id, pu);
    powerupsAt.set(key(x, y), pu.id);
  }

  /**
   * Detonates every bomb whose fuse has run out, resolving chain reactions
   * until the wave stops. Flood-fills the blast cells, destroys blocks and
   * lying power-ups, and records flame cells with a single burst id + `until`.
   */
  function applyBurst(t) {
    const pending = [...bombs.values()].filter(b => b.fuseAt <= t);
    if (pending.length === 0) return;

    const burstId = ++burstCounter;
    const until = t + EXPLOSION_MS;
    const cells = new Set();
    const lostPowerups = [];

    while (pending.length) {
      const b = pending.pop();
      if (!bombs.has(b.id)) continue; // already detonated earlier this burst
      bombs.delete(b.id);
      bombsAt.delete(key(b.cx, b.cy));
      const owner = byId.get(b.ownerId);
      if (owner) owner.bombsPlaced = Math.max(0, owner.bombsPlaced - 1);

      const range = owner ? owner.flameRange : 1;
      cells.add(key(b.cx, b.cy));

      for (const [dx, dy] of RAYS) {
        for (let s = 1; s <= range; s++) {
          const x = b.cx + dx * s;
          const y = b.cy + dy * s;
          if (x < 0 || y < 0 || x >= cols || y >= rows) break;
          const tile = tiles[index(cols, x, y)];
          if (tile === TILES.WALL) break; // indestructible: flame stops
          if (tile === TILES.BLOCK) {
            tiles[index(cols, x, y)] = TILES.EMPTY;
            cells.add(key(x, y));
            pendingDestroyed.push({ x, y });
            maybeDropPowerup(x, y);
            break; // the ray stops at the destroyed block
          }
          cells.add(key(x, y));
          const bombHere = bombsAt.get(key(x, y));
          if (bombHere) {
            pending.push(bombHere); // chain reaction
            break; // a bomb blocks the ray and detonates itself
          }
          if (powerupsAt.has(key(x, y))) lostPowerups.push(key(x, y));
        }
      }
    }

    for (const k of cells) explosions.set(k, { until, burstId });
    for (const k of lostPowerups) {
      const id = powerupsAt.get(k);
      if (id == null) continue;
      powerupsAt.delete(k);
      powerups.delete(id);
    }
  }

  /** Drops fire cells whose lifetime expired. */
  function pruneExplosions(t) {
    for (const [k, e] of explosions) {
      if (e.until <= t) explosions.delete(k);
    }
  }

  // ---- life & damage -------------------------------------------------------------

  /**
   * A player standing in flames loses one life per *burst* (standing in the
   * same burst across ticks is one hit; walking into a new burst is a new hit).
   */
  function applyFireDamage(t) {
    for (const p of players) {
      if (!p.alive || t < p.invulnUntil) continue;
      const e = explosions.get(key(p.cx, p.cy));
      if (e && e.burstId !== p.lastBurstHit) {
        p.lastBurstHit = e.burstId;
        damagePlayer(p);
      }
    }
  }

  /** One life lost: respawn with invulnerability, or elimination at zero. */
  function damagePlayer(p) {
    p.lives--;
    if (p.lives <= 0) {
      p.alive = false;
      p.moving = false;
      p.tx = null;
      p.ty = null;
      p.moveUntil = 0;
      // Eliminated players are dropped from snapshots, so the client can't
      // infer the final life loss from them — announce it explicitly (the HUD
      // would otherwise freeze on the last snapshot the player appeared in).
      broadcast({ type: MSG.ELIMINATED, id: p.id });
    } else {
      const spawn = map.spawns[p.slot] ?? map.spawns[0];
      placeAt(p, spawn.x, spawn.y);
      p.moving = false; // a respawn always starts standing still
      p.invulnUntil = now() + RESPAWN_INVULNERABLE_MS;
    }
  }

  // ---- match lifecycle ------------------------------------------------------------

  function winCheck() {
    if (ended) return;
    // A match needs at least two contenders; the room guarantees this, but a
    // solo match must not instantly declare itself won on its very first tick.
    if (players.length < 2) return;
    const alive = players.filter(p => p.alive);
    if (alive.length <= 1) end(alive.length === 1 ? alive[0].id : null);
  }

  function broadcastSnapshot(t, over = false) {
    const msg = {
      type: MSG.SNAPSHOT,
      tick: ++tickCounter,
      state: over ? 'over' : 'running',
      players: players
        .filter(p => p.alive)
        .map(p => {
          const pos = renderPos(p, t);
          return {
            id: p.id,
            x: Math.round(pos.x),
            y: Math.round(pos.y),
            dir: p.dir,
            moving: p.moving,
            lives: p.lives,
            alive: true,
            respawnUntil: p.invulnUntil > t ? p.invulnUntil : null,
            powerups: { bombs: p.maxBombs, flames: p.flameRange, speed: p.speedLevel },
          };
        }),
      bombs: [...bombs.values()].map(b => ({
        id: b.id,
        x: px(b.cx),
        y: px(b.cy),
        ownerId: b.ownerId,
        fuseAt: b.fuseAt,
      })),
      explosions: [...explosions.entries()].map(([k, e]) => {
        const [x, y] = k.split(',').map(Number);
        return { x: px(x), y: px(y), until: e.until };
      }),
      blocksDestroyed: pendingDestroyed.splice(0, Infinity).map(c => ({ x: px(c.x), y: px(c.y) })),
      powerups: [...powerups.values()].map(pu => ({
        id: pu.id,
        x: px(pu.x),
        y: px(pu.y),
        type: pu.type,
      })),
    };
    for (const p of players) send(p.ws, msg);
  }

  function end(winnerId) {
    if (ended) return;
    ended = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    broadcastSnapshot(now(), true);
    broadcast({ type: MSG.GAME_OVER, winnerId });
    if (onEnd) onEnd({ winnerId });
  }

  function tick() {
    const t = now();
    if (ended) return;
    pruneExplosions(t);
    applyBurst(t);
    applyFireDamage(t);
    advanceMovement(t);
    winCheck();
    if (ended) return;
    broadcastSnapshot(t);
  }

  /** Starts the authoritative loop (30 Hz). Call once after creation. */
  function start() {
    for (const p of players) {
      send(p.ws, {
        type: MSG.GAME_START,
        map: { cols, rows, tiles: Array.from(tiles), spawns: map.spawns },
        players: players.map(p => ({
          id: p.id,
          nickname: p.nickname,
          slot: p.slot,
          color: p.color,
        })),
        you: p.id,
      });
    }
    if (!timer) timer = setInterval(tick, SIM_TICK_MS);
  }

  function destroy() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  /** Routes an INPUT / PLACE_BOMB frame from a connected ws to its player. */
  function handleMessage(ws, msg) {
    const p = byWs.get(ws);
    if (!p) return;
    if (msg.type === MSG.INPUT) handleInput(p.id, msg);
    else if (msg.type === MSG.PLACE_BOMB) handlePlaceBomb(p.id);
  }

  /** A player's connection dropped: remove them from the match as if eliminated. */
  function handleLeave(ws) {
    const p = byWs.get(ws);
    if (!p) return;
    byWs.delete(ws);
    p.ws = null;
    p.alive = false;
    p.lives = 0;
    p.moving = false;
    p.tx = null;
    p.ty = null;
    winCheck();
  }

  return {
    start,
    tick,
    destroy,
    handleInput,
    handlePlaceBomb,
    handleMessage,
    handleLeave,
    applyPowerup,
    debug: {
      setPos: (id, cx, cy) => {
        const p = byId.get(id);
        if (p) placeAt(p, cx, cy);
      },
      give: applyPowerup,
      damage: id => {
        const p = byId.get(id);
        if (p) damagePlayer(p);
      },
      inspect: () => ({
        ended,
        players: players.map(p => ({
          id: p.id,
          cx: p.cx,
          cy: p.cy,
          lives: p.lives,
          alive: p.alive,
          maxBombs: p.maxBombs,
          flameRange: p.flameRange,
          speedLevel: p.speedLevel,
          invulnUntil: p.invulnUntil,
          bombsPlaced: p.bombsPlaced,
        })),
        bombs: [...bombs.values()].map(b => ({
          id: b.id,
          cx: b.cx,
          cy: b.cy,
          ownerId: b.ownerId,
          fuseAt: b.fuseAt,
        })),
        explosionCells: [...explosions.keys()],
        powerups: [...powerups.values()].map(pu => ({
          id: pu.id,
          x: pu.x,
          y: pu.y,
          type: pu.type,
        })),
      }),
    },
  };
}
