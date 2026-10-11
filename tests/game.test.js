/**
 * tests/game.test.js — unit tests for the authoritative match (server/game.js).
 *
 * The clock and the rng are injected, so every test is deterministic: no
 * timers, no randomness, no real sockets (fake ws objects capture messages).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createMatch } from '../server/game.js';
import {
  BASE_MOVE_MS,
  BOMB_FUSE_MS,
  POWERUPS,
  RESPAWN_INVULNERABLE_MS,
  START_LIVES,
} from '../shared/constants.js';
import { isBorder, isPillar, index, spawnPoints } from '../shared/map.js';
import { MSG } from '../shared/protocol.js';
import { TILES } from '../shared/constants.js';

// ---- helpers -------------------------------------------------------------

function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    advance(ms) {
      t += ms;
    },
  };
}

/**
 * A mostly-empty map with border walls and pillars (indestructible), plus any
 * explicitly placed blocks.
 */
function mkMap(cols, rows, { blockAt = [], spawns = spawnPoints(cols, rows) } = {}) {
  const tiles = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      tiles[index(cols, x, y)] =
        isBorder(x, y, cols, rows) || isPillar(x, y) ? TILES.WALL : TILES.EMPTY;
    }
  }
  for (const [x, y] of blockAt) tiles[index(cols, x, y)] = TILES.BLOCK;
  return { cols, rows, tiles, spawns };
}

function fakeWs() {
  return {
    readyState: 1,
    sent: [],
    send(data) {
      this.sent.push(JSON.parse(data));
    },
  };
}

/** Scripted rng: returns the listed values in order, then the last one forever. */
function seq(...vals) {
  let i = 0;
  return () => vals[Math.min(i++, vals.length - 1)];
}

function makeMatch({ n = 2, map = mkMap(15, 13), rng = seq(1), onEnd = null } = {}) {
  const ws = Array.from({ length: n }, () => fakeWs());
  const players = ws.map((w, i) => ({
    id: i + 1,
    nickname: `P${i + 1}`,
    slot: i,
    color: '#000',
    ws: w,
  }));
  const clock = fakeClock();
  const match = createMatch({ players, map, now: clock.now, rng, onEnd });
  return { match, players, ws, clock };
}

const insp = m => m.debug.inspect();
const lastOf = (ws, type) => [...ws.sent].reverse().find(m => m.type === type);

function tickThrough(clock, match, totalMs, stepMs = 100) {
  for (let t = stepMs; t <= totalMs; t += stepMs) {
    clock.advance(stepMs);
    match.tick();
  }
}

// ---- movement ---------------------------------------------------------------

test('a player is blocked by walls and stays on the spawn cell', () => {
  const { match, clock, players } = makeMatch({ n: 1 });

  match.handleInput(players[0].id, { dir: 'up', moving: true });
  tickThrough(clock, match, 500);
  assert.deepEqual([insp(match).players[0].cx, insp(match).players[0].cy], [1, 1]);

  const mid = insp(match).players[0];
  match.handleInput(players[0].id, { dir: 'left', moving: true });
  tickThrough(clock, match, 500);
  const end = insp(match).players[0];
  assert.deepEqual([end.cx, end.cy], [1, 1]);
  assert.equal(end.lives, START_LIVES);
  assert.equal(mid.cx, 1);
});

test('held direction walks continuously; releasing stops at the next cell', () => {
  const { match, clock, players } = makeMatch({ n: 1 });

  match.handleInput(players[0].id, { dir: 'right', moving: true });
  clock.advance(BASE_MOVE_MS / 2);
  match.tick();
  assert.equal(insp(match).players[0].cx, 1); // t=70: starts walking, mid-tile

  clock.advance(BASE_MOVE_MS); // the step was scheduled from t=70, so it lands at 210
  match.tick();
  assert.equal(insp(match).players[0].cx, 2); // arrived at (2,1), walks on

  clock.advance(BASE_MOVE_MS);
  match.tick();
  assert.equal(insp(match).players[0].cx, 3); // held → kept walking

  match.handleInput(players[0].id, { dir: 'right', moving: false }); // release mid-walk
  clock.advance(BASE_MOVE_MS * 2);
  match.tick();
  assert.equal(insp(match).players[0].cx, 4); // finishes the in-flight step, then stops
});

