/**
 * client/screens/game.js — the game screen.
 *
 * Phase 3: a shell/placeholder. Phase 5 replaces the placeholder with the
 * rAF-driven board renderer (build once + transform updates).
 */
import { h } from '../../framework/index.js';
import { chatView } from '../chat.js';

export function gameScreen(state, actions) {
  return h('div', { class: 'screen game' }, [
    h('h1', { class: 'title' }, ['Game on!']),
    h('p', { class: 'hint' }, ['The board renderer lands here in Phase 5.']),
    h('p', { class: 'hint' }, [`Players: ${state.players.map(p => p.nickname).join(', ') || '—'}`]),
    chatView(state.chat, actions.sendChat),
  ]);
}
