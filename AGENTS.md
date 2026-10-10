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
