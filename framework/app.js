/**
 * app.js — ties state, view and DOM together.
 *
 * This is the piece that gives us "inversion of control": instead of
 * the developer manually calling store.subscribe(render) and re-running
 * mount() themselves, they just describe:
 *   - what the initial state is
 *   - how to turn a given state into a VNode tree (the "view")
 *
 * ...and createApp() takes care of wiring state changes to re-renders.
 *
 * Note: routes aren't handled here yet. For now this only wires
 * state -> view -> DOM.
 */
import { createStore } from './state.js';
import { mount, patch } from './dom.js';

/**
 * @param {object} options
 * @param {object} options.state - initial state
 * @param {(state: object) => VNode} options.view - pure function: state in, VNode tree out
 * @returns {{ getState, setState, mount }}
 */
export function createApp({ state: initialState = {}, view }) {
  if (typeof view !== 'function') {
    throw new Error('createApp: `view` must be a function (state) => VNode');
  }

  const store = createStore(initialState);
  let container = null;
  let currentVNode = null; // last rendered tree, used to diff against next time

  function renderNow(state) {
    if (!container) return; // not mounted yet, nothing to render into

    const newVNode = view(state);

    if (currentVNode === null) {
      mount(newVNode, container); // first render: nothing to diff yet
    } else {
      patch(container, newVNode, currentVNode, 0); // patch only what changed
    }

    currentVNode = newVNode;
  }

  // every state change re-renders automatically — this is the whole
  // point of createApp: the developer never calls render() themselves
  store.subscribe(renderNow);

  return {
    getState: store.getState,
    setState: store.setState,

    /**
     * @param {string|HTMLElement} target - a CSS selector or an actual element
     */
    mount(target) {
      container = typeof target === 'string' ? document.querySelector(target) : target;

      if (!container) {
        throw new Error(`createApp.mount: no element found for "${target}"`);
      }

      renderNow(store.getState()); // initial render
    },
  };
}
