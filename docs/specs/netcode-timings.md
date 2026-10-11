# Netcode timing: simulation rate, snapshot rate, interpolation

**Status:** accepted
**Date:** 2026-10-11

## Decision

The server simulates the match at a fixed **30 Hz** and broadcasts one snapshot
per simulation tick (so snapshots also arrive at **30 Hz**). The client renders
at 60 fps via its own `requestAnimationFrame` loop and **linearly interpolates**
entity positions between the two most recent snapshots, rendering one snapshot
of latency behind (≈33 ms interpolation delay). No client-side prediction or
extrapolation.

## Context

The plan (Phase 4 prereq) forces an explicit choice of simulation rate,
broadcast rate, and interpolation strategy before the authoritative sim is
written. Constraints that shape the answer:

- **Grid movement.** Players step whole 32 px tiles at 140 ms/tile base speed.
  Collisions, explosions, and power-up pickups are decided at cell granularity.
  Intermediate positions between cells are purely visual.
- **60 fps is a client-side rendering requirement** (the audit): smooth motion
  comes from the rAF loop interpolating between snapshots, not from server rate.
- **Node-only server, `ws` only, up to 4 players.** JSON snapshots of ~300 bytes
  at 30 Hz ≈ 9 KB/s per client — trivial on localhost/lan.
- **WebSocket is TCP:** ordered, no loss — no snapshot reordering handling.
- Existing code already treats timing as **time-based with an injectable clock**
  (`createRoom({ now })`), and `shared/constants.js` ships `SIM_TICK_MS =
1000/60` placeholder pending this decision.

## Considered and rejected

**30 Hz was chosen over 60 Hz sim with a decoupled 20 Hz broadcast.** The
60/20 split buys physically finer timesteps nobody can perceive (cell-granular
decisions), while forcing two cadences to reason about and a larger
interpolation delay (50 ms). Since snapshots are sent every tick, sim and
broadcast share one cadence — one loop, one `dt`, one snapshot shape. Costs of
30 Hz: bomb fuses (2 s), explosions (400 ms), and respawn invulnerability are
all comfortably coarse (12+ tick spans), so sub-tick precision loss is nil.

## Specification

### Rates (shared/constants.js)

```js
SIM_TICK_MS = 1000 / 30; // 30 Hz authoritative tick; one snapshot broadcast per tick
// client-side renderer (added in Phase 5):
INTERP_DELAY_MS = 33; // render ~1 snapshot behind; buffer holds 2-3
SNAPSHOT_BUFFER_MAX = 3;
```

### Simulation loop (server/game.js, Phase 4)

- `setInterval(tick, SIM_TICK_MS)`. Timing is **absolute**, never tick-counted:
  bombs carry `fuseAt`, movement `moveUntil`, flames `until`, respawns
  `invulnUntil` — ms timestamps on the injected clock. `tick()` only asks "did X
  happen yet?", so a late/hiccuped tick can neither lose nor double-apply time,
  and tests jump the clock freely.
- `now` is injectable (same pattern as `createRoom`) so `tests/game.test.js`
  can drive the sim deterministically by calling `tick()` with a fake clock.
- Inputs received since the last tick are applied at the tick boundary.

### Snapshot shape (shared/protocol.js, MSG.SNAPSHOT)

```js
{
  type: 'snapshot',
  tick: number,            // monotonic sim tick counter
  state: 'running' | 'over',
  players: [{
    id, x, y,              // px, floats (interpolated client-side)
    dir, moving: bool,     // {dir:'up'|'down'|'left'|'right', moving:true}
    lives, alive: bool,    // dead players are excluded from rendering
    respawnUntil: number|null, // ms timestamp; invulnerable while now < this
    powerups: { bombs, flames, speed }, // tally, for the HUD
  }],
  bombs: [{ id, x, y, ownerId, fuseAt }], // fuseAt ms timestamp (server clock)
  explosions: [{ x, y, until }],          // flame cell, lethal while now < until
  blocksDestroyed: [{ x, y }],            // client removes those block sprites
  powerups: [{ id, x, y, type }],
}
```

Entities that vanish (exploded bomb, picked-up power-up, removed block) are
inferred client-side from **absence in the next snapshot** — diff by id, no
explicit remove messages.

### Client rendering (Phase 5)

- rAF loop per frame: `renderTime = now - INTERP_DELAY_MS`; from the buffered
  snapshots pick the consecutive pair `s0, s1` with `s0.tickTime <= renderTime <=
s1.tickTime` and lerp positions (`x0 + (x1-x0) * t`), flipping `dir`/`moving`
  flags on arrival. Sprites move via `transform: translate3d`; no re-render of
  the framework view — this loop owns the board DOM directly.
- Inputs (`input{dir,moving}`, `placeBomb`) are sent immediately on key events
  (held-key repeats throttled to one per direction change), not tied to the
  frame loop.

## Consequences

- Adds ~33 ms perceived latency to _own_ input (tick alignment on top). At
  140 ms/tile this is under half a tile step — imperceptible locally, fine up
  to ~150 ms RTT. Server-side latency is not amplified by the decision.
- If a client's tab janks, its interpolation buffer can underflow → brief
  freezing of sprites (never rubber-banding) until frames catch up.
- **Revisit triggers:** (1) the 60 fps audit shows interpolation stutter → raise
  `SNAPSHOT_RATE` to 60 and shrink `INTERP_DELAY_MS`; (2) real-world play over
  high-latency networks shows input lag → add own-sprite extrapolation with
  correction, and keep the snapshot schema compatible (it already is).
