/**
 * router.js — synchronizes the URL with the app's state, using the
 * History API (pushState / popstate), not hash-based routing (#/active).
 *
 * The router itself holds NO state. It's just a translator:
 *   URL path  <-->  a handler function you provide
 *
 * Typical usage (see todomvc/app.js for the real example):
 *
 *   const router = createRouter({
 *     "/":          () => app.setState({ filter: "all" }),
 *     "/active":    () => app.setState({ filter: "active" }),
 *     "/completed": () => app.setState({ filter: "completed" }),
 *   });
 *
 *   router.start();               // reacts to the current URL + back/forward
 *   router.navigate("/active");   // called from an onClick, changes the URL
 *
 * Why handlers instead of the router owning state directly? Because the
 * router's only job is URL <-> route matching. What a route *means* for
 * your app (which filter, which page, which game screen...) is up to you
 * — same separation of concerns as state.js not knowing about the DOM.
 */

export function createRouter(routes) {
  if (!routes || typeof routes !== 'object') {
    throw new Error('createRouter: routes must be an object, e.g. { "/": handler }');
  }

  let started = false;

  /**
   * Finds the handler for a given path. Falls back to the "/" route if
   * the path isn't recognized (e.g. someone typos the URL), so the app
   * never ends up with no matching route at all.
   */
  function resolve(path) {
    const handler = routes[path] || routes['/'];
    if (handler) handler(path);
  }

  function handlePopState() {
    resolve(window.location.pathname);
  }

  return {
    /**
     * Call once, when the app starts. Wires up back/forward support and
     * runs the handler for whatever URL the page was loaded with.
     * Safe to call more than once — only the first call actually attaches
     * the popstate listener, so you never end up with duplicate listeners.
     */
    start() {
      if (started) return;
      started = true;
      window.addEventListener('popstate', handlePopState);
      resolve(window.location.pathname);
    },

    /**
     * Changes the URL (without a page reload) and runs the matching
     * handler. This is what you call from an onClick, e.g. on the
     * "Active" / "Completed" filter links.
     * @param {string} path - e.g. "/active"
     */
    navigate(path) {
      if (window.location.pathname !== path) {
        window.history.pushState({}, '', path);
      }
      resolve(path);
    },
  };
}
