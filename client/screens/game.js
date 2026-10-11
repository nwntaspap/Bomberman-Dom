/**
 * client/screens/game.js — the game screen shell.
 *
 * The framework builds only the *structure*: an empty `.hud`, an empty `.board`
 * and the chat. The rAF layer (`client/game/session.js`) owns everything inside
 * `.hud` and `.board` afterwards — this view never re-renders per frame, so the
 * board's DOM survives every `setState` (e.g. a new chat message).
 */
import { h } from '../../framework/index.js';
import { chatView } from '../chat.js';

export function gameScreen(state, actions) {
  return h('div', { class: 'screen game' }, [
    h('div', { class: 'game-main' }, [
      h('div', { class: 'hud' }),
      h('div', { class: 'board-wrap' }, [h('div', { class: 'board' })]),
    ]),
    chatView(state.chat, actions.sendChat),
  ]);
}
