# Bomberman-Dom — Implementation Plan

> Multiplayer Bomberman (2–4 players) built with the custom mini-framework
> (vendored in `framework/`), pure DOM (no canvas/WebGL), and a WebSocket
> authoritative server. This document is the single source of truth for scope,
> architecture, phases, and verification.

---

## 1. Goal & hard constraints

**Goal:** a working base implementation that passes every Functional audit
question (bonus features are explicitly out of scope for now).

**Hard constraints (from the subject + audit):**

- The **mini-framework is the only front-end technology**. No canvas, no WebGL,
  no React/Vue/Angular/any other front-end library.
- The game must run at **≥ 60fps at all times**, with **no frame drops**, using
  **proper `requestAnimationFrame`**, and performance must be **measurable**.
- **WebSockets** for the multiplayer chat and synchronization.
- **Paint as little as possible**, use **as few layers as possible**, and
  **promote layers properly** (DevTools Performance / Rendering checks).

## 2. Locked decisions

| Decision              | Choice                                                  |
| --------------------- | ------------------------------------------------------- |
| WebSocket server      | `ws` npm package (backend only)                         |
| Framework integration | Vendor copy of `framework/` inside the repo, unmodified |
| Netcode model         | Authoritative server + client interpolation             |
| Test runner           | Built-in `node:test` (no extra dependency)              |
| Typecheck             | None (plain JS) — rely on ESLint + Prettier             |
| Front-end build step  | None (native ES modules, like the framework)            |

**Still to lock (via `/architect` before Phase 4):** exact simulation rate,
snapshot broadcast rate, and interpolation/extrapolation strategy.

## 3. The critical architecture decision — dual rendering

The framework deliberately re-runs the **entire** `view(state)` and diffs the DOM
on every `setState()`. That is correct for UI, but fatal for a game loop
(60 renders/sec × full VNode tree = GC pressure, layout, paint, dropped frames).

**Rule:** two rendering layers, never mixed.

| Layer                                                       | Technology                                                                                                                    | Updated when                      |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Screens / flow (nickname, waiting room, chat UI, game over) | mini-framework (`createApp` + `createRouter` + `setState`)                                                                    | Only on real screen/state changes |
| Game board (players, bombs, flames, blocks, powerups, HUD)  | one `requestAnimationFrame` loop + direct DOM mutation (`transform: translate3d`, class toggles) using cached node references | Every frame                       |

The framework builds the game screen **structure once**; the rAF loop then moves
entities with `transform` (compositor-only → almost zero paint, correct layer
promotion). This is what satisfies "60fps" + "little paint" + "few, well-promoted
layers" simultaneously.

**Never** route per-frame game state through `setState`.

## 4. Network architecture

- **Authoritative server (Node.js):** owns the game state, runs a fixed-timestep
  simulation, consumes player inputs (move direction, place bomb), and broadcasts
  snapshots. Clients send inputs and **interpolate** snapshots for smooth 60fps.
- The **same** Node process serves the static client files and handles the
  WebSocket upgrade on one port (no CORS, no second process).
- Front-end rule note: "only the mini-framework" applies to the **client**. A
  Node backend with `ws` is required by the subject (WebSockets) and allowed.

### Message protocol (draft)

Client → Server: `join{nickname}`, `chat{text}`, `input{dir}`, `placeBomb`.
Server → Client: `welcome{id,color,slot}`, `lobby{players,countdown}`,
`chat{from,text,ts}`, `gameStart{map,you,players}`, `snapshot{...}`,
`lifeLost{id}`, `eliminated{id}`, `gameOver{winner}`, `error{code}`.

## 5. Game rules to implement

- **Players:** 2–4. Each has **3 lives**; at 0 you are out and can no longer play.
- **Map:** fixed size, whole map always visible. Two tile types:
  - **Walls** (indestructible) always in the same place (border + fixed pillar grid).
  - **Blocks** (destructible) generated randomly each match.
  - Spawn corners are cleared so a player can always dodge their own bomb.
  - Players start in the four corners.
