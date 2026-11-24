/* eslint-disable no-underscore-dangle, global-require, import/no-dynamic-require, import/no-extraneous-dependencies, no-param-reassign, jest/no-export, security/detect-object-injection */
/**
 * A small in-memory stand-in for MongoDB, for scripts/dev/whatsapp-analytics-selftest.js.
 *
 * It runs the real filters and aggregation pipelines the services send (through
 * mingo, a JavaScript implementation of MongoDB's query language) over plain
 * arrays, behind two faces:
 *   · `db.collection(name)` — the native-driver calls the scripts use
 *   · `models` — the mongoose model calls the services use
 * Both read and write the same arrays, so a script's writes are what the
 * services then count. Nothing here touches a real database.
 */
const path = require('path');

const load = (repo) => {
  const dirs = [repo, process.env.MINGO_DIR].filter(Boolean);
  let mingoMain;
  try {
    mingoMain = require.resolve('mingo', { paths: dirs });
  } catch (e) {
    throw new Error('mingo is not installed. Run:  npm i --no-save mingo@6   (or set MINGO_DIR to a folder that has it)');
  }
  const mingo = require(mingoMain);
  require(require.resolve('mingo/init/system', { paths: dirs }));
  const mongoose = require(require.resolve('mongoose', { paths: [repo] }));
  return { mingo, mongoose };
};

