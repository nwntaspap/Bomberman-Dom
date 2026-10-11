/**
 * client/screens/gameover.js — match result screen.
 *
 * Server-driven in Phase 6 (`gameOver{winnerId}`); the view exists already so
 * the screen list is complete.
 */
import { h } from '../../framework/index.js';
import { chatView } from '../chat.js';

export function gameoverScreen(state, actions) {
  const winner = state.players.find(p => p.id === state.winnerId);
  return h('div', { class: 'screen gameover' }, [
    h('h1', { class: 'title' }, ['Game over']),
    h('p', { class: 'result' }, [winner ? `${winner.nickname} wins!` : 'Nobody won this time.']),
    h('button', { onClick: actions.backToLobby }, ['Back to lobby']),
    chatView(state.chat, actions.sendChat),
  ]);
}