- **Powerups** (spawn chance when a block is destroyed; ≥3 types required):
  - **Bombs:** +1 max bombs at a time.
  - **Flames:** +1 explosion range in all four directions.
  - **Speed:** +1 movement speed.
- **Bombs:** limited by player's max-bomb count; timer; cross-shaped explosion
  limited by flames range, stopped by walls; destroys blocks; chain reactions;
  damages players in range.
- **Life loss:** caught in own or another player's explosion → lose 1 life,
  respawn at corner (with short invulnerability) unless lives reach 0 → eliminated.
- **Win:** last standing. Game over screen shows the winner.

### Lobby / countdown state machine

- Waiting page shows a player counter ending at **4**; increments on join.
- **20s** clock starts when the first player enters the room.
- At 20s, if **≥2 players** → start a **10s** ready countdown.
- If **4 players** arrive **before** 20s → start the **10s** countdown immediately.
- Countdown is cancelled if the count drops below 2.
- When the countdown reaches 0 → the match starts.
- (The audit resolves the "more than 2" ambiguity: **2 users + 20s → countdown**.)

## 6. Folder structure

```
Bomberman-Dom/
├── package.json            scripts: start, dev, lint, format, format:check, test
├── eslint.config.mjs       (same as mini-framework; framework/ ignored)
├── .prettierrc  .prettierignore  .gitignore  README.md  PLAN.md  AGENTS.md
├── .opencode/command/init.md   custom command that (re)generates PLAN.md+AGENTS.md
├── framework/              vendor copy of the mini-framework (UNMODIFIED)
├── shared/                 pure code shared by client + server (ESM, no DOM)
│   ├── constants.js        grid, tick, lives, timings, tile types, colors
│   ├── map.js              deterministic map generator (seeded)
│   └── protocol.js         message type constants + encode/decode helpers
├── client/
│   ├── index.html  css/{base,screens,game}.css
│   ├── app.js              createApp + router + view (screen switching)
│   ├── screens/            nickname.js, waiting.js, game.js, gameover.js
│   ├── chat.js
│   ├── net/socket.js       WS wrapper, message dispatch, reconnect
│   └── game/
│       ├── engine.js       single rAF loop (delta-time)
│       ├── renderer.js     build board once + entity transforms
│       ├── input.js        keys → inputs (throttled)
│       └── hud.js          lives/powerups/FPS overlay
├── server/
│   ├── index.js            http static + ws upgrade
│   ├── static.js           minimal static file server (mime, path safety)
│   ├── net.js              ws connections
│   ├── room.js             lobby + countdown state machine
│   └── game.js             authoritative simulation + entities
└── tests/                  node:test: map, collisions, room countdown
```

## 7. Phases

Each phase = a logical unit, one commit, with explicit acceptance criteria.

### Phase 0 — Bootstrap / config ✅

`package.json` (ESM, devDeps matching the framework, `ws`), `.prettierrc`,
`eslint.config.mjs` (lints everything except `framework/`), `.gitignore`,
`.prettierignore`, README, `PLAN.md`, `AGENTS.md`, `.opencode/command/init.md`,
minimal static server (`server/index.js` + `server/static.js`) so `npm start`
serves an empty page, vendor-copied `framework/`.
**Accept:** `npm run lint`, `npm run format:check`, `npm start` serve the shell.

### Phase 1 — Shared foundation

`shared/constants.js`, `shared/map.js` (border walls + fixed pillars + random
destructible blocks, cleared corner spawn zones), `shared/protocol.js`.
`tests/map.test.js` with `node:test`.
**Accept:** `node --test` green; map generator always yields valid, symmetric,
playable spawns.

### Phase 2 — Server: static + WS + lobby

WebSocket upgrade, room model (assign id/color/slot, nickname, player list
broadcast, **chat relay**), lobby countdown state machine.
`tests/room.test.js`.
**Accept:** two browser tabs → counter increments; chat works in real time;
countdown logic correct for 2/4 players and leave/rejoin.

### Phase 3 — Client shell (framework)

`index.html`, CSS, `createApp`/`createRouter` with state
`{screen, nickname, players, ownId, chat, countdown}`. Screens: nickname →
waiting (counter + countdown + chat) → game (placeholder) → game over.
**Accept:** audit bullets up to and including chat + both countdown paths.