test('players cannot walk through each other', () => {
  const { match, clock, players } = makeMatch({ n: 2 });
  match.debug.setPos(players[1].id, 2, 1);

  match.handleInput(players[0].id, { dir: 'right', moving: true });
  tickThrough(clock, match, 300);
  assert.equal(insp(match).players[0].cx, 1); // P2 parks at (2,1): P1 cannot leave

  match.debug.setPos(players[1].id, 4, 1);
  tickThrough(clock, match, 700);
  assert.equal(insp(match).players[0].cx, 3); // walks to the cell before P2 and stops
});

// ---- bombs -------------------------------------------------------------------

test('planting while walking is ignored', () => {
  const { match, clock, players } = makeMatch({ n: 1 });
  match.handleInput(players[0].id, { dir: 'right', moving: true });
  clock.advance(BASE_MOVE_MS / 2);
  match.tick();
  match.handlePlaceBomb(players[0].id);
  assert.equal(insp(match).bombs.length, 0);
});

test('a bomb blocks its own cell for re-entry but not for leaving', () => {
  const { match, clock, players } = makeMatch({ n: 1 });

  match.handlePlaceBomb(players[0].id); // bomb at (1,1)
  assert.equal(insp(match).bombs.length, 1);

  match.handleInput(players[0].id, { dir: 'right', moving: true });
  tickThrough(clock, match, 400);
  assert.equal(insp(match).players[0].cx, 2); // left the bomb cell fine

  match.handleInput(players[0].id, { dir: 'left', moving: true });
  tickThrough(clock, match, 500);
  assert.equal(insp(match).players[0].cx, 2); // re-entering is blocked
});

test('maxBombs limits concurrent bombs and a Bomb power-up raises it', () => {
  const { match, clock, players } = makeMatch({ n: 1 });

  match.handlePlaceBomb(players[0].id); // (1,1)
  match.handleInput(players[0].id, { dir: 'right', moving: true });
  tickThrough(clock, match, 300); // reaches (2,1), keeps walking
  match.handleInput(players[0].id, { dir: 'right', moving: false }); // stop at next cell
  tickThrough(clock, match, 300); // now standing at (3,1)

  match.handlePlaceBomb(players[0].id);
  assert.equal(insp(match).bombs.length, 1); // rejected: only one allowed

  assert.equal(match.applyPowerup(players[0].id, POWERUPS.BOMBS), true);
  match.handlePlaceBomb(players[0].id);
  assert.equal(insp(match).bombs.length, 2); // now allowed
});

// ---- explosions ----------------------------------------------------------

test('a bomb explodes after its fuse and hurts the standing player', () => {
  const { match, clock, players, ws } = makeMatch({ n: 1 });

  match.handlePlaceBomb(players[0].id); // (1,1), fuse 2000
  clock.advance(BOMB_FUSE_MS / 2);
  match.tick();
  assert.equal(insp(match).bombs.length, 1); // still ticking

  clock.advance(BOMB_FUSE_MS / 2 + 1);
  match.tick();
  const state = insp(match);
  assert.equal(state.bombs.length, 0); // gone
  for (const cell of ['1,1', '2,1', '1,2']) assert.ok(state.explosionCells.includes(cell));
  assert.equal(state.players[0].lives, START_LIVES - 1); // was standing on it
  assert.ok(state.players[0].invulnUntil > 0);

  const snap = lastOf(ws[0], MSG.SNAPSHOT);
  assert.equal(snap.state, 'running');
  assert.ok(snap.explosions.length > 0);
});

