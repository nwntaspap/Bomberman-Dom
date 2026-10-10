/**
 * tests/room.test.js — lobby/countdown state machine tests.
 * Run with: node --test
 *
 * The room's clock and auto-tick are injectable, so these tests drive the
 * machine manually with a fake clock and record frames with fake sockets.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COUNTDOWN_MS, LOBBY_WAIT_MS, MAX_PLAYERS, PLAYER_COLORS } from '../shared/constants.js';
import { MSG } from '../shared/protocol.js';
import { createRoom, JOIN_ERROR, ROOM_STATE } from '../server/room.js';

/** In-memory fake WebSocket that records everything it "sends". */
function fakeWs() {
  return {
    readyState: 1,
    sent: [],
    send(message) {
      this.sent.push(message);
    },
  };
}

function fakeClock(start = 0) {
  let t = start;
  return { now: () => t, advance: ms => (t += ms) };
}

/** Decodes the last frame of a given type sent to a socket. */
function lastOf(ws, type) {
  return ws.sent
    .map(JSON.parse)
    .slice()
    .reverse()
    .find(m => m.type === type);
}

function countOf(ws, type) {
  return ws.sent.map(JSON.parse).filter(m => m.type === type).length;
}

/** Two players in a fresh room at t=0. Returns { room, clock, wsA, wsB }. */
function roomWithTwoPlayers({ onMatchReady = null } = {}) {
  const clock = fakeClock();
  const room = createRoom({ now: clock.now, tickMs: 0, onMatchReady });
  const wsA = fakeWs();
  const wsB = fakeWs();
  room.handleJoin(wsA, 'alice');
  room.handleJoin(wsB, 'bob');
  return { room, clock, wsA, wsB };
}

test('joining with a valid nickname sends welcome + lobby with one player', () => {
  const room = createRoom({ tickMs: 0 });
  const ws = fakeWs();
  room.handleJoin(ws, 'alice');

  const welcome = lastOf(ws, MSG.WELCOME);
  assert.equal(welcome.nickname, 'alice');
  assert.equal(welcome.slot, 0);
  assert.equal(welcome.color, PLAYER_COLORS[0]);

  const lobby = lastOf(ws, MSG.LOBBY);
  assert.equal(lobby.players.length, 1);
  assert.equal(lobby.players[0].nickname, 'alice');
  assert.equal(lobby.countdown, null);
});

test('a second join increments the counter seen by everyone', () => {
  const { wsA, wsB } = roomWithTwoPlayers();
  assert.equal(lastOf(wsA, MSG.LOBBY).players.length, 2);
  assert.equal(lastOf(wsB, MSG.LOBBY).players.length, 2);
});

test('slots and colors are unique and follow join order', () => {
  const { wsA, wsB } = roomWithTwoPlayers();
  const a = lastOf(wsA, MSG.WELCOME);
  const b = lastOf(wsB, MSG.WELCOME);
  assert.equal(a.slot, 0);
  assert.equal(b.slot, 1);
  assert.equal(a.color, PLAYER_COLORS[0]);
  assert.equal(b.color, PLAYER_COLORS[1]);
});

test('empty or too-long nicknames are rejected', () => {
  const room = createRoom({ tickMs: 0 });
  const ws = fakeWs();
  room.handleJoin(ws, '   ');
  assert.equal(lastOf(ws, MSG.ERROR).code, JOIN_ERROR.BAD_NICKNAME);
  room.handleJoin(ws, 'x'.repeat(17));
  assert.equal(lastOf(ws, MSG.ERROR).code, JOIN_ERROR.BAD_NICKNAME);
});

test('duplicate nicknames are rejected (case-insensitive)', () => {
  const room = createRoom({ tickMs: 0 });
  const wsA = fakeWs();
  const wsB = fakeWs();
  room.handleJoin(wsA, 'alice');
  room.handleJoin(wsB, 'Alice');
  assert.equal(lastOf(wsB, MSG.ERROR).code, JOIN_ERROR.NICKNAME_TAKEN);
});

test('a fifth player is rejected with roomFull', () => {
  const clock = fakeClock();
  const room = createRoom({ now: clock.now, tickMs: 0 });
  const sockets = [];
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const ws = fakeWs();
    sockets.push(ws);
    room.handleJoin(ws, `player${i}`);
  }
  const extra = fakeWs();
  room.handleJoin(extra, 'extra');
  assert.equal(lastOf(extra, MSG.ERROR).code, JOIN_ERROR.ROOM_FULL);
});

test('chat is relayed to every player with the sender nickname', () => {
  const { room, wsA, wsB } = roomWithTwoPlayers();
  wsB.sent.length = 0; // ignore lobby chatter, keep only the chat frame
  room.handleChat(wsA, '  hello there  ');

  const chatA = lastOf(wsA, MSG.CHAT_MSG);
  const chatB = lastOf(wsB, MSG.CHAT_MSG);
  assert.equal(chatA.from, 'alice');
  assert.equal(chatA.text, 'hello there');
  assert.deepEqual(chatB, chatA);
});

