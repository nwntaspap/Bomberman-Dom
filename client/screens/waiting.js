/**
 * client/screens/waiting.js — waiting room: player counter, countdown, chat.
 */
import { h } from '../../framework/index.js';
import { MAX_PLAYERS, PLAYER_COLORS } from '../../shared/constants.js';
import { chatView } from '../chat.js';

export function waitingScreen(state, actions) {
  return h('div', { class: 'screen waiting' }, [
    h('h1', { class: 'title' }, ['Waiting room']),

    h('div', { class: 'counter' }, [`${state.players.length}/${MAX_PLAYERS}`]),

    state.countdown != null
      ? h('div', { class: 'countdown' }, [
          String(state.countdown),
          h('small', {}, ['seconds to start']),
        ])
      : h('p', { class: 'hint' }, ['Waiting for players to join…']),

    h(
      'ul',
      { class: 'player-list' },
      state.players.map(p =>
        h('li', { class: p.id === state.me?.id ? 'me' : '' }, [
          h('span', { class: 'dot', style: `background:${PLAYER_COLORS[p.slot]}` }),
          p.nickname,
        ])
      )
    ),

    chatView(state.chat, actions.sendChat),
  ]);
}