test('flames follow flameRange and stop at indestructible walls', () => {
  const { match, clock, players } = makeMatch({ n: 1 });

  assert.equal(match.applyPowerup(players[0].id, POWERUPS.FLAMES), true); // range 2
  match.handlePlaceBomb(players[0].id);
  clock.advance(BOMB_FUSE_MS + 1);
  match.tick();

  const cells = insp(match).explosionCells;
  assert.ok(cells.includes('3,1') && cells.includes('1,3')); // 2 tiles out
  assert.ok(!cells.includes('4,1') && !cells.includes('1,4')); // not 3 tiles
  assert.ok(!cells.includes('0,1') && !cells.includes('1,0')); // border walls stop rays
});

test('fire destroys blocks, stops at them, and can drop a power-up', () => {
  const map = mkMap(15, 13, { blockAt: [[3, 1]] });
  const { match, clock, players, ws } = makeMatch({ n: 1, map, rng: seq(0, 0) });

  match.applyPowerup(players[0].id, POWERUPS.FLAMES);
  match.handlePlaceBomb(players[0].id);
  clock.advance(BOMB_FUSE_MS + 1);
  match.tick();

  const cells = insp(match).explosionCells;
  assert.ok(!cells.includes('4,1')); // the ray stopped at the destroyed block
  const drop = insp(match).powerups.find(pu => pu.x === 3 && pu.y === 1);
  assert.ok(drop);
  assert.equal(drop.type, POWERUPS.BOMBS); // scripted rng: drop + BOMBS type
  assert.deepEqual(lastOf(ws[0], MSG.SNAPSHOT).blocksDestroyed, [{ x: 96, y: 32 }]); // px
});

test('blocksDestroyed is reported only once per destroyed block', () => {
  const map = mkMap(15, 13, { blockAt: [[3, 1]] });
  const { match, clock, players, ws } = makeMatch({ n: 1, map });

  match.applyPowerup(players[0].id, POWERUPS.FLAMES);
  match.handlePlaceBomb(players[0].id);
  clock.advance(BOMB_FUSE_MS + 1);
  match.tick(); // boom: reports (3,1)
  clock.advance(100);
  match.tick(); // next tick: nothing new

  const snaps = ws[0].sent.filter(m => m.type === MSG.SNAPSHOT);
  assert.ok(snaps.some(s => s.blocksDestroyed.length === 1));
  assert.equal(snaps[snaps.length - 1].blocksDestroyed.length, 0);
});

test('a chain reaction detonates a neighbouring bomb before its own fuse', () => {
  const { match, clock, players } = makeMatch({ n: 1 });

  match.applyPowerup(players[0].id, POWERUPS.BOMBS); // maxBombs 2
  match.handlePlaceBomb(players[0].id); // A at (1,1), fuse 2000

  match.handleInput(players[0].id, { dir: 'right', moving: true });
  clock.advance(BASE_MOVE_MS / 2);
  match.tick();
  match.handleInput(players[0].id, { dir: 'right', moving: false }); // stop at (2,1)
  clock.advance(BASE_MOVE_MS);
  match.tick();
  assert.equal(insp(match).players[0].cx, 2);
  match.handlePlaceBomb(players[0].id); // B at (2,1), own fuse 2210

  match.handleInput(players[0].id, { dir: 'right', moving: true });
  clock.advance(BASE_MOVE_MS);
  match.tick(); // P1 now at (3,1)

  clock.advance(BOMB_FUSE_MS - BASE_MOVE_MS * 2); // t=2000: A blows → chains B
  match.tick();

  const state = insp(match);
  assert.equal(state.bombs.length, 0); // both gone
  assert.ok(state.explosionCells.includes('2,1')); // B detonated early, by chain
  assert.ok(state.explosionCells.includes('3,1')); // B's blast reached P1
  assert.equal(state.players[0].lives, START_LIVES - 1); // caught by own chain
});

// ---- power-ups & respawn ---------------------------------------------------

