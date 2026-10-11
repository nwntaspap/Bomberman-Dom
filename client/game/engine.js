/**
 * client/game/engine.js — the single requestAnimationFrame loop.
 *
 * The whole board is driven by exactly one rAF loop (PLAN §3). Each frame it
 * measures the real delta-time, keeps a smoothed FPS estimate, and calls
 * `onFrame(now, dt, fps)`. Nothing here touches game state through the
 * framework store; the loop only reads timing and lets the renderer/HUD update
 * the DOM directly.
 */
/**
 * @param {object} options
 * @param {(now: number, dt: number, fps: number) => void} options.onFrame
 *   called once per animation frame with the rAF timestamp, the ms since the
 *   previous frame, and a smoothed frames-per-second estimate.
 * @returns {{ start: () => void, stop: () => void }}
 */
export function createEngine({ onFrame }) {
  let rafId = 0;
  let running = false;
  let lastTs = 0;
  let fps = 0;

  function frame(ts) {
    if (!running) return;
    // The first frame has no previous timestamp: assume 60 Hz.
    const dt = lastTs ? ts - lastTs : 1000 / 60;
    lastTs = ts;
    if (dt > 0) fps = fps ? fps + (1000 / dt - fps) * 0.1 : 1000 / dt;
    onFrame(ts, dt, fps);
    rafId = requestAnimationFrame(frame);
  }

  return {
    start() {
      if (running) return;
      running = true;
      lastTs = 0;
      rafId = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
    },
  };
}
