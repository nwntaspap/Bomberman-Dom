/**
 * client/screens/nickname.js — entry screen: pick a nickname, then join.
 */
import { h } from '../../framework/index.js';

export function nicknameScreen(state, actions) {
  return h('div', { class: 'screen nickname' }, [
    h('h1', { class: 'title' }, ['Bomberman-Dom']),
    h('p', { class: 'subtitle' }, [
      'Multiplayer Bomberman — built with a mini-framework, pure DOM, no canvas',
    ]),
    h(
      'form',
      {
        class: 'join-form',
        onSubmit: e => {
          e.preventDefault();
          actions.join(e.target.elements.nickname.value);
        },
      },
      [
        h('input', {
          name: 'nickname',
          type: 'text',
          maxlength: '16',
          placeholder: 'Enter your nickname…',
          autofocus: true,
        }),
        h('button', { type: 'submit', disabled: state.joining }, [
          state.joining ? 'Joining…' : 'Play',
        ]),
      ]
    ),
    state.joinError && h('p', { class: 'error' }, [state.joinError]),
  ]);
}
