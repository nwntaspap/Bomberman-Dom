/**
 * client/net/socket.js — WebSocket client wrapper.
 *
 * Wraps the browser's WebSocket with:
 *  - message (un)packing via the shared protocol,
 *  - automatic reconnection (a closed socket reconnects after a short delay),
 *  - a tiny `send` API guarded against a not-yet-open socket.
 */
import { WS_PATH } from '../../shared/constants.js';
import { pack, unpack } from '../../shared/protocol.js';

const RECONNECT_MS = 2000;

/** ws://host/ws — same host the page was served from. */
function defaultUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${WS_PATH}`;
}

/**
 * @param {object} [options]
 * @param {string} [options.url]
 * @param {(msg: object) => void} [options.onMessage]
 * @param {() => void} [options.onOpen] - fires on every (re)connect
 * @param {() => void} [options.onClose] - fires when a connection is lost
 */
export function createSocket({
  url = defaultUrl(),
  onMessage = null,
  onOpen = null,
  onClose = null,
} = {}) {
  let ws = null;
  let closing = false;
  let timer = null;

  function connect() {
    ws = new WebSocket(url);
    ws.onopen = () => {
      if (onOpen) onOpen();
    };
    ws.onmessage = event => {
      const msg = unpack(event.data);
      if (msg && onMessage) onMessage(msg);
    };
    ws.onclose = () => {
      ws = null;
      if (onClose) onClose();
      if (!closing) timer = setTimeout(connect, RECONNECT_MS);
    };
  }

  /**
   * Sends a protocol message; returns false when the socket is not open.
   * @param {{ type: string, [k: string]: unknown }} msg
   * @returns {boolean}
   */
  function send(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(pack(msg.type, msg));
      return true;
    }
    return false;
  }

  function close() {
    closing = true;
    clearTimeout(timer);
    if (ws) ws.close();
    ws = null;
  }

  return { connect, send, close };
}
