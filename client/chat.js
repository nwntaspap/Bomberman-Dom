/**
 * client/chat.js — chat panel (messages list + composer).
 *
 * The composer input is deliberately uncontrolled: reading its value on submit
 * avoids re-rendering the whole view on every keystroke.
 */
import { h } from '../framework/index.js';

/**
 * @param {Array<{from: string, text: string, ts: number}>} messages
 * @param {(text: string) => void} onSend
 * @returns {object} VNode
 */
export function chatView(messages, onSend) {
  return h('div', { class: 'chat' }, [
    h('h2', {}, ['Chat']),
    h(
      'ul',
      { class: 'chat-messages' },
      messages.map(m => h('li', {}, [h('strong', {}, [`${m.from}:`]), ' ', m.text]))
    ),
    h(
      'form',
      {
        class: 'chat-form',
        onSubmit: e => {
          e.preventDefault();
          const input = e.target.elements.text;
          const text = input.value.trim();
          if (text) onSend(text);
          input.value = '';
        },
      },
      [
        h('input', {
          name: 'text',
          type: 'text',
          maxlength: '200',
          placeholder: 'Type a message…',
        }),
        h('button', { type: 'submit' }, ['Send']),
      ]
    ),
  ]);
}
