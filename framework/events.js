/**
 * events.js — our own event handling layer.
 *
 * Instead of calling addEventListener() on every single element (which is
 * what the audit explicitly asks us NOT to just re-wrap), we use EVENT
 * DELEGATION: one real addEventListener per event *type*, attached once
 * on the app's root container. Every element that wants to handle that
 * event type registers its handler in a small internal registry; when the
 * browser fires the event, we walk up from event.target and find the
 * closest registered element.
 *
 * This means:
 *  - elements created later (e.g. a new todo <li>) automatically work,
 *    with zero extra wiring
 *  - we only ever have a handful of real DOM listeners, no matter how
 *    many interactive elements exist (important for Bomberman's board)
 */

// element -> { eventName: handlerFn }
const handlerRegistry = new WeakMap();

// which event types already have a delegated listener attached, and on
// which root container
const delegatedTypes = new Set();
let rootContainer = null;

/**
 * Must be called once, when the app mounts, so the event system knows
 * which container to delegate from.
 * @param {HTMLElement} container
 */
export function initEvents(container) {
  rootContainer = container;
}

/**
 * Registers an event handler on a specific DOM element.
 * This is called internally by dom.js's createDOMElement() whenever it
 * sees an `onClick`, `onInput`, etc. attribute — you normally don't call
 * this directly, you use h("button", { onClick: fn }, ...).
 *
 * @param {HTMLElement} el
 * @param {string} eventName - e.g. "click", "input", "keydown" (no "on" prefix)
 * @param {Function} handler
 */
export function setEventHandler(el, eventName, handler) {
  if (!handlerRegistry.has(el)) {
    handlerRegistry.set(el, {});
  }
  handlerRegistry.get(el)[eventName] = handler;
  ensureDelegated(eventName);
}

/**
 * Removes a previously registered handler for one event type on one
 * element. Called by dom.js's updateAttrs() when a patch finds that an
 * onX prop existed before but is gone in the new VNode — without this,
 * the old handler would stay in the registry forever (a stale handler
 * that keeps firing even though the VNode no longer declares it).
 *
 * @param {HTMLElement} el
 * @param {string} eventName - e.g. "click" (no "on" prefix)
 */
export function removeEventHandler(el, eventName) {
  const handlers = handlerRegistry.get(el);
  if (!handlers) return;
  delete handlers[eventName];
}

// Events that don't bubble. Our delegation relies on bubbling up to the
// root container — but blur/focus (needed for TodoMVC's "save edit on
// blur" behavior) never bubble. The fix: listen in the CAPTURE phase
// instead. Capture always fires top-down through every ancestor BEFORE
// reaching the target, regardless of whether the event bubbles — so a
// capture-phase listener on the root still sees these events.
const NON_BUBBLING_EVENTS = new Set(['blur', 'focus']);

function ensureDelegated(eventName) {
  if (delegatedTypes.has(eventName)) return;
  if (!rootContainer) {
    throw new Error('events.js: initEvents(container) must be called before registering handlers');
  }

  const useCapture = NON_BUBBLING_EVENTS.has(eventName);

  rootContainer.addEventListener(
    eventName,
    nativeEvent => {
      // walk up from the actual clicked/typed element until we find one
      // with a registered handler for this event type, or we reach the
      // root container itself (inclusive — the root can have handlers too)
      let node = nativeEvent.target;
      while (node) {
        const handlers = handlerRegistry.get(node);
        if (handlers && handlers[eventName]) {
          handlers[eventName](nativeEvent);
          return;
        }
        if (node === rootContainer) break;
        node = node.parentNode;
      }
    },
    useCapture
  );

  delegatedTypes.add(eventName);
}

// ---------------------------------------------------------------------
// Application-level events (not DOM events) — a simple pub/sub, useful
// for things like Bomberman's "playerMove" style custom events later.
// ---------------------------------------------------------------------

const appListeners = new Map(); // eventName -> Set<fn>

export function on(eventName, handler) {
  if (!appListeners.has(eventName)) appListeners.set(eventName, new Set());
  appListeners.get(eventName).add(handler);
  return () => off(eventName, handler);
}

export function off(eventName, handler) {
  appListeners.get(eventName)?.delete(handler);
}

export function emit(eventName, payload) {
  appListeners.get(eventName)?.forEach(fn => fn(payload));
}
