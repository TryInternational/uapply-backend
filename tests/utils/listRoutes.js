/**
 * Lists every route the Express app has registered, by walking the app's own
 * router stack. It reads what Express will actually serve, so a route cannot
 * be missed because of how its file happens to be written or mounted.
 *
 * Returns [{ method: 'GET', path: '/v1/students/:studentId' }, ...] in the
 * order Express would try them.
 */

// Express turns a mount path such as "/v1" into the pattern /^\/v1\/?(?=\/|$)/i.
// This reads the plain path back out of it, or returns null for anything else.
const MOUNT_START = '^';
const MOUNT_END = '\\/?(?=\\/|$)';

const mountPathOf = (layer) => {
  if (layer.regexp.fast_slash) return '';
  const { source } = layer.regexp;
  if (!source.startsWith(MOUNT_START) || !source.endsWith(MOUNT_END)) return null;
  const mount = source.slice(MOUNT_START.length, -MOUNT_END.length).split('\\/').join('/');
  // Anything left that is not a plain path character means a pattern or a parameter.
  return /^[/\w.~-]+$/.test(mount) ? mount : null;
};

const join = (prefix, path) => {
  const joined = `${prefix}${path}`.replace(/\/{2,}/g, '/');
  return joined.length > 1 ? joined.replace(/\/$/, '') : joined;
};

const listRoutes = (app) => {
  const routes = [];
  const unreadable = [];

  const walk = (stack, prefix) => {
    stack.forEach((layer) => {
      if (layer.route) {
        const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
        paths.forEach((path) => {
          if (typeof path !== 'string') {
            unreadable.push(`${prefix} ${String(path)}`);
            return;
          }
          const methods = layer.route.methods._all ? ['ALL'] : Object.keys(layer.route.methods).map((m) => m.toUpperCase());
          methods.forEach((method) => routes.push({ method, path: join(prefix, path) }));
        });
      } else if (layer.name === 'router' && layer.handle && Array.isArray(layer.handle.stack)) {
        const mount = mountPathOf(layer);
        if (mount === null) {
          unreadable.push(`${prefix} ${layer.regexp.source}`);
          return;
        }
        walk(layer.handle.stack, join(prefix, mount));
      }
    });
  };

  // eslint-disable-next-line no-underscore-dangle
  walk(app._router.stack, '');
  return { routes, unreadable };
};

module.exports = { listRoutes };
