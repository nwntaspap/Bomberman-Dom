/**
 * client/game/hud.js — lives / power-up / FPS overlay.
 *
 * Like the board, the HUD is part of the per-frame layer: it is built once,
 * directly into the `.hud` element the framework rendered, and updated from the
 * snapshot + rAF callbacks by mutating cached text nodes. It must never call
 * `setState` (that would re-render the whole framework view).
 */
import { START_LIVES } from '../../shared/constants.js';

function el(tag, className) {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function chip(label) {
  const node = el('span', 'chip');
  node.append(`${label} `);
  const value = el('b', '');
  node.appendChild(value);
  return { node, value };
}

/**
 * @param {HTMLElement} root - the empty `.hud` element built by the framework
 * @param {Array<{id: number, nickname: string, color: string}>} players - roster meta
 * @param {number} you - this client's player id
 * @returns {{ setSnapshot: (snap: object) => void, setFps: (fps: number) => void, markEliminated: (id: number) => void, destroy: () => void }}
 */
export function createHud(root, players, you) {
  const roster = el('div', 'hud-players');
  const rows = new Map(); // player id -> { row, hearts }

  for (const p of players) {
    const row = el('div', 'hud-row');
    const dot = el('span', 'hud-dot');
    dot.style.background = p.color;
    const name = el('span', 'hud-name');
    name.textContent = p.nickname;
    const hearts = el('span', 'hud-lives');
    hearts.textContent = '♥'.repeat(START_LIVES);
    row.append(dot, name, hearts);
    roster.appendChild(row);
    rows.set(p.id, { row, hearts });
  }

  const mine = el('div', 'hud-me');
  const bombs = chip('B ×');
  const flames = chip('F ×');
  const speed = chip('S ×');
  bombs.value.textContent = '1';
  flames.value.textContent = '1';
  speed.value.textContent = '0';
  mine.append(bombs.node, flames.node, speed.node);

  const fpsNode = el('div', 'hud-fps');
  fpsNode.textContent = '— fps';

  root.replaceChildren(roster, mine, fpsNode);

  let shownFps = -1;

  return {
    setSnapshot(snap) {
      for (const p of snap.players) {
        const entry = rows.get(p.id);
        if (!entry) continue;
        const hearts =
          '♥'.repeat(Math.max(0, p.lives)) + '♡'.repeat(Math.max(0, START_LIVES - p.lives));
        if (entry.hearts.textContent !== hearts) entry.hearts.textContent = hearts;
      }
      const me = snap.players.find(p => p.id === you);
      if (me) {
        bombs.value.textContent = String(me.powerups.bombs);
        flames.value.textContent = String(me.powerups.flames);
        speed.value.textContent = String(me.powerups.speed);
      }
    },

    setFps(fps) {
      const rounded = Math.round(fps);
      if (rounded === shownFps) return; // only touch the DOM when the number changes
      shownFps = rounded;
      fpsNode.textContent = `${rounded} fps`;
    },

    /**
     * An eliminated player stops appearing in snapshots (see server/game.js),
     * so `setSnapshot` can never zero their hearts — this is the explicit
     * signal that does it.
     */
    markEliminated(id) {
      const entry = rows.get(id);
      if (!entry || entry.row.classList.contains('out')) return;
      entry.hearts.textContent = '♡'.repeat(START_LIVES);
      entry.row.classList.add('out');
    },

    destroy() {
      root.replaceChildren();
      rows.clear();
    },
  };
}
