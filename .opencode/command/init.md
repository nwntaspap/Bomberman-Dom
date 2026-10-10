---
description: Write/refresh the repo's PLAN.md and AGENTS.md
---

Initialize this repository's planning documents in English. Create (or refresh,
verbatim) the two files below at the repository root, exactly as written.

## 1. `PLAN.md`

```markdown
# Bomberman-Dom — Implementation Plan

> Multiplayer Bomberman (2–4 players) built with the custom mini-framework
> (vendored in `framework/`), pure DOM (no canvas/WebGL), and a WebSocket
> authoritative server. This document is the single source of truth for scope,
> architecture, phases, and verification.

## 1. Goal & hard constraints

Goal: a working base implementation that passes every Functional audit question
(bonus features are out of scope for now).

Hard constraints:

- The mini-framework is the only front-end technology. No canvas, no WebGL, no
  React/Vue/Angular/any other front-end library.
- ≥ 60fps at all times, no frame drops, proper requestAnimationFrame, and
  performance must be measurable.
- WebSockets for the multiplayer chat and synchronization.
- Paint as little as possible, use as few layers as possible, promote layers
  properly (DevTools Performance / Rendering checks).

## 2. Locked decisions

| Decision              | Choice                                                  |
| --------------------- | ------------------------------------------------------- |
| WebSocket server      | `ws` npm package (backend only)                         |
| Framework integration | Vendor copy of `framework/` inside the repo, unmodified |
| Netcode model         | Authoritative server + client interpolation             |
| Test runner           | Built-in `node:test` (no extra dependency)              |
| Typecheck             | None (plain JS) — rely on ESLint + Prettier             |
| Front-end build step  | None (native ES modules)                                |

Still to lock (via /architect before Phase 4): simulation rate, snapshot
broadcast rate, interpolation/extrapolation strategy.

## 3. The critical architecture decision — dual rendering

The framework re-runs the entire `view(state)` and diffs the DOM on every
`setState()`. Correct for UI, fatal for a game loop. Rule: two rendering layers,
never mixed.

| Layer                                                       | Technology                                                                                                               | Updated when                      |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| Screens / flow (nickname, waiting room, chat UI, game over) | mini-framework (`createApp` + `createRouter` + `setState`)                                                               | Only on real screen/state changes |
| Game board (players, bombs, flames, blocks, powerups, HUD)  | one `requestAnimationFrame` loop + direct DOM mutation (`transform: translate3d`, class toggles), cached node references | Every frame                       |

Never route per-frame game state through `setState`.

## 4. Network architecture

- Authoritative server (Node.js): owns the game state, fixed-timestep
  simulation, consumes inputs, broadcasts snapshots. Clients interpolate.
- The same Node process serves static files and the WebSocket upgrade on one
  port (no CORS, no second process).
- "Only the mini-framework" applies to the client; the Node/`ws` backend is
  required by the subject (WebSockets) and allowed.

### Message protocol (draft)

Client → Server: `join{nickname}`, `chat{text}`, `input{dir}`, `placeBomb`.
Server → Client: `welcome{id,color,slot}`, `lobby{players,countdown}`,
`chat{from,text,ts}`, `gameStart{map,you,players}`, `snapshot{...}`,
`lifeLost{id}`, `eliminated{id}`, `gameOver{winner}`, `error{code}`.

## 5. Game rules

- Players: 2–4, each 3 lives; at 0 you are out and can no longer play.
- Map: fixed size, whole map visible. Walls (indestructible, always the same:
  border + fixed pillars) and Blocks (destructible, random each match). Spawn
  corners cleared so a player can always dodge their own bomb.
- Powerups (random chance when a block is destroyed; ≥3 types):
  Bombs (+1 max bombs), Flames (+1 range), Speed (+1 movement speed).
- Bombs: limited by max bombs; timer; cross explosion limited by range, stopped
  by walls; destroys blocks; chain reactions; damages players in range.
- Life loss: caught in an explosion → lose 1 life, respawn at corner with short
  invulnerability, unless 0 lives → eliminated.
- Win: last standing; game over screen shows the winner.

### Lobby / countdown state machine

- Waiting page: player counter ending at 4, increments on join.
- 20s clock starts when the first player enters the room.
- At 20s, ≥2 players → 10s ready countdown.
- 4 players before 20s → 10s countdown immediately.
- Countdown cancelled if count drops below 2.
- Countdown at 0 → match starts. (Audit: 2 users + 20s → countdown.)

## 6. Folder structure
```

