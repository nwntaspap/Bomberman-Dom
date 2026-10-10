/**
 * tests/map.test.js — unit tests for the shared map generator.
 * Run with: node --test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TILES } from '../shared/constants.js';
import {
  countBlocks,
  createRng,
  generateMap,
  isBorder,
  isPillar,
  isWalkable,
  tileAt,
} from '../shared/map.js';

const { EMPTY, WALL, BLOCK } = TILES;

test('default map has the configured dimensions', () => {
  const map = generateMap();
  assert.equal(map.cols, 15);
  assert.equal(map.rows, 13);
  assert.equal(map.tiles.length, 15 * 13);
});

test('the border ring is all walls', () => {
  const map = generateMap();
  for (let y = 0; y < map.rows; y++) {
    for (let x = 0; x < map.cols; x++) {
      if (isBorder(x, y, map.cols, map.rows)) {
        assert.equal(tileAt(map, x, y), WALL, `border cell (${x},${y}) should be a wall`);
      }
    }
  }
});

test('interior even/even cells are indestructible pillars', () => {
  const map = generateMap();
  for (let y = 2; y < map.rows - 1; y++) {
    for (let x = 2; x < map.cols - 1; x++) {
      if (isPillar(x, y)) {
        assert.equal(tileAt(map, x, y), WALL, `pillar cell (${x},${y}) should be a wall`);
      }
    }
  }
});

test('each spawn corner and its escape cells are clear', () => {
  const map = generateMap();
  for (const s of map.spawns) {
    const dx = s.x === 1 ? 1 : -1;
    const dy = s.y === 1 ? 1 : -1;
    for (const cell of [
      { x: s.x, y: s.y },
      { x: s.x + dx, y: s.y },
      { x: s.x, y: s.y + dy },
    ]) {
      assert.equal(
        tileAt(map, cell.x, cell.y),
        EMPTY,
        `spawn escape cell (${cell.x},${cell.y}) should be empty`
      );
    }
  }
});

test('spawns are placed in the four corners', () => {
  const map = generateMap();
  const expected = [
    { x: 1, y: 1 },
    { x: 13, y: 1 },
    { x: 1, y: 11 },
    { x: 13, y: 11 },
  ];
  assert.deepEqual(map.spawns, expected);
});

test('blocks only appear on legal cells (not border, not pillar, not spawn zone)', () => {
  const map = generateMap();
  const escapeCells = new Set();
  for (const s of map.spawns) {
    const dx = s.x === 1 ? 1 : -1;
    const dy = s.y === 1 ? 1 : -1;
    for (const cell of [
      { x: s.x, y: s.y },
      { x: s.x + dx, y: s.y },
      { x: s.x, y: s.y + dy },
    ]) {
      escapeCells.add(`${cell.x},${cell.y}`);
    }
  }

  for (let y = 0; y < map.rows; y++) {
    for (let x = 0; x < map.cols; x++) {
      if (tileAt(map, x, y) !== BLOCK) continue;
      assert.equal(isBorder(x, y, map.cols, map.rows), false, `block on border (${x},${y})`);
      assert.equal(isPillar(x, y), false, `block on pillar (${x},${y})`);
      assert.equal(escapeCells.has(`${x},${y}`), false, `block inside spawn zone (${x},${y})`);
    }
  }
});

test('the same seed always produces the same map', () => {
  const a = generateMap({ seed: 42 });
  const b = generateMap({ seed: 42 });
  assert.deepEqual(a.tiles, b.tiles);
  assert.deepEqual(a.spawns, b.spawns);
});

test('different seeds produce different maps', () => {
  const a = generateMap({ seed: 1 });
  const b = generateMap({ seed: 2 });
  assert.notDeepEqual(a.tiles, b.tiles);
});

test('the map has a reasonable number of destructible blocks', () => {
  const map = generateMap();
  const count = countBlocks(map);
  assert.ok(count > 0, `expected some blocks, got ${count}`);
  assert.ok(count < map.tiles.length / 2, `too many blocks: ${count}`);
});

test('isWalkable respects walls, blocks, empty cells and bounds', () => {
  const map = generateMap();
  assert.equal(isWalkable(map, 0, 0), false); // border wall
  assert.equal(isWalkable(map, 2, 2), false); // pillar
  assert.equal(isWalkable(map, -1, 0), false); // out of bounds
  assert.equal(isWalkable(map, 0, -1), false);
  assert.equal(isWalkable(map, map.cols, 0), false);
  assert.equal(isWalkable(map, 0, map.rows), false);
  assert.equal(isWalkable(map, 1, 1), true); // spawn corner is empty
});

test('createRng is deterministic and bounded', () => {
  const a = createRng(7);
  const b = createRng(7);
  const sequenceA = [a(), a(), a()];
  const sequenceB = [b(), b(), b()];
  assert.deepEqual(sequenceA, sequenceB);
  for (const v of sequenceA) {
    assert.ok(v >= 0 && v < 1, `rng out of range: ${v}`);
  }
});

test('custom map dimensions produce valid spawns', () => {
  const map = generateMap({ cols: 11, rows: 9, seed: 5 });
  assert.equal(map.cols, 11);
  assert.equal(map.rows, 9);
  assert.deepEqual(map.spawns, [
    { x: 1, y: 1 },
    { x: 9, y: 1 },
    { x: 1, y: 7 },
    { x: 9, y: 7 },
  ]);
});
