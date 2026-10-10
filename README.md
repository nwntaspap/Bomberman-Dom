# Bomberman-Dom

Multiplayer Bomberman (2–4 players) built with a from-scratch mini-framework —
pure DOM, **no canvas, no WebGL, no other frameworks** — and a WebSocket
authoritative server.

## Run

```bash
npm install
npm start          # → http://localhost:3001
```

Open the page in **2–4 browser tabs/windows**, enter a nickname, and battle
until one player is left standing. The chat lets everyone talk in real time.

> Default port is 3001; override with `PORT=8080 npm start` if it is taken.

## Scripts

| Script                                    | What it does                                   |
| ----------------------------------------- | ---------------------------------------------- |
| `npm start`                               | starts the server (static files + WebSocket)   |
| `npm dev`                                 | same, auto-restarts on change (`node --watch`) |
| `npm test`                                | runs the `node:test` suite                     |
| `npm run lint` / `npm run lint:fix`       | ESLint (flat config)                           |
| `npm run format` / `npm run format:check` | Prettier                                       |

## Architecture (short)

```
framework/   vendored mini-framework — UNMODIFIED, do not edit
shared/      pure logic shared by client + server (ESM, no DOM)
client/      browser app: mini-framework screens + rAF game loop
server/      Node + ws: static files + authoritative simulation
tests/       node:test suites (map, collisions, room)
```

- **Two rendering layers**: the mini-framework drives screens/flow (nickname,
  waiting room, chat, HUD shell); a single `requestAnimationFrame` loop moves
  game entities with `transform: translate3d` (compositor-only → 60fps with
  minimal paint). Game state never goes through `setState` per frame.
- **Authoritative server**: owns the simulation, consumes inputs, broadcasts
  snapshots; clients interpolate for smooth 60fps rendering.

See [PLAN.md](./PLAN.md) for the full implementation plan and phase breakdown.