const create = (repo) => {
  const { mingo, mongoose } = load(repo);
  const { Query, Aggregator } = mingo;
  const { ObjectId } = mongoose.Types;
  const store = {};
  const rows = (name) => {
    if (!store[name]) store[name] = [];
    return store[name];
  };
  const matcher = (filter) => {
    const q = new Query(filter || {});
    return (d) => q.test(d);
  };
  const key = (v) => {
    if (v instanceof Date) return v.getTime();
    if (v === null || v === undefined) return -Infinity;
    if (typeof v === 'number') return v;
    return String(v);
  };
  const sorted = (list, spec) => {
    const fields = Object.entries(spec || {});
    const get = (d, f) => f.split('.').reduce((o, p) => (o === null || o === undefined ? o : o[p]), d);
    return [...list].sort((a, b) => {
      for (let i = 0; i < fields.length; i += 1) {
        const [f, dir] = fields[i];
        const x = key(get(a, f));
        const y = key(get(b, f));
        if (x < y) return dir < 0 ? 1 : -1;
        if (x > y) return dir < 0 ? -1 : 1;
      }
      return 0;
    });
  };

  // ---- native driver face ---------------------------------------------------
  const cursor = (list) => {
    let out = list;
    const c = {
      project: () => c,
      sort: (spec) => {
        out = sorted(out, spec);
        return c;
      },
      limit: (n) => {
        out = out.slice(0, n);
        return c;
      },
      toArray: async () => [...out],
    };
    return c;
  };
  const collection = (name) => ({
    find: (q) => cursor(rows(name).filter(matcher(q))),
    findOne: async (q, opts) => {
      const list = rows(name).filter(matcher(q));
      return (opts && opts.sort ? sorted(list, opts.sort) : list)[0] || null;
    },
    countDocuments: async (q) => rows(name).filter(matcher(q)).length,
    aggregate: (pipeline) => ({ toArray: async () => new Aggregator(pipeline).run(rows(name)) }),
    insertOne: async (d) => {
      rows(name).push(d);
    },
    insertMany: async (ds) => {
      ds.forEach((d) => rows(name).push(d));
    },
    deleteMany: async (q) => {
      const hit = matcher(q);
      const before = rows(name).length;
      store[name] = rows(name).filter((d) => !hit(d));
      return { deletedCount: before - store[name].length };
    },
    updateOne: async (q, change) => {
      const d = rows(name).find(matcher(q));
      if (d && change.$set)
        Object.entries(change.$set).forEach(([k, v]) => {
          const parts = k.split('.');
          const last = parts.pop();
          const at = parts.reduce((o, p) => {
            if (!o[p]) o[p] = {};
            return o[p];
          }, d);
          at[last] = v;
        });
      return { modifiedCount: d ? 1 : 0 };
    },
  });
  const db = { name: 'upply_staging', collection };

  // ---- mongoose face ----------------------------------------------------------
  // mongoose casts id strings in a filter to ObjectIds; so does this
  const ID_FIELDS = new Set(['_id', 'conversation', 'student', 'studentId', 'sentByUser', 'assignees.userId', 'broadcast']);
  const castId = (v) => {
    if (typeof v === 'string' && /^[a-f\d]{24}$/i.test(v)) return new ObjectId(v);
    if (Array.isArray(v)) return v.map(castId);
    if (v && typeof v === 'object' && !(v instanceof Date) && !(v instanceof ObjectId) && !(v instanceof RegExp))
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, castId(x)]));
    return v;
  };
  const cast = (filter) => {
    if (!filter || typeof filter !== 'object') return filter;
    if (Array.isArray(filter)) return filter.map(cast);
    return Object.fromEntries(
      Object.entries(filter).map(([k, v]) => {
        if (ID_FIELDS.has(k)) return [k, castId(v)];
        if (k === '$or' || k === '$and' || k === '$nor') return [k, v.map(cast)];
        return [k, v];
      })
    );
  };
  const mtest = (filter) => matcher(cast(filter));
  const DEFAULTS = {
    whatsappconversations: () => ({ unreadCount: 0, status: 'open', priority: 'medium', tags: [], assignees: [] }),
    whatsappmessages: () => ({ type: 'text', status: 'sent', internal: false }),
  };
  /** a document as service code expects it: fields live on the stored row; `student` may be populated */
  // what a conversation's schema holds: anything else a service hangs on the
  // document (the contact panel's applications, `waitingSince`) is not saved
  const CONVERSATION_FIELDS = new Set(
    '_id contact student assignees lastMessage lastMessageAt unreadCount windowExpiresAt status resolvedAt priority tags nextFollowUpAt callPermission createdAt updatedAt'.split(
      ' '
    )
  );
  const docOf = (name, row) => {
    if (!row) return null;
    let populated = null;
    const extra = {};
    const saved = (p) => name !== 'whatsappconversations' || CONVERSATION_FIELDS.has(p);
    const methods = {
      save: async () => {
        row.updatedAt = new Date();
        return proxy; // eslint-disable-line no-use-before-define
      },
      populate: async (field) => {
        if (field === 'student' && row.student)
          populated = rows('students').find((s) => String(s._id) === String(row.student)) || null;
        return proxy; // eslint-disable-line no-use-before-define
      },
      markModified: () => {},
      toObject: () => row,
    };
    const proxy = new Proxy(row, {
      get: (t, p) => {
        if (p in methods) return methods[p];
        if (p === 'student' && populated) return populated;
        return typeof p === 'string' && !saved(p) ? extra[p] : t[p];
      },
      set: (t, p, v) => {
        if (p === 'student') populated = null;
        if (typeof p === 'string' && !saved(p)) extra[p] = v;
        else if (v === undefined) delete t[p];
        else t[p] = v;
        return true;
      },
    });
    return proxy;
  };
  const query = (name, pick, { single = false } = {}) => {
    let spec = null;
    let cap = null;
    let lean = false;
    const pops = [];
    const run = async () => {
      let list = pick();
      if (spec) list = sorted(list, spec);
      if (cap !== null) list = list.slice(0, cap);
      const out = lean ? list : list.map((r) => docOf(name, r));
      if (!lean) await Promise.all(out.map((d) => Promise.all(pops.map((f) => d.populate(f)))));
      return single ? out[0] || null : out;
    };
    const q = {
      sort: (s) => {
        spec = s;
        return q;
      },
      limit: (n) => {
        cap = n;
        return q;
      },
      select: () => q,
      lean: () => {
        lean = true;
        return q;
      },
      populate: (f) => {
        pops.push(typeof f === 'string' ? f : f.path);
        return q;
      },
      then: (ok, bad) => run().then(ok, bad),
      catch: (bad) => run().catch(bad),
    };
    return q;
  };
  const model = (name) => ({
    find: (f) => query(name, () => rows(name).filter(mtest(f))),
    findOne: (f) => query(name, () => rows(name).filter(mtest(f)).slice(0, 1), { single: true }),
    findById: (id) =>
      query(
        name,
        () =>
          rows(name)
            .filter((d) => String(d._id) === String(id))
            .slice(0, 1),
        { single: true }
      ),
    countDocuments: async (f) => rows(name).filter(mtest(f)).length,
    exists: async (f) => (rows(name).some(mtest(f)) ? { _id: 1 } : null),
    distinct: async (field, f) => {
      const seen = new Map();
      rows(name)
        .filter(mtest(f))
        .forEach((d) => {
          const v = d[field];
          if (v !== undefined && v !== null) seen.set(String(v), v);
        });
      return [...seen.values()];
    },
    aggregate: async (pipeline) => new Aggregator(pipeline, { collectionResolver: (n) => rows(n) }).run(rows(name)),
    create: async (data) => {
      const now = new Date();
      const row = { _id: new ObjectId(), ...(DEFAULTS[name] ? DEFAULTS[name]() : {}), createdAt: now, updatedAt: now };
      Object.entries(data).forEach(([k, v]) => {
        if (v !== undefined) row[k] = v;
      });
      rows(name).push(row);
      return docOf(name, row);
    },
    populate: async () => {},
  });
  const models = {
    WhatsappConversation: model('whatsappconversations'),
    WhatsappMessage: model('whatsappmessages'),
    WhatsappBroadcast: model('whatsappbroadcasts'),
    WhatsappCall: model('whatsappcalls'),
    Students: model('students'),
    User: model('users'),
    Application: model('applications'),
    Documents: model('documents'),
    CourseLevels: model('courselevels'),
  };

  /** make `require` hand back a stand-in for a file of the repo */
  const stub = (relative, exports) => {
    const file = require.resolve(path.join(repo, relative));
    require.cache[file] = { id: file, filename: file, loaded: true, exports, children: [], paths: [] };
  };

  return { store, rows, db, models, stub, mongoose, ObjectId };
};

module.exports = { create };
