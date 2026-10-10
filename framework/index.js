/**
 * framework/index.js — the framework's public API.
 *
 * This is the ONLY file apps built with this framework should import
 * from. Everything else in framework/ (dom.js, state.js, events.js,
 * router.js, app.js) is an internal implementation detail: reachable if
 * you really want to dig in, but not part of the contract.
 *
 * Usage:
 *
 *   import { h, createApp, createRouter, on, off, emit } from "./framework/index.js";
 *
 * See docs/README.md for the full guide with examples.
 */

export { h } from './dom.js';
export { createApp } from './app.js';
export { createRouter } from './router.js';
export { createStore } from './state.js';
export { on, off, emit } from './events.js';
