/**
 * server/room.js — the player roster and the lobby/countdown state machine.
 *
 * One room, one match at a time (matches the audit flow: 2–4 players fill the
 * counter, the countdown starts, the match begins).
 *
 * Countdown rules (as specced):
 *  - a 20s window starts when the first player joins;
 *  - at 20s, with ≥2 players, a 10s ready countdown begins;
 *  - 4 players arriving before 20s start the 10s countdown immediately;
 *  - dropping below 2 players cancels the countdown;
 *  - the countdown reaching 0 fires `onMatchReady` (Phase 4 starts the game).
 *
 * The clock is injectable (`now`) so the whole machine is unit-testable with a
 * fake clock; auto-ticking can be disabled (`tickMs: 0`) for tests too.
 */
import {
  COUNTDOWN_MS,
  LOBBY_WAIT_MS,
  MAX_PLAYERS,
  MIN_PLAYERS_TO_START,
  PLAYER_COLORS,
} from '../shared/constants.js';
import { MSG, pack } from '../shared/protocol.js';

export const ROOM_STATE = Object.freeze({
  WAITING: 'waiting',
  COUNTDOWN: 'countdown',
  PLAYING: 'playing',
});

export const JOIN_ERROR = Object.freeze({
  BAD_NICKNAME: 'badNickname',
  NICKNAME_TAKEN: 'nicknameTaken',
  ROOM_FULL: 'roomFull',
  GAME_IN_PROGRESS: 'gameInProgress',
});

const NICKNAME_MAX = 16;
const CHAT_MAX = 200;
const OPEN = 1; // ws.readyState for an open connection

/**
 * @param {object} [options]
 * @param {() => number} [options.now] - clock, injectable for tests
 * @param {number} [options.tickMs] - auto-tick interval in ms; 0 disables it
 * @param {((roster: Array<{id: number, nickname: string, slot: number, color: string, ws: object}>) => void)|null} [options.onMatchReady]
 *   called with the full roster when the countdown reaches 0; when null the
 *   room resets to waiting
 */
