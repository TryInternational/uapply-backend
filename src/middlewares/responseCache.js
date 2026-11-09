/**
 * Short-lived, in-process cache for heavy read-only dashboard endpoints.
 *
 * The admin dashboard fires ~17 requests per open, and several of them
 * (breakdowns, the application / fees / student dashboard aggregates, the
 * leaderboard) scan whole collections and take 0.5–1.5 s on the server. Staff
 * reopening the dashboard, switching tabs or two people looking at the same
 * range get the answer from memory for `ttlMs` instead of re-running the scans.
 *
 * Only successful GET answers are kept, keyed by path + the sorted query (the
 * responses here are company-wide, not per user — never put this on a route
 * whose answer depends on req.user). Concurrent identical requests share one
 * computation. Bounded: the oldest entries go first past MAX_ENTRIES.
 */
const MAX_ENTRIES = 300;
const store = new Map(); // key -> { exp, body }
const inFlight = new Map(); // key -> Promise<body>

const keyOf = (req) => {
  const q = req.query || {};
  const sorted = Object.keys(q)
    .sort()
    .map((k) => [k, q[k]]);
  return `${req.baseUrl}${req.path}?${JSON.stringify(sorted)}`;
};

const remember = (key, body, ttlMs) => {
  if (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value);
  store.set(key, { exp: Date.now() + ttlMs, body });
};

const responseCache =
  (ttlMs = 60 * 1000) =>
  (req, res, next) => {
    if (req.method !== 'GET') return next();
    const key = keyOf(req);
    const hit = store.get(key);
    if (hit && hit.exp > Date.now()) {
      res.set('X-Cache', 'HIT');
      return res.json(hit.body);
    }
    const pending = inFlight.get(key);
    if (pending) {
      return pending.then(
        (body) => {
          res.set('X-Cache', 'SHARED');
          res.json(body);
        },
        () => next()
      );
    }

    let settle;
    let fail;
    const shared = new Promise((resolve, reject) => {
      settle = resolve;
      fail = reject;
    });
    // only waiters observe it — a failure with nobody waiting must not be "unhandled"
    shared.catch(() => {});
    inFlight.set(key, shared);

    const json = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode === 200) {
        remember(key, body, ttlMs);
        settle(body);
      } else {
        fail(new Error(`status ${res.statusCode}`));
      }
      inFlight.delete(key);
      return json(body);
    };
    res.on('close', () => {
      if (inFlight.get(key)) {
        fail(new Error('closed'));
        inFlight.delete(key);
      }
    });
    res.set('X-Cache', 'MISS');
    return next();
  };

/** Drop everything (e.g. after a bulk import). */
responseCache.clear = () => store.clear();

module.exports = responseCache;
