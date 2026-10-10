/**
 * state.js — a small observable store.
 *
 * Not Redux, no actions/reducers/middleware. Just:
 *   - a single state object
 *   - a way to read it
 *   - a way to update it (shallow-merged)
 *   - a way to subscribe to changes
 *
 * The render function subscribes to the store, so any setState() call
 * anywhere in the app triggers a re-render automatically. This is what
 * lets multiple parts of the UI (e.g. the todo list AND the counter AND
 * the footer) share the same state without passing it around manually.
 */

export function createStore(initialState = {}) {
  let state = initialState;
  const listeners = new Set();

  function getState() {
    return state;
  }

  /**
   * Shallow-merges `update` into the current state, then notifies every
   * subscriber with the new state.
   *
   * Shallow merge is intentional and simple: for nested state (like
   * Bomberman's board/players/bombs), each feature is expected to pass
   * the full updated sub-object rather than relying on the store to
   * deep-merge for you. This keeps the store's contract predictable.
   *
   * @param {object|Function} update - either a partial state object, or
   *   a function (prevState) => partialState, for updates that depend
   *   on the previous state (avoids stale-state bugs).
   */
  function setState(update) {
    const partial = typeof update === 'function' ? update(state) : update;
    state = { ...state, ...partial };
    listeners.forEach(listener => listener(state));
  }

  /**
   * Registers a listener called with the new state on every setState().
   * Returns an unsubscribe function.
   */
  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return { getState, setState, subscribe };
}