test('walking onto a power-up picks it up', () => {
  const map = mkMap(15, 13, { blockAt: [[3, 1]] });
  const { match, clock, players } = makeMatch({ n: 1, map, rng: seq(0, 0) });

  match.applyPowerup(players[0].id, POWERUPS.FLAMES);
  match.handlePlaceBomb(players[0].id);
  clock.advance(BOMB_FUSE_MS + 1);
  match.tick(); // drop lands at (3,1); P1 respawned at (1,1) with invulnerability

  match.handleInput(players[0].id, { dir: 'right', moving: true });
  tickThrough(clock, match, 300); // step onto still-burning (2,1) — invulnerable
  clock.advance(BASE_MOVE_MS);
  match.tick(); // arrives at (3,1) and picks the power-up up

  const after = insp(match).players[0];
  assert.equal(after.cx, 3);
  assert.equal(after.maxBombs, 2); // picked up BOMBS
  assert.equal(after.lives, START_LIVES - 1); // invulnerability absorbed the fire
});

test('planting a bomb on a power-up cell is rejected', () => {
  const map = mkMap(15, 13, { blockAt: [[3, 1]] });
  const { match, clock, players } = makeMatch({ n: 1, map, rng: seq(0, 0) });

  match.applyPowerup(players[0].id, POWERUPS.FLAMES);
  match.handlePlaceBomb(players[0].id);
  clock.advance(BOMB_FUSE_MS + 1);
  match.tick();

  match.debug.setPos(players[0].id, 3, 1); // stand on the fresh power-up
  match.handlePlaceBomb(players[0].id);
  assert.equal(insp(match).bombs.length, 0);
});

test('respawn grants invulnerability that absorbs standing in fire', () => {
  const { match, clock, players } = makeMatch({ n: 1 });

  match.handlePlaceBomb(players[0].id); // A at (1,1)
  clock.advance(BOMB_FUSE_MS + 1);
  match.tick(); // A blows: P1 hit → lives 2, respawn (1,1), invuln until 3501
  const first = insp(match).players[0];
  assert.equal(first.lives, 2);
  assert.deepEqual([first.cx, first.cy], [1, 1]);
  assert.equal(first.invulnUntil, BOMB_FUSE_MS + 1 + RESPAWN_INVULNERABLE_MS);

  match.handlePlaceBomb(players[0].id); // B at (1,1), fuse 4001
  match.handleInput(players[0].id, { dir: 'right', moving: true });
  clock.advance(BASE_MOVE_MS);
  match.tick(); // t=2141: starts walking into the still-burning spawn cell
  match.handleInput(players[0].id, { dir: 'right', moving: false }); // stop at next cell
  clock.advance(BASE_MOVE_MS);
  match.tick(); // t=2281: arrives at (2,1) — stood on fire, invulnerable
  const second = insp(match).players[0];
  assert.equal(second.lives, 2); // invulnerability absorbed the fire walk
  assert.equal(second.cx, 2);

  clock.advance(BOMB_FUSE_MS - BASE_MOVE_MS * 2); // t=4001: B blows
  match.tick(); // invuln (ended 3501) no longer helps
  const third = insp(match).players[0];
  assert.equal(third.lives, 1);
});

// ---- elimination, winner, draw ------------------------------------------------

test('losing all lives eliminates a player; the last one standing wins', () => {
  const { match, clock, players, ws } = makeMatch({ n: 2 });
  match.debug.damage(players[1].id);
  match.debug.damage(players[1].id);
  match.debug.damage(players[1].id);
  clock.advance(1);
  match.tick();

  const state = insp(match);
  assert.ok(state.ended);
  assert.equal(state.players[1].alive, false);
  assert.equal(lastOf(ws[0], MSG.GAME_OVER).winnerId, players[0].id);
  assert.equal(lastOf(ws[0], MSG.SNAPSHOT).state, 'over');
});

test('elimination is announced to every client (dead players vanish from snapshots)', () => {
  const { match, players, ws } = makeMatch({ n: 2 });

  match.debug.damage(players[1].id);
  match.debug.damage(players[1].id);
  assert.equal(lastOf(ws[0], MSG.ELIMINATED), undefined); // one life left: no event yet

  match.debug.damage(players[1].id);
  for (const w of ws) assert.equal(lastOf(w, MSG.ELIMINATED).id, players[1].id);
});

