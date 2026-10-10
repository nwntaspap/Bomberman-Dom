import { setEventHandler, initEvents, removeEventHandler } from './events.js';

/**
 * h(tag, attrs, children)
 *
 * Builds a "VNode" — a plain JS object describing a piece of UI.
 * It does NOT touch the real DOM. That's on purpose: h() only
 * describes *what* the UI should look like, some other part of
 * the framework (dom.js's createDOMElement) will be responsible
 * for turning that description into real DOM nodes.
 *
 * @param {string} tag - html tag name, e.g. "div", "input", "span"
 * @param {object} attrs - attributes/props, e.g. { class: "todo", id: "x" }
 *                         event handlers go here too, e.g. { onClick: fn }
 * @param {Array<VNode|string>} children - nested VNodes or plain strings (text nodes)
 * @returns {VNode}
 */
export function h(tag, attrs = {}, children = []) {
  const list = Array.isArray(children) ? children : [children];
  return {
    tag,
    attrs: attrs || {},
    // Ignore null/undefined/boolean children (the result of e.g.
    // `condition && h(...)`), the way React does. Without this, a `false`
    // child reaches createDOMElement() and becomes a stray
    // <undefined> element in the DOM. 0 and "" are kept — they are valid
    // text nodes.
    children: list.filter(
      child => child !== null && child !== undefined && typeof child !== 'boolean'
    ),
  };
}

// Properties that must be set directly on the DOM node (el.checked = true)
// instead of via setAttribute. Without this, things like checkboxes and
// inputs won't reflect state changes correctly after the first render.
const DOM_PROPERTIES = new Set(['value', 'checked', 'disabled', 'selected']);

// HTML *boolean* attributes (present = true, absent = false). These need
// special handling: passing `false` must *remove* the attribute, not write
// the string "false" (which would keep e.g. `hidden` hidden). Anything not
// listed here is treated as a normal string attribute (aria-*, data-*, ...).
const BOOLEAN_ATTRIBUTES = new Set([
  'allowfullscreen',
  'async',
  'autofocus',
  'autoplay',
  'controls',
  'default',
  'defer',
  'formnovalidate',
  'hidden',
  'inert',
  'ismap',
  'itemscope',
  'loop',
  'multiple',
  'muted',
  'nomodule',
  'novalidate',
  'open',
  'playsinline',
  'readonly',
  'required',
  'reversed',
]);

/**
 * Applies one attribute to a real DOM element.
 * Handles event props, DOM-property props, boolean attributes, and skips
 * null/undefined values (which would otherwise become the literal string
 * "undefined").
 */
function setAttr(el, key, value) {
  if (key.startsWith('on')) {
    // Event props are handled only as handlers. A non-function value
    // (undefined / null / false) means "no handler", so we must unregister
    // any previous one. Otherwise `onClick: armed ? fn : undefined` keeps
    // firing the old handler after `armed` becomes false.
    const eventName = key.slice(2).toLowerCase(); // "onClick" -> "click"
    if (typeof value === 'function') setEventHandler(el, eventName, value);
    else removeEventHandler(el, eventName);
  } else if (DOM_PROPERTIES.has(key)) {
    el[key] = value;
  } else if (BOOLEAN_ATTRIBUTES.has(key)) {
    if (value) el.setAttribute(key, '');
    else el.removeAttribute(key);
  } else if (value === null || value === undefined) {
    el.removeAttribute(key);
  } else {
    el.setAttribute(key, value);
  }
}

/**
 * Removes one attribute from a real DOM element.
 * Mirrors setAttr: event handlers are unregistered, DOM properties are
 * reset, everything else is removed via removeAttribute.
 */
function removeAttr(el, key) {
  if (key.startsWith('on')) {
    removeEventHandler(el, key.slice(2).toLowerCase());
  } else if (DOM_PROPERTIES.has(key)) {
    el[key] = false;
  } else {
    el.removeAttribute(key);
  }
}

/**
 * Turns a single VNode (or text string) into a real DOM node.
 * This is recursive: it builds the element, then builds and appends
 * every child, all the way down to text nodes.
 *
 * @param {VNode|string} vnode
 * @returns {Node} a real DOM Node
 */
