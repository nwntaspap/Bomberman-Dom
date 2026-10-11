/**
 * client/game/session.js — wires the game modules to a running match.
 *
 * This is the glue between the framework (which owns screens and the socket)
 * and the per-frame game layer (renderer + HUD + engine + input). The framework
 * hands it the empty `.board` / `.hud` elements and the `gameStart` payload;
 * from then on every snapshot is fed straight into the rAF-driven layer and
 * never through `setState`.
 */
import { MSG } from '../../shared/protocol.js';
import { createEngine } from './engine.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';
import { createRenderer } from './renderer.js';

/**
 * @param {object} options
 * @param {(msg: {type: string, [k: string]: unknown}) => void} options.send
 *   sends a protocol message (used for inputs + bomb placement).
 * @returns {{ start: (config: object) => void, handleSnapshot: (snap: object) => void, markEliminated: (id: number) => void, stop: () => void }}
 */
export function createSession({ send }) {
  let engine = null;
  let renderer = null;
  let hud = null;
  let input = null;

  function stop() {
    if (engine) engine.stop();
    if (input) input.detach();
    if (renderer) renderer.destroy();
    if (hud) hud.destroy();
    engine = renderer = hud = input = null;
  }

  return {
    /**
     * Boots the game layer. `boardEl`/`hudEl` are the elements the framework
     * just rendered for `/game`.
     * @param {{boardEl: HTMLElement|null, hudEl: HTMLElement|null, map: object, players: Array<object>, you: number}} config
     */
    start({ boardEl, hudEl, map, players, you }) {
      stop();
      if (!boardEl || !hudEl) return; // not on the game screen (e.g. protected route)

      renderer = createRenderer(boardEl, map, players);
      hud = createHud(hudEl, players, you);
      input = createInput({
        onMove: move => send({ type: MSG.INPUT, ...move }),
        onBomb: () => send({ type: MSG.PLACE_BOMB }),
      });
      engine = createEngine({
        onFrame: (now, _dt, fps) => {
          renderer.render(now);
          hud.setFps(fps);
        },
      });
      input.attach();
      engine.start();
    },

    /** A fresh server snapshot: buffer it for interpolation and refresh the HUD. */
    handleSnapshot(snap) {
      if (!renderer) return;
      renderer.setSnapshot(snap);
      hud.setSnapshot(snap);
    },

    /** A player ran out of lives: their HUD row reads as "out" from now on. */
    markEliminated(id) {
      if (hud) hud.markEliminated(id);
    },

    stop,
  };
}