test('empty/oversized chat is dropped', () => {
  const { room, wsA, wsB } = roomWithTwoPlayers();
  room.handleChat(wsA, '   ');
  room.handleChat(wsA, 'y'.repeat(201));
  assert.equal(countOf(wsB, MSG.CHAT_MSG), 0);
});

test('two players + 20s elapsed → the 10s countdown starts', () => {
  const { room, clock, wsA } = roomWithTwoPlayers();
  clock.advance(LOBBY_WAIT_MS + 1);
  room.tick();

  assert.equal(room.getState(), ROOM_STATE.COUNTDOWN);
  assert.equal(lastOf(wsA, MSG.LOBBY).countdown, Math.ceil(COUNTDOWN_MS / 1000));
});

test('a single player after 20s does NOT start a countdown', () => {
  const clock = fakeClock();
  const room = createRoom({ now: clock.now, tickMs: 0 });
  room.handleJoin(fakeWs(), 'solo');
  clock.advance(LOBBY_WAIT_MS * 2);
  room.tick();
  assert.equal(room.getState(), ROOM_STATE.WAITING);
});

test('four players start the countdown immediately (before the 20s window)', () => {
  const clock = fakeClock();
  const room = createRoom({ now: clock.now, tickMs: 0 });
  for (let i = 0; i < MAX_PLAYERS; i++) room.handleJoin(fakeWs(), `p${i}`);
  room.tick();
  assert.equal(room.getState(), ROOM_STATE.COUNTDOWN);
});

test('the countdown counts down and fires onMatchReady at zero', () => {
  const readyCalls = [];
  const { room, clock } = roomWithTwoPlayers({ onMatchReady: players => readyCalls.push(players) });

  clock.advance(LOBBY_WAIT_MS + 1);
  room.tick();
  assert.equal(room.getState(), ROOM_STATE.COUNTDOWN);

  clock.advance(COUNTDOWN_MS / 2);
  room.tick();
  assert.equal(readyCalls.length, 0); // half-way: not ready yet

  clock.advance(COUNTDOWN_MS / 2 + 1);
  room.tick();
  assert.equal(readyCalls.length, 1);
  assert.equal(readyCalls[0].length, 2);
  assert.equal(room.getState(), ROOM_STATE.PLAYING);
});

test('without onMatchReady the room resets to waiting after the countdown', () => {
  const { room, clock, wsA } = roomWithTwoPlayers();
  clock.advance(LOBBY_WAIT_MS + 1);
  room.tick();
  clock.advance(COUNTDOWN_MS + 1);
  room.tick();

  assert.equal(room.getState(), ROOM_STATE.WAITING);
  assert.equal(lastOf(wsA, MSG.LOBBY).countdown, null);
});

test('leaving during the countdown below 2 players cancels it', () => {
  const { room, clock, wsA, wsB } = roomWithTwoPlayers();
  clock.advance(LOBBY_WAIT_MS + 1);
  room.tick();
  assert.equal(room.getState(), ROOM_STATE.COUNTDOWN);

  room.handleLeave(wsB);
  assert.equal(room.getState(), ROOM_STATE.WAITING);
  const lobby = lastOf(wsA, MSG.LOBBY);
  assert.equal(lobby.players.length, 1);
  assert.equal(lobby.countdown, null);
});

test('joining while a match is playing is rejected', () => {
  const readyCalls = [];
  const { room, clock } = roomWithTwoPlayers({
    onMatchReady: players => readyCalls.push(players),
  });
  clock.advance(LOBBY_WAIT_MS + 1);
  room.tick();
  clock.advance(COUNTDOWN_MS + 1);
  room.tick();
  assert.equal(room.getState(), ROOM_STATE.PLAYING);

  const late = fakeWs();
  room.handleJoin(late, 'late');
  assert.equal(lastOf(late, MSG.ERROR).code, JOIN_ERROR.GAME_IN_PROGRESS);
});

test('a freed slot is reused by the next player', () => {
  const { room, wsA } = roomWithTwoPlayers();
  room.handleLeave(wsA);
  const wsC = fakeWs();
  room.handleJoin(wsC, 'carol');
  assert.equal(lastOf(wsC, MSG.WELCOME).slot, 0);
});

test('repeated ticks within one second do not spam identical lobby frames', () => {
  const { room, clock, wsA } = roomWithTwoPlayers();
  clock.advance(LOBBY_WAIT_MS + 1);
  room.tick(); // starts the countdown, broadcasts it

  const framesBefore = countOf(wsA, MSG.LOBBY);
  for (let i = 0; i < 10; i++) room.tick(); // same instant, 10 ticks
  assert.equal(countOf(wsA, MSG.LOBBY), framesBefore);
});