Bomberman-Dom/
├── package.json scripts: start, dev, lint, format, format:check, test
├── eslint.config.mjs (same as mini-framework; framework/ ignored)
├── .prettierrc .prettierignore .gitignore README.md PLAN.md AGENTS.md
├── .opencode/command/init.md custom command that (re)generates PLAN.md+AGENTS.md
├── framework/ vendor copy of the mini-framework (UNMODIFIED)
├── shared/ pure client+server code (ESM, no DOM)
│ ├── constants.js grid, tick, lives, timings, tile types, colors
│ ├── map.js deterministic map generator (seeded)
│ └── protocol.js message constants + encode/decode helpers
├── client/
│ ├── index.html css/{base,screens,game}.css
│ ├── app.js createApp + router + view (screen switching)
│ ├── screens/ nickname.js, waiting.js, game.js, gameover.js
│ ├── chat.js
│ ├── net/socket.js WS wrapper, message dispatch, reconnect
│ └── game/
│ ├── engine.js single rAF loop (delta-time)
│ ├── renderer.js board built once + entity transforms
│ ├── input.js keys → inputs (throttled)
│ └── hud.js lives/powerups/FPS overlay
├── server/
│ ├── index.js http static + ws upgrade
│ ├── static.js minimal static server (mime, path safety)
│ ├── net.js ws connections
│ ├── room.js lobby + countdown state machine
│ └── game.js authoritative simulation + entities
└── tests/ node:test: map, collisions, room countdown

```

## 7. Phases

Phase 0 — Bootstrap/config: package.json (ESM + ws), prettier/eslint configs,
gitignore, README, PLAN.md, AGENTS.md, /init command, minimal static server,
vendored framework. Accept: lint + format:check + `npm start` serve the shell.

Phase 1 — Shared foundation: constants, map generator, protocol. node:test for
the map. Accept: tests green, valid symmetric spawns.

Phase 2 — Server: static + WS + lobby: WS upgrade, room model (id/color/slot,
nickname, player list broadcast, chat relay), countdown state machine.
Accept: two tabs, counter increments, real-time chat, countdown correct.

Phase 3 — Client shell (framework): index.html, CSS, createApp/createRouter,
screens nickname → waiting → game (placeholder) → game over.
Accept: audit bullets up to chat + both countdown paths.

Phase 4 — Authoritative simulation (server): grid, players, bombs, explosions,
powerups, collision, pickups, life loss, respawn, elimination, win, snapshots.
Prereq: /architect on sim/broadcast rates + interpolation.
Accept: unit tests green; headless match completes.

Phase 5 — Client rendering & input: board built once, entity sprites,
interpolated render, node reuse/pooling, block removal, powerups, HUD + FPS
overlay, keyboard input → server. Accept: move/bomb/hit/blocks/powerups/lives.

Phase 6 — Flow integration & match end: server-driven transitions, client
screen switching, winner/elimination, chat in-game.
Accept: full Functional audit list, 2 and 4 players.

Phase 7 — Performance & audit pass: single rAF loop, no forced reflow, batched
DOM writes, transform-only animation, will-change only on moving sprites.
Profile with Chrome DevTools. Accept: ≥60fps, no drops, minimal paint/layers.

Phase 8 — Polish, docs, delivery: README, clean lint/format, multiplayer test
script, logical commits, push. Accept: runs from clean clone.

## 8. Audit question → phase

| Audit question | Covered in |
| --- | --- |
| Mini-framework only (no canvas/WebGL) | Architecture §3 |
| Nickname requested | Phase 3 |
| Waiting page + counter | Phase 2/3 |
| Chat on join | Phase 2/3 |
| Second user → counter +1 | Phase 2 |
| Real-time chat via WebSockets | Phase 2 |
| 20s → 10s countdown (2 users) | Phase 2/3 |
| 4 users → immediate 10s countdown | Phase 2/3 |
| Move + place bombs | Phase 4/5 |
| Whole map visible | Phase 3/5 |
| Own explosion → lose 1 of 3 lives | Phase 4/5 |
| Lose all 3 lives → out | Phase 4/6 |
| Bomb next to player → life lost | Phase 4/5 |
| Bomb next to block → block disappears | Phase 4/5 |
| Destroy all blocks → powerups appear | Phase 4/5 |
| ≥3 powerup types | Phase 4/5 |
| No frame drops | Phase 7 |
| ~60fps | Phase 7 |
| Paint as little as possible | Phase 5/7 |
| Layers few + promoted properly | Phase 5/7 |

## 9. Verification

`npm run lint`, `npm run format:check`, `node --test`, `npm start` + manual
multi-tab (2–4) testing with Chrome DevTools Performance. No typecheck.

## 10. Risks

1. Game loop in setState → frame drops (§3 rule mitigates).
2. Index-based diffing: keep lists stable-ordered or manage imperatively.
3. Interpolation complexity → fallback: higher sim rate.
4. Countdown edge cases: leave/rejoin, single player, full room.
5. Layer hygiene: promote only moving entities.
```