### Phase 4 — Authoritative simulation (server)

Grid model; players (pos, 3 lives, speed, max bombs, flames, alive); bombs
(timer, owner); explosions (ray propagation, chain reactions, stop at walls,
destroy blocks); powerups (**Bombs / Flames / Speed**, random chance); collision;
pickups; life loss; respawn + invulnerability; elimination; win detection;
snapshot builder. `tests/game.test.js` (explosions/chains, collision, powerups).
**Accept:** unit tests green; a headless match can be simulated to completion.
**Prereq:** `/architect` decision on sim rate / broadcast rate / interpolation.

### Phase 5 — Client rendering & input

Renderer builds the board once, entity layer with absolutely positioned sprites,
`render(snapshot)` with interpolation, node reuse/pooling for bombs/flames,
block removal, powerup pickup, HUD (lives/powerups) + dev **FPS overlay**.
Input keys → server.
**Accept:** move, place bombs, get hit (lose 1 of 3 lives), destroy blocks,
powerups appear (≥3 types), other players lose lives.

### Phase 6 — Flow integration & match end

Server drives lobby → countdown → game → game over → lobby; client switches
screens from WS messages; winner/elimination; chat also in-game.
**Accept:** full Functional audit list passing with 2 and 4 players.

### Phase 7 — Performance & audit pass

Single rAF loop with delta-time; zero forced reflow; batched DOM writes;
transform-only animation; `will-change: transform` **only** on moving sprites.
Profile in Chrome Performance tab, paint flashing, layer borders.
**Accept:** ≥60fps, no long frames/drops, minimal paint, few well-promoted
layers; every audit question answered.

### Phase 8 — Polish, docs, delivery

README (run, architecture, controls, how to measure FPS), clean lint/format,
manual multiplayer test script (2 & 4 players, 20s/10s), logical commits, push.
**Accept:** repo builds and runs from a clean clone; README reproduces the audit.

## 8. Audit question → where it is covered

| Audit question                        | Covered in                  |
| ------------------------------------- | --------------------------- |
| Mini-framework only (no canvas/WebGL) | Architecture §3, all phases |
| Nickname requested                    | Phase 3                     |
| Waiting page + player counter         | Phase 2/3                   |
| Chat on join                          | Phase 2/3                   |
| Second user → counter +1              | Phase 2                     |
| Real-time chat via WebSockets         | Phase 2                     |
| 20s → 10s countdown (2 users)         | Phase 2/3                   |
| 4 users → immediate 10s countdown     | Phase 2/3                   |
| Move + place bombs                    | Phase 4/5                   |
| Whole map visible                     | Phase 3/5                   |
| Own explosion → lose 1 of 3 lives     | Phase 4/5                   |
| Lose all 3 lives → out                | Phase 4/6                   |
| Bomb next to other player → life lost | Phase 4/5                   |
| Bomb next to block → block disappears | Phase 4/5                   |
| Destroy all blocks → powerups appear  | Phase 4/5                   |
| ≥3 powerup types                      | Phase 4/5                   |
| No frame drops                        | Phase 7                     |
| ~60fps                                | Phase 7                     |
| Paint as little as possible           | Phase 5/7                   |
| Layers few + promoted properly        | Phase 5/7                   |

## 9. Verification commands

- `npm run lint`
- `npm run format:check`
- `node --test`
- `npm start` + manual multi-tab (2–4) testing with Chrome DevTools Performance.

No typecheck (plain JS). No extra test-runner dependency (`node:test`).

## 10. Risks & watch-outs

1. **Game loop in `setState`** → frame drops. Mitigated by the §3 rule.
2. **Index-based diffing:** dynamic lists (players) must keep a stable order or
   be managed imperatively by the renderer.
3. **Interpolation complexity:** fallback is a higher simulation rate.
4. **Countdown edge cases:** player leaves/rejoins, single player, full room.
5. **Layer hygiene:** promoting every tile creates too many layers; promote only
   moving entities.
