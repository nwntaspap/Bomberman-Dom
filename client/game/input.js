/**
 * client/game/input.js — keyboard → server inputs.
 *
 * Keys are translated to direction inputs *immediately* on the key event (not
 * tied to the frame loop). Held-key auto-repeat is reduced to one message per
 * direction change, and releasing every movement key sends a single
 * `{ moving: false }` so the server stops the walk at the next cell.
 *
 * WASD and the arrow keys both work; Space places a bomb.
 */
const KEY_DIRS = {
  arrowup: 'up',
  arrowdown: 'down',
  arrowleft: 'left',
  arrowright: 'right',
  w: 'up',
  s: 'down',
  a: 'left',
  d: 'right',
};

// Priority when several keys are held at once (last pressed isn't tracked).
const ORDER = ['up', 'down', 'left', 'right'];

/**
 * @param {object} handlers
 * @param {(input: {dir: string, moving: boolean}) => void} handlers.onMove
 * @param {() => void} handlers.onBomb
 * @returns {{ attach: () => void, detach: () => void }}
 */
export function createInput({ onMove, onBomb }) {
  const held = new Set();
  let current = null; // last emitted direction (null = not moving)
  let lastDir = 'down'; // sent with the "stop" message so the sprite faces right

  function apply() {
    const dir = ORDER.find(d => held.has(d)) || null;
    if (dir === current) return;
    if (dir) lastDir = dir;
    current = dir;
    onMove({ dir: dir || lastDir, moving: dir !== null });
  }

  /** Don't steal keys while the player types in the chat composer. */
  function isTyping(target) {
    if (!target || !target.tagName) return false;
    return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
  }

  function onKeyDown(e) {
    if (isTyping(e.target)) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) onBomb();
      return;
    }
    const dir = KEY_DIRS[e.key.toLowerCase()];
    if (!dir) return;
    e.preventDefault(); // stop arrow keys from scrolling the page
    held.add(dir);
    apply();
  }

  function onKeyUp(e) {
    const dir = KEY_DIRS[e.key.toLowerCase()];
    if (!dir) return;
    held.delete(dir);
    apply();
  }

  // Losing focus (alt-tab) would otherwise leave a key "stuck" pressed.
  function onBlur() {
    held.clear();
    apply();
  }

  return {
    attach() {
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      window.addEventListener('blur', onBlur);
    },
    detach() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      held.clear();
      current = null;
    },
  };
}