## 2. `AGENTS.md`

```markdown
# Bomberman-Dom — project rules

This file is for agents working in this repository. The global protocol in
`~/.config/opencode/AGENTS.md` still applies; this file adds project specifics.

## Stack (locked)

- **Client:** the vendored mini-framework (`framework/`). It is **unmodified
  vendored code — never edit it**. Import only from `../framework/index.js`.
- **No canvas, no WebGL, no other front-end frameworks/libraries.**
- **Server:** Node.js (ESM) + `ws` (the only runtime dependency). No Express,
  no Socket.IO, no build step.
- **Tests:** built-in `node:test` (no extra dependency).

## Scripts

| Command                                   | Purpose                                                    |
| ----------------------------------------- | ---------------------------------------------------------- |
| `npm start`                               | run the server (static + WebSocket), http://localhost:3001 |
| `npm dev`                                 | run with `node --watch`                                    |
| `npm test`                                | `node --test`                                              |
| `npm run lint` / `npm run lint:fix`       | ESLint                                                     |
| `npm run format` / `npm run format:check` | Prettier                                                   |

## Architecture rule (critical)

**Dual rendering — never mix the two layers:**

1. **Screens/flow** (nickname, waiting room, chat UI, game-over): the
   mini-framework (`createApp` → `setState` → view → patch). Update only on real
   screen/state changes.
2. **Game board** (players, bombs, flames, blocks, powerups, HUD): **one**
   `requestAnimationFrame` loop that mutates the DOM directly — positions via
   `transform: translate3d`, presence via class toggles — with cached node
   references and node reuse.

**Never** route per-frame game state through `setState` (full VNode rebuild
every frame = GC pressure + paint + dropped frames).

Netcode: **authoritative server** — server owns the simulation, clients send
inputs (`input{dir}`, `placeBomb`) and interpolate snapshots for smooth 60fps.

## Conventions

- ESM everywhere (`"type": "module"`), code in English, match the existing style
  (Prettier: `singleQuote`, `arrowParens: avoid`, `printWidth: 100`).
- `shared/` = pure logic (no DOM, no Node-only APIs) usable from both client and
  server; keep protocol message shapes in `shared/protocol.js`.
- Path safety in the static server: allow-list `client` + `framework`, SPA
  fallback to `client/index.html` for History-API routes.
- Performance: no forced reflow, batched DOM writes, `will-change` only on
  moving sprites.

## Process

- **No commits unless the user says so** — the user decides when to commit to
  the remote. Report changes and ask on architecture decisions.
- No new dependencies without asking.
- Verify before reporting finished: `npm run lint`, `npm run format:check`,
  `node --test`, and a manual browser pass where applicable.

## Docs

- `PLAN.md` — the full implementation plan (single source of truth for scope).
- Regenerate both `PLAN.md` and this file with the `/init` command.
```

Do not touch any other files. Report a short summary of what was (re)written.