test('everyone dying in the same blast ends in a draw', () => {
  const { match, clock, players, ws } = makeMatch({ n: 2 });

  match.debug.damage(players[0].id);
  match.debug.damage(players[0].id);
  match.debug.damage(players[1].id);
  match.debug.damage(players[1].id); // both at 1 life
  match.debug.setPos(players[0].id, 1, 1);
  match.debug.setPos(players[1].id, 2, 1);
  match.handlePlaceBomb(players[0].id); // (1,1) range 1 covers both cells
  clock.advance(BOMB_FUSE_MS + 1);
  match.tick();

  const state = insp(match);
  assert.ok(state.ended);
  assert.equal(state.players[0].alive, false);
  assert.equal(state.players[1].alive, false);
  assert.equal(lastOf(ws[0], MSG.GAME_OVER).winnerId, null);
});

test('a full four-player match can be simulated to completion', () => {
  const results = [];
  const { match, clock, players, ws } = makeMatch({ n: 4, onEnd: r => results.push(r) });

  tickThrough(clock, match, 1000);
  for (const id of [players[1].id, players[2].id, players[3].id]) {
    match.debug.damage(id);
    match.debug.damage(id);
    match.debug.damage(id);
    clock.advance(100);
    match.tick();
  }

  assert.equal(results.length, 1); // onEnd fired exactly once
  assert.equal(results[0].winnerId, players[0].id);
  assert.ok(insp(match).ended);
  for (const w of ws) assert.ok(lastOf(w, MSG.GAME_OVER)); // every client got the result
});

// ---- snapshot shape -----------------------------------------------------------

test('snapshots report sub-tile positions while a step is in flight', () => {
  const { match, clock, players, ws } = makeMatch({ n: 1 });

  match.handleInput(players[0].id, { dir: 'right', moving: true });
  clock.advance(BASE_MOVE_MS / 2);
  match.tick(); // t=70: step (1,1)→(2,1) starts
  clock.advance(BASE_MOVE_MS / 2);
  match.tick(); // t=140: halfway between the two cells

  const mid = lastOf(ws[0], MSG.SNAPSHOT).players.find(p => p.id === players[0].id);
  assert.equal(mid.x, 48); // 32 + (64 - 32) * 0.5 — not snapped to the source cell
  assert.equal(mid.y, 32);

  clock.advance(BASE_MOVE_MS / 2);
  match.tick(); // t=210: landed on (2,1)
  const landed = lastOf(ws[0], MSG.SNAPSHOT).players.find(p => p.id === players[0].id);
  assert.equal(landed.x, 64);
});

test('snapshots carry the full entity state and monotonic ticks', () => {
  const map = mkMap(15, 13, { blockAt: [[3, 1]] });
  const { match, clock, players, ws } = makeMatch({ n: 2, map, rng: seq(0, 0) });

  match.applyPowerup(players[0].id, POWERUPS.FLAMES);
  match.handlePlaceBomb(players[0].id);
  clock.advance(500);
  match.tick();

  const snap = lastOf(ws[0], MSG.SNAPSHOT);
  assert.equal(snap.state, 'running');
  assert.equal(snap.players.length, 2);
  const me = snap.players.find(p => p.id === players[0].id);
  assert.equal(me.lives, 3);
  assert.deepEqual(me.powerups, { bombs: 1, flames: 2, speed: 0 });
  assert.equal(typeof me.x, 'number');
  assert.equal(snap.bombs.length, 1);
  assert.equal(snap.bombs[0].ownerId, players[0].id);
  assert.equal(Number.isFinite(snap.bombs[0].fuseAt), true);

  clock.advance(BOMB_FUSE_MS);
  match.tick();
  const snap2 = lastOf(ws[0], MSG.SNAPSHOT);
  assert.ok(snap2.tick > snap.tick);
  assert.ok(snap2.explosions.length > 0);
  assert.ok(snap2.blocksDestroyed.length >= 1);
  assert.ok(snap2.powerups.some(pu => pu.type === POWERUPS.BOMBS));
});