export function createRoom({ now = Date.now, tickMs = 100, onMatchReady = null } = {}) {
  /** @type {Map<number, {id: number, nickname: string, slot: number, color: string, ws: object}>} */
  const players = new Map();
  let nextId = 1;
  let state = ROOM_STATE.WAITING;
  let lobbyOpenedAt = 0; // 0 until the first player of the current cycle joins
  let countdownUntil = 0;
  let timer = null;
  let lastLobby = ''; // JSON of the last broadcast, to dedupe identical frames

  function send(ws, msg) {
    if (ws.readyState !== OPEN) return;
    ws.send(pack(msg.type, msg));
  }

  function playerList() {
    return [...players.values()].map(p => ({ id: p.id, nickname: p.nickname, slot: p.slot }));
  }

  /** Full roster entries (incl. ws and color) — handed to the match at start. */
  function getRoster() {
    return [...players.values()];
  }

  function lobbyMsg() {
    const countdown =
      state === ROOM_STATE.COUNTDOWN
        ? Math.max(0, Math.ceil((countdownUntil - now()) / 1000))
        : null;
    return { type: MSG.LOBBY, players: playerList(), state, countdown };
  }

  function broadcastLobby() {
    const msg = lobbyMsg();
    const key = JSON.stringify(msg);
    if (key === lastLobby) return; // don't spam identical frames (chat/join visibility)
    lastLobby = key;
    for (const p of players.values()) send(p.ws, msg);
  }

  function firstFreeSlot() {
    const taken = new Set([...players.values()].map(p => p.slot));
    for (let i = 0; i < MAX_PLAYERS; i++) {
      if (!taken.has(i)) return i;
    }
    return -1;
  }

  function startTimer() {
    if (timer || tickMs <= 0) return;
    timer = setInterval(tick, tickMs);
  }

  function stopTimer() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function beginCountdown(t) {
    state = ROOM_STATE.COUNTDOWN;
    countdownUntil = t + COUNTDOWN_MS;
  }

  function cancelCountdown() {
    state = ROOM_STATE.WAITING;
    countdownUntil = 0;
    lobbyOpenedAt = now(); // fresh 20s window — prevents an instant re-countdown
  }

  function resetToWaiting() {
    state = ROOM_STATE.WAITING;
    countdownUntil = 0;
    lobbyOpenedAt = now();
  }

  function finishCountdown() {
    state = ROOM_STATE.PLAYING;
    lastLobby = ''; // state changed: force a fresh payload
    broadcastLobby();
    if (onMatchReady) {
      onMatchReady(getRoster());
    } else {
      resetToWaiting();
      broadcastLobby();
    }
  }

  function handleJoin(ws, rawNickname) {
    const nickname = String(rawNickname ?? '').trim();
    if (!nickname || nickname.length > NICKNAME_MAX) {
      send(ws, {
        type: MSG.ERROR,
        code: JOIN_ERROR.BAD_NICKNAME,
        message: `Nickname must be 1-${NICKNAME_MAX} characters.`,
      });
      return;
    }
    if (players.size >= MAX_PLAYERS) {
      send(ws, {
        type: MSG.ERROR,
        code: JOIN_ERROR.ROOM_FULL,
        message: 'This room is already full.',
      });
      return;
    }
    if (state === ROOM_STATE.PLAYING) {
      send(ws, {
        type: MSG.ERROR,
        code: JOIN_ERROR.GAME_IN_PROGRESS,
        message: 'A match is in progress, try again in a moment.',
      });
      return;
    }
    const lower = nickname.toLowerCase();
    const taken = [...players.values()].some(p => p.nickname.toLowerCase() === lower);
    if (taken) {
      send(ws, {
        type: MSG.ERROR,
        code: JOIN_ERROR.NICKNAME_TAKEN,
        message: 'That nickname is already taken.',
      });
      return;
    }

    const wasEmpty = players.size === 0;
    const slot = firstFreeSlot();
    const player = { id: nextId++, nickname, slot, color: PLAYER_COLORS[slot], ws };
    players.set(player.id, player);

    if (wasEmpty) {
      lobbyOpenedAt = now();
      startTimer();
    }

    send(ws, {
      type: MSG.WELCOME,
      id: player.id,
      nickname: player.nickname,
      color: player.color,
      slot: player.slot,
    });
    broadcastLobby();
  }

  function handleChat(ws, rawText) {
    const player = [...players.values()].find(p => p.ws === ws);
    if (!player) return;
    const text = String(rawText ?? '').trim();
    if (!text || text.length > CHAT_MAX) return;
    const msg = { type: MSG.CHAT_MSG, from: player.nickname, text, ts: now() };
    for (const p of players.values()) send(p.ws, msg);
  }

  function handleLeave(ws) {
    const player = [...players.values()].find(p => p.ws === ws);
    if (!player) return;
    players.delete(player.id);
    lastLobby = '';

    if (players.size === 0) {
      stopTimer();
      state = ROOM_STATE.WAITING;
      lobbyOpenedAt = 0;
      countdownUntil = 0;
    } else if (state === ROOM_STATE.COUNTDOWN && players.size < MIN_PLAYERS_TO_START) {
      cancelCountdown();
    }
    broadcastLobby();
  }

  /** Drives the countdown state machine. Called by the auto-timer or by tests. */
  function tick() {
    const t = now();

    if (state === ROOM_STATE.WAITING && players.size > 0) {
      const full = players.size >= MAX_PLAYERS;
      const waitedEnough =
        players.size >= MIN_PLAYERS_TO_START && t - lobbyOpenedAt >= LOBBY_WAIT_MS;
      if (full || waitedEnough) beginCountdown(t);
    } else if (state === ROOM_STATE.COUNTDOWN && t >= countdownUntil) {
      finishCountdown();
      return;
    }

    broadcastLobby();
  }

  /** Returns the room to the waiting lobby (used by the Phase 2 placeholder). */
  function reset() {
    resetToWaiting();
    lastLobby = '';
    broadcastLobby();
  }

  function destroy() {
    stopTimer();
    players.clear();
  }

  return {
    handleJoin,
    handleChat,
    handleLeave,
    tick,
    reset,
    destroy,
    broadcastLobby,
    getState: () => state,
    getPlayers: playerList,
    getRoster,
    playerCount: () => players.size,
  };
}