export function createDOMElement(vnode) {
  // text nodes are just plain strings in our VNode tree
  if (typeof vnode === 'string' || typeof vnode === 'number') {
    return document.createTextNode(String(vnode));
  }

  const el = document.createElement(vnode.tag);

  for (const [key, value] of Object.entries(vnode.attrs || {})) {
    setAttr(el, key, value);
  }

  for (const child of vnode.children || []) {
    el.appendChild(createDOMElement(child));
  }

  return el;
}

/**
 * Renders a VNode tree into a real DOM container.
 * Clears the container first, then mounts fresh.
 *
 * @param {VNode} vnode
 * @param {HTMLElement} container - a real DOM element already on the page
 */
export function mount(vnode, container) {
  initEvents(container);
  container.innerHTML = '';
  container.appendChild(createDOMElement(vnode));
}

// ---------------------------------------------------------------------
// Diffing — compares an old VNode tree against a new one and applies
// the minimum set of changes to the real DOM, instead of tearing
// everything down and rebuilding it (what mount() does).
//
// NOTE: this is index-based child diffing (children compared by
// position, not by a stable "key"). That's fine for TodoMVC's simple
// cases, but reordering a keyed list would cause more DOM churn than
// strictly necessary. Worth revisiting if we ever need list reordering
// to be cheap (e.g. Bomberman's player list).
// ---------------------------------------------------------------------

function isTextNode(vnode) {
  return typeof vnode === 'string' || typeof vnode === 'number';
}

function changed(oldVNode, newVNode) {
  if (typeof oldVNode !== typeof newVNode) return true;
  if (isTextNode(newVNode)) return oldVNode !== newVNode;
  return oldVNode.tag !== newVNode.tag;
}

function updateAttrs(el, oldAttrs = {}, newAttrs = {}) {
  // remove attrs that no longer exist
  for (const key of Object.keys(oldAttrs)) {
    if (key in newAttrs) continue;
    removeAttr(el, key);
  }

  // set new/changed attrs
  for (const [key, value] of Object.entries(newAttrs)) {
    if (oldAttrs[key] === value) continue; // unchanged, skip
    setAttr(el, key, value); // overwrites previous handler/attr
  }
}

/**
 * Patches `parent`'s child at `index` so it matches `newVNode`, using
 * `oldVNode` to figure out the minimal change needed.
 *
 * @param {Node} parent - the real DOM parent element
 * @param {VNode|string|undefined} newVNode
 * @param {VNode|string|undefined} oldVNode
 * @param {number} index - which child of `parent` we're patching
 */
export function patch(parent, newVNode, oldVNode, index = 0) {
  const existing = parent.childNodes[index];

  // case 1: node didn't exist before -> create it
  if (oldVNode === undefined) {
    parent.appendChild(createDOMElement(newVNode));
    return;
  }

  // case 2: node no longer exists -> remove it
  if (newVNode === undefined) {
    if (existing) parent.removeChild(existing);
    return;
  }

  // case 3: different type/tag -> replace wholesale
  if (changed(oldVNode, newVNode)) {
    parent.replaceChild(createDOMElement(newVNode), existing);
    return;
  }

  // case 4a: both are text nodes and equal -> changed() already covered
  // the "different text" case above, so if we're here they're equal.
  if (isTextNode(newVNode)) return;

  // case 4b: same tag -> update attrs in place, then diff children
  updateAttrs(existing, oldVNode.attrs, newVNode.attrs);

  const oldChildren = oldVNode.children || [];
  const newChildren = newVNode.children || [];

  // 1. Remove extra trailing children first, walking backwards.
  //    Removing while iterating forward would shift the remaining
  //    indices left and cause every other node to be skipped (a
  //    leftover "ghost" child) whenever more than one had to go.
  for (let i = oldChildren.length - 1; i >= newChildren.length; i--) {
    patch(existing, undefined, oldChildren[i], i);
  }

  // 2. Patch the children present in both trees, by position.
  const sharedLength = Math.min(oldChildren.length, newChildren.length);
  for (let i = 0; i < sharedLength; i++) {
    patch(existing, newChildren[i], oldChildren[i], i);
  }

  // 3. Append any new children at the end.
  for (let i = oldChildren.length; i < newChildren.length; i++) {
    patch(existing, newChildren[i], undefined, i);
  }
}
