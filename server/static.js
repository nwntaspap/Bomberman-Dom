/**
 * server/static.js — a minimal static file server.
 *
 * Serves the client's files (HTML, CSS, JS) so the browser can load native
 * ES modules. No bundler, no framework: just Node's own fs/http.
 *
 * Two safety features matter here:
 *  - an allow-list of top-level folders that may ever be served, so the
 *    repository's server code, .git, package.json, etc. are never exposed;
 *  - an SPA fallback: the client routes with the History API (real paths like
 *    /game), so a navigation request for a path that is not a file falls back
 *    to the app entry point instead of 404ing on refresh.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, relative, sep } from 'node:path';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function contentType(path) {
  return MIME_TYPES[extname(path).toLowerCase()] || 'application/octet-stream';
}

/**
 * Resolves a URL pathname to a path inside `root`, or null when the request
 * is malformed or escapes the root (path traversal).
 */
function resolveSafe(root, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const full = join(root, normalize(decoded));
  return full === root || full.startsWith(root + sep) ? full : null;
}

/** True when the last path segment looks like a file (has an extension). */
function looksLikeFile(pathname) {
  const last = pathname.split('/').pop() || '';
  return last.includes('.');
}

async function resolveFile(target) {
  const info = await stat(target).catch(() => null);
  if (info && info.isDirectory()) {
    const index = join(target, 'index.html');
    const indexInfo = await stat(index).catch(() => null);
    return indexInfo && indexInfo.isFile() ? { file: index, info: indexInfo } : null;
  }
  return info && info.isFile() ? { file: target, info } : null;
}

function sendFile(res, file, info) {
  res.writeHead(200, { 'content-type': contentType(file), 'content-length': info.size });
  createReadStream(file).pipe(res);
}

/**
 * Creates a request handler that serves files from `root`.
 *
 * @param {string} root - absolute path to serve from
 * @param {object} [options]
 * @param {string[]|null} [options.allow] - top-level folders (relative to
 *   `root`) that may be served; null disables the restriction
 * @param {string|null} [options.fallback] - file served for non-file
 *   navigation paths that don't match a real file (SPA fallback)
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void}
 */
export function createStaticHandler(root, { allow = null, fallback = null } = {}) {
  function isAllowed(target) {
    if (!allow) return true;
    const rel = relative(root, target);
    if (rel === '') return true; // the root itself: handled by the fallback
    return allow.includes(rel.split(sep)[0]);
  }

  return async function handle(req, res) {
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      const target = resolveSafe(root, pathname);

      if (!target) {
        res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }).end('Forbidden');
        return;
      }

      if (isAllowed(target)) {
        const found = await resolveFile(target);
        if (found) {
          sendFile(res, found.file, found.info);
          return;
        }
      }

      if (fallback && !looksLikeFile(pathname)) {
        const fallbackFound = await resolveFile(fallback);
        if (fallbackFound) {
          sendFile(res, fallbackFound.file, fallbackFound.info);
          return;
        }
      }

      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
    } catch {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end('Server error');
    }
  };
}
