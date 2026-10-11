/**
 * client/screens/gameover.js — match result screen.
 *
 * Server-driven: `gameOver{winnerId}` sets the winner and the screen counts
 * down to the automatic return to the lobby (`MATCH_END_RESET_MS`). The button
 * lets a player leave sooner; the room itself reopens on the server's timer.
 */
import { h } from '../../framework/index.js';
import { chatView } from '../chat.js';

export function gameoverScreen(state, actions) {
  const winner = state.players.find(p => p.id === state.winnerId);
  const returning =
    state.lobbyIn > 0 ? `Returning to the lobby in ${state.lobbyIn}s…` : 'Returning to the lobby…';
  return h('div', { class: 'screen gameover' }, [
    h('h1', { class: 'title' }, ['Game over']),
    h('p', { class: 'result' }, [winner ? `${winner.nickname} wins!` : 'Nobody won this time.']),
    h('button', { onClick: actions.backToLobby }, ['Back to lobby']),
    h('p', { class: 'hint' }, [returning]),
    chatView(state.chat, actions.sendChat),
  ]);
}
