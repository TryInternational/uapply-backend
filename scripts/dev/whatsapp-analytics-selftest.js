/* eslint-disable no-console, no-await-in-loop, no-restricted-syntax, global-require, import/no-dynamic-require, no-bitwise, no-inner-declarations, no-loop-func, security/detect-object-injection */
/**
 * End-to-end self-test of the WhatsApp demo data and dashboards, with no
 * database: the real seed script, the real analytics and inbox services and
 * the real rollback run against an in-memory stand-in for MongoDB
 * (scripts/dev/fakeMongo.js), and every dashboard figure is compared with an
 * independent recount of the records (scripts/lib/whatsappRecount.js).
 *
 *   npm i --no-save mingo@6        (once; it is not a dependency of the API)
 *   node scripts/dev/whatsapp-analytics-selftest.js
 *
 * What it walks through
 *   1. an empty inbox — every figure is zero, nothing throws
 *   2. a few "real" chats, including awkward older rows, and the repair script
 *   3. the seed: dry run writes nothing; the real run writes marked rows only
 *   4. dashboard = recount, for Today / 7 days / 30 days
 *   5. inbox = dashboard (the "Needs reply" rule and the wait clock)
 *   6. a chat created, answered, noted, resolved and reopened through the real
 *      service code — the dashboard moves by exactly what happened
 *   7. rollback: the demo rows go, the real chats are untouched, and the
 *      dashboard is back where it was
 *   8. all of it again with the machine in five time zones and with "now"
 *      set to awkward moments (a minute either side of midnight in Kuwait, a
 *      daylight-saving day elsewhere) — the figures must not move
 */
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const REPO = path.join(__dirname, '..', '..');
const ZONES = ['UTC', 'Asia/Kuwait', 'Asia/Kolkata', 'America/Los_Angeles', 'Pacific/Auckland'];
const MOMENTS = [
  ['a weekday afternoon', '2026-11-23T11:20:00Z'],
  ['half a minute after midnight in Kuwait', '2026-11-22T21:00:30Z'],
  ['half a minute before midnight in Kuwait', '2026-11-22T20:59:30Z'],
  ['a daylight-saving day in the US, a Friday night in Kuwait', '2026-03-13T20:15:00Z'],
  ['New Year, 01:30 in Kuwait', '2025-12-31T22:30:00Z'],
];

// ---------------------------------------------------------------------------
// parent: one child per time zone and moment
// ---------------------------------------------------------------------------
function runParent() {
  // --moment=2 runs one of the moments only (1-based)
  const only = Number((process.argv.find((a) => a.startsWith('--moment=')) || '').split('=')[1]) || 0;
  const child = (tz, iso, quiet) =>
    new Promise((resolve) => {
      const p = spawn(process.execPath, [__filename], {
        env: { ...process.env, SELFTEST_CHILD: '1', TZ: tz, FAKE_NOW: iso, QUIET: quiet ? '1' : '' },
      });
      let out = '';
      p.stdout.on('data', (b) => {
        out += b;
      });
      p.stderr.on('data', (b) => {
        out += b;
      });
      p.on('close', (status) => resolve({ tz, out, failed: status !== 0 }));
    });
  (async () => {
    let bad = 0;
    for (const [label, iso] of MOMENTS.filter((_, i) => !only || i === only - 1)) {
      // the machine's time zone must not matter: same data, same figures, in each
      const runs = await Promise.all(ZONES.map((tz, i) => child(tz, iso, i > 0)));
      const prints = runs.map((r) => (r.out.match(/FINGERPRINT (\w+)/) || [])[1]);
      runs.forEach((r, i) => {
        if (i === 0 || r.failed) {
          console.log(`\n=== now = ${label} (${iso}), machine in ${r.tz} ===`);
          console.log(r.out.replace(/FINGERPRINT \w+\n?/, '').trimEnd());
        }
        if (r.failed) bad += 1;
      });
      if (new Set(prints).size === 1 && prints[0])
        console.log(`✓ identical figures with the machine in ${ZONES.join(', ')}`);
      else {
        bad += 1;
        console.log(
          `✗ figures change with the machine's time zone: ${JSON.stringify(runs.map((r, i) => [r.tz, prints[i]]))}`
        );
      }
    }
    console.log(bad ? `\nSELF-TEST FAILED (${bad})` : '\nSELF-TEST PASSED');
    process.exit(bad ? 1 : 0);
  })();
}

// ---------------------------------------------------------------------------
// child: the walk-through itself, at one moment, in one time zone
// ---------------------------------------------------------------------------
function runChild() {
  // "now" stands still at FAKE_NOW, so two runs build exactly the same data
  const RealDate = Date;
  if (process.env.FAKE_NOW) {
    const fixed = new RealDate(process.env.FAKE_NOW).getTime();
    class Clock extends RealDate {
      constructor(...a) {
        if (a.length) super(...a);
        else super(fixed);
      }

      static now() {
        return fixed;
      }
    }
    global.Date = Clock;
  }

  const fake = require('./fakeMongo').create(REPO);
  const { recount, compare, byConversation, waitingSet } = require('../lib/whatsappRecount');

  // fixture ids are counted, not random: the seed reads a person's id to decide
  // how fast they reply, so random ids would give different chats on every run
  let idNo = 0;
  const ObjectId = function FixtureId() {
    idNo += 1;
    return new fake.ObjectId(`f1c7${String(idNo).padStart(20, '0')}`);
  };
  const quiet = !!process.env.QUIET;
  let failures = 0;
  const ok = (cond, label, detail) => {
    if (!cond) failures += 1;
    if (!cond || !quiet) console.log(`${cond ? '  ✓' : '  ✗'} ${label}${!cond && detail ? `\n      ${detail}` : ''}`);
    return cond;
  };
  const section = (t) => !quiet && console.log(`\n${t}`);

  // ---- stand-ins for what the services load besides the models -----------------
  let wamid = 0;
  fake.stub('src/config/config.js', {
    env: 'test',
    mongoose: { url: 'memory', options: {} },
    whatsapp: { phoneNumberId: '700000000000001' },
  });
  fake.stub('src/config/logger.js', { info() {}, warn() {}, error() {}, debug() {} });
  fake.stub('src/models/index.js', fake.models);
  fake.stub('src/thirdparty/index.js', {
    whatsapp: {
      sendText: async () => {
        wamid += 1;
        return { messages: [{ id: `wamid.selftest.${wamid}` }] };
      },
      markRead: async () => {},
    },
  });
  fake.stub('src/thirdparty/firebase.js', {});
  fake.stub('src/services/notifications.services.js', { createWhatsappNotification: async () => {} });
  fake.stub('src/services/roleAccess.service.js', { isAdmin: () => true });

  let disconnected = () => {};
  fake.mongoose.connect = async () => {};
  fake.mongoose.disconnect = async () => disconnected();
  Object.defineProperty(fake.mongoose, 'connection', { value: fake.db, configurable: true });

  const analytics = require(path.join(REPO, 'src/services/whatsappAnalytics.services'));
  const inbox = require(path.join(REPO, 'src/services/whatsapp.services'));
  const io = { to: () => ({ emit() {} }), emit() {} };

  /** run a script of the repo as the command line would, and wait for it to finish */
  const runScript = (file, args) =>
    new Promise((resolve) => {
      const full = require.resolve(path.join(REPO, file));
      delete require.cache[full];
      const { argv, exit } = process;
      const { log, error } = console;
      const lines = [];
      let finished = false;
      // A script that exits early (a refusal) still runs its own error handler
      // afterwards; the stand-ins stay in place a moment so that tail lands here
      // and not in the next run.
      const done = (code) => {
        if (finished) return;
        finished = true;
        setTimeout(() => {
          process.argv = argv;
          process.exit = exit;
          console.log = log;
          console.error = error;
          resolve({ code, out: lines.join('\n') });
        }, 30);
      };
      console.log = (...a) => lines.push(a.join(' '));
      console.error = (...a) => lines.push(a.join(' '));
      process.argv = ['node', full, ...args];
      process.exit = (code) => {
        done(code || 0);
        throw new Error('__exit__');
      };
      disconnected = () => setImmediate(() => done(0));
      try {
        require(full);
      } catch (e) {
        if (e.message !== '__exit__') {
          lines.push(String(e.stack || e));
          done(1);
        }
      }
    });
  process.on('unhandledRejection', (e) => {
    if (!e || e.message !== '__exit__') {
      console.error(e);
      process.exit(1);
    }
  });

  // ---- fixtures: staff, students, their files and applications -------------------
  const mulberry = (seed) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  mulberry(7);
  const H = 3600e3;
  const D = 24 * H;
  const T0 = Date.now();

  const staff = ['Sales One', 'Sales Two', 'Sales Three', 'Sales Four', 'Sales Five', 'Manager One', 'Manager Two'].map(
    (name) => ({ _id: new ObjectId(), name })
  );
  staff.forEach((u) => fake.rows('users').push(u));
  // one of the sales people has left: their account is closed
  staff[4].former = true;
  const sales = staff.slice(0, 5);
  const managers = staff.slice(5);
  const STAGE_COUNTS = { NotApplied: 160, Applied: 140, Enrolled: 70, Lost: 60 };
  const STUDENTS = Object.values(STAGE_COUNTS).reduce((a, b) => a + b, 0);
  let n = 0;
  Object.entries(STAGE_COUNTS).forEach(([stage, count]) => {
    for (let i = 0; i < count; i += 1) {
      n += 1;
      const owner = sales[n % sales.length];
      // every sixth student has one person in both roles: they must count once
      const second = n % 6 === 0 ? owner : managers[n % managers.length];
      const s = {
        _id: new ObjectId(),
        firstName: `Student${n}`,
        lastName: 'Test',
        phoneNo: n % 2 ? `+965 5${String(1000000 + n).slice(0, 3)} ${String(1000000 + n).slice(3)}` : `6${1000000 + n}`,
        stage,
        labels: stage === 'NotApplied' && n % 3 === 0 ? ['Hot'] : [],
        // as on staging: most new enquiries (NotApplied) have nobody assigned yet
        assignedTo:
          n % 23 === 0 || (stage === 'NotApplied' && n % 10 !== 0)
            ? []
            : [
                { user: owner._id, role: 'sales person' },
                { user: second._id, role: 'account manager' },
              ],
        updatedAt: new Date(T0 - n * H),
        createdAt: new Date(T0 - 200 * D),
      };
      fake.rows('students').push(s);
      // …and no files on record
      if (n % 2 === 0 && stage !== 'NotApplied')
        ['passport', 'transcript'].forEach((k) =>
          fake.rows('documents').push({
            _id: new ObjectId(),
            studentId: s._id,
            docTypeKey: k,
            documentType: k,
            blobInfo: [{ blobUrl: `https://files.invalid/${n}-${k}.jpg`, mimeType: 'image/jpeg', fileName: `${k}.jpg` }],
          })
        );
      if (stage !== 'NotApplied')
        fake.rows('applications').push({
          _id: new ObjectId(),
          studentId: s._id,
          institute: { name: `University of Test ${n % 9}` },
          courseName: 'BSc Business',
          createdAt: new Date(T0 - 40 * D),
        });
    }
  });

  /** a few chats that are NOT demo data, some of them awkward on purpose */
  const REAL_CHATS = 6;
  const addRealChats = () => {
    const conv = (data) => {
      const c = {
        _id: new ObjectId(),
        unreadCount: 0,
        status: 'open',
        priority: 'medium',
        tags: [],
        assignees: [],
        ...data,
      };
      fake.rows('whatsappconversations').push(c);
      return c;
    };
    const msg = (c, direction, agoMs, extra = {}) => {
      const t = new Date(T0 - agoMs);
      fake.rows('whatsappmessages').push({
        _id: new ObjectId(),
        conversation: c._id,
        direction,
        type: 'text',
        text: 'x',
        status: 'delivered',
        internal: false,
        timestamp: t,
        createdAt: t,
        updatedAt: t,
        ...extra,
      });
      return t;
    };
    const u = sales[0]._id;
    // a student the seed will not pick (it takes the most recently updated first)
    const st = fake.rows('students')[STUDENTS - 1];
    // answered within the SLA
    const a = conv({
      contact: { phone: '+96560000001', waId: '96560000001', name: 'Real One' },
      student: st._id,
      assignees: [{ userId: u, role: 'sales person' }],
      createdAt: new Date(T0 - 3 * D),
    });
    msg(a, 'inbound', 3 * D);
    a.lastMessageAt = msg(a, 'outbound', 3 * D - 5 * 60e3, { sentByUser: u });
    a.lastMessage = { preview: 'x', at: a.lastMessageAt, direction: 'outbound' };
    a.updatedAt = a.lastMessageAt;
    // waiting, three messages unanswered, the first one two days old
    const b = conv({
      contact: { phone: '+96560000002', waId: '96560000002' },
      student: null,
      createdAt: new Date(T0 - 2 * D),
      unreadCount: 3,
    });
    msg(b, 'inbound', 2 * D);
    msg(b, 'inbound', D);
    b.lastMessageAt = msg(b, 'inbound', 3 * H);
    b.lastMessage = { preview: 'x', at: b.lastMessageAt, direction: 'inbound' };
    b.updatedAt = b.lastMessageAt;
    // resolved before `resolvedAt` existed (only updatedAt to go by), no `student`
    // field at all, and an owner slot with no user in it
    const c = conv({
      contact: { phone: '+96560000003', waId: '96560000003' },
      status: 'resolved',
      assignees: [
        { userId: null, role: 'sales person' },
        { userId: u, role: 'account manager' },
      ],
      createdAt: new Date(T0 - 9 * D),
    });
    delete c.student;
    msg(c, 'inbound', 9 * D);
    c.lastMessageAt = msg(c, 'outbound', 9 * D - 3 * H, { sentByUser: u });
    c.lastMessage = { preview: 'x', at: c.lastMessageAt, direction: 'outbound' };
    c.updatedAt = new Date(T0 - 2 * D);
    // a chat someone started and never wrote in; its follow-up is long past
    conv({
      contact: { phone: '+96560000004', waId: '96560000004' },
      student: null,
      nextFollowUpAt: new Date(T0 - 5 * D),
      assignees: [{ userId: u, role: 'sales person' }],
      createdAt: new Date(T0 - 6 * D),
      updatedAt: new Date(T0 - 6 * D),
    });
    // answered by an automation (no staff member on the reply), with a voice note and a filed document
    const e = conv({
      contact: { phone: '+96560000005', waId: '96560000005' },
      student: st._id,
      createdAt: new Date(T0 - 20 * H),
    });
    msg(e, 'inbound', 20 * H, { type: 'audio', durationSec: 7 });
    msg(e, 'inbound', 19 * H, {
      type: 'document',
      savedDocument: { id: new ObjectId(), label: 'Passport', docTypeKey: 'passport' },
    });
    e.lastMessageAt = msg(e, 'outbound', 18 * H, { type: 'template', template: { name: 'auto_reply', language: 'en' } });
    e.lastMessage = { preview: 'x', at: e.lastMessageAt, direction: 'outbound' };
    e.updatedAt = e.lastMessageAt;
  };

  const data = () => ({
    conversations: fake.rows('whatsappconversations'),
    messages: fake.rows('whatsappmessages'),
    students: fake.rows('students'),
    users: fake.rows('users'),
  });
  const RANGES = ['today', '7d', '30d'];
  const snapshot = async (now = new Date()) => {
    const out = {};
    for (const range of RANGES) {
      const [overview, team] = await Promise.all([analytics.overview(range, now), analytics.team(range, now)]);
      out[range] = { overview, team, diffs: compare({ overview, team }, recount(data(), range, now)) };
    }
    return out;
  };
  const agrees = async (label, now) => {
    const snap = await snapshot(now);
    RANGES.forEach((r) =>
      ok(
        !snap[r].diffs.length,
        `${label} · ${r}: dashboard = recount of the records`,
        snap[r].diffs.slice(0, 6).join('\n      ')
      )
    );
    return snap;
  };
  const HIDE = new Set(['userId', 'conversationId', 'assignee', 'window', 'waitingSec']);
  const stable = (v) => JSON.stringify(v, (key, x) => (HIDE.has(key) ? undefined : x));

  (async () => {
    // 1 ---------------------------------------------------------------------------
    section('1. An empty inbox');
    const empty = await agrees('empty', new Date());
    const ek = empty['30d'].overview.kpis;
    ok(
      Object.values(ek).every((v) => v === 0),
      'every headline figure is 0',
      JSON.stringify(ek)
    );
    ok(
      empty['30d'].overview.messagesByHour.length === 24 &&
        empty['30d'].overview.messagesPerDay.length === 14 &&
        empty['30d'].overview.newConversationsTrend.length === 14 &&
        empty['30d'].overview.waiting.length === 0 &&
        empty['30d'].team.counselors.length === 0,
      'charts keep their shape (24 hours, 14 days), lists are empty'
    );

    // 2 ---------------------------------------------------------------------------
    section('2. Real chats, some of them older or incomplete rows');
    addRealChats();
    await agrees('real chats', new Date());
    // a chat from before this change: the student wrote, staff added a note, and
    // the note set the cached direction to "outbound" — so nothing shows them waiting
    const legacy = {
      _id: new ObjectId(),
      contact: { phone: '+96560000006', waId: '96560000006' },
      student: null,
      assignees: [],
      unreadCount: 0,
      status: 'open',
      priority: 'medium',
      tags: [],
      createdAt: new Date(T0 - 5 * H),
      lastMessageAt: new Date(T0 - 4 * H),
      lastMessage: { preview: '📝 Internal note', at: new Date(T0 - 4 * H), direction: 'outbound' },
      updatedAt: new Date(T0 - 4 * H),
    };
    fake.rows('whatsappconversations').push(legacy);
    [
      ['inbound', 5 * H, false],
      ['outbound', 4 * H, true],
    ].forEach(([direction, agoMs, internal]) =>
      fake.rows('whatsappmessages').push({
        _id: new ObjectId(),
        conversation: legacy._id,
        direction,
        type: 'text',
        text: 'x',
        status: 'delivered',
        internal,
        timestamp: new Date(T0 - agoMs),
      })
    );
    const stale = await snapshot();
    ok(
      stale['30d'].diffs.some((x) => x.startsWith('overview.kpis.waitingForReply')),
      'an older chat whose note hid a waiting student is caught: the records say 2 waiting, the dashboard 1'
    );
    const repDry = await runScript('scripts/repair-whatsapp-conversation-cache.js', ['--env=staging']);
    ok(
      repDry.code === 0 && legacy.lastMessage.direction === 'outbound' && /1 with a cached direction/.test(repDry.out),
      'the repair script lists it and, as a dry run, changes nothing',
      repDry.out.slice(-300)
    );
    const rep = await runScript('scripts/repair-whatsapp-conversation-cache.js', [
      '--env=staging',
      '--confirm=upply_staging',
    ]);
    ok(
      rep.code === 0 && legacy.lastMessage.direction === 'inbound' && legacy.lastMessage.preview === '📝 Internal note',
      'run for real, it corrects that one field',
      rep.out.slice(-300)
    );
    const realConvs = JSON.stringify(fake.rows('whatsappconversations'));
    const realMsgs = JSON.stringify(fake.rows('whatsappmessages'));
    const before = await agrees('after the repair', new Date());
    ok(before['30d'].overview.kpis.followUpsOverdue === 1, 'a chat with no follow-up date is not overdue (1 chat has one)');
    const firstRow = before['30d'].team.counselors.find((c) => c.name === 'Sales One');
    ok(
      firstRow && firstRow.followUpsOverdue === 1 && firstRow.unlinked === 1 && firstRow.openConversations === 2,
      "the same on the person's row (2 open, 1 overdue, 1 not in the CRM)",
      JSON.stringify(firstRow)
    );
    ok(before['30d'].overview.kpis.resolved === 1, 'a chat resolved before the date was recorded counts by its last change');
    const longest = before['30d'].overview.waiting[0];
    ok(
      longest && longest.unanswered === 3 && Math.abs(longest.waitingSec - 2 * 86400) < 120,
      'the wait runs from the first unanswered message (2 days, 3 messages), not the latest',
      JSON.stringify(longest)
    );

    // 3 ---------------------------------------------------------------------------
    section('3. The seed');
    const dry = await runScript('scripts/seed-whatsapp-demo.js', ['--env=staging']);
    ok(
      dry.code === 0 && JSON.stringify(fake.rows('whatsappconversations')) === realConvs,
      'a dry run writes nothing',
      dry.out.slice(-600)
    );
    const wrong = await runScript('scripts/seed-whatsapp-demo.js', ['--env=staging', '--confirm=production']);
    ok(
      wrong.code === 1 && JSON.stringify(fake.rows('whatsappconversations')) === realConvs,
      'the wrong database name is refused'
    );
    const seeded = await runScript('scripts/seed-whatsapp-demo.js', ['--env=staging', '--confirm=upply_staging']);
    ok(seeded.code === 0, 'the seed runs', seeded.out.slice(-900));
    if (!quiet)
      console.log(
        seeded.out
          .split('\n')
          .filter((l) => /^Planned|^ {2}(chats|messages|broadcasts)|^Written/.test(l))
          .map((l) => `    ${l}`)
          .join('\n')
      );
    const convs = fake.rows('whatsappconversations');
    const msgs = fake.rows('whatsappmessages');
    const demo = convs.filter((c) => (c.tags || []).includes('demo'));
    const demoIds = new Set(demo.map((c) => String(c._id)));
    const threads = byConversation(msgs);
    const realOf = (c) => (threads.get(String(c._id)) || []).filter((m) => !m.internal);
    ok(demo.length >= 180, `${demo.length} demo chats, each tagged "demo"`);
    const studentPhones = new Set(fake.rows('students').map((st) => st.phoneNo.replace(/\D/g, '').slice(-8)));
    ok(
      demo.every((c) => /^\+9650\d{7}$/.test(c.contact.phone) && !studentPhones.has(c.contact.waId.slice(-8))),
      'no demo chat carries a real number (all +965 0…, which cannot exist): a reply typed into one reaches nobody'
    );
    const closed = String(staff[4]._id);
    ok(
      msgs.every((x) => !demoIds.has(String(x.conversation)) || String(x.sentByUser || '') !== closed) &&
        demo.every((c) => c.assignees.every((a) => String(a.userId) !== closed)),
      'nobody whose account is closed writes in, or is assigned, a demo chat'
    );
    const waits = waitingSet(demo, threads).map((w) => (Date.now() - w.since.getTime()) / 3600e3);
    ok(
      waits.length > 12 && Math.max(...waits) < 6 * 24 && waits.filter((h) => h < 30).length / waits.length > 0.6,
      `${waits.length} demo chats are waiting, the longest ${Math.round(
        Math.max(...waits)
      )} hours, most since yesterday or today`,
      JSON.stringify(
        waits
          .map((h) => Math.round(h))
          .sort((a, b) => b - a)
          .slice(0, 12)
      )
    );
    const leads = demo.filter((c) => {
      const st = c.student && fake.rows('students').find((x) => String(x._id) === String(c.student));
      return st && st.stage === 'NotApplied';
    });
    ok(
      leads.length >= 60 && leads.every((c) => c.assignees.length > 0),
      `${leads.length} chats are new enquiries (most of them students nobody owns yet, lent a working sales person on the chat)`
    );
    ok(convs.length - demo.length === REAL_CHATS, `the ${REAL_CHATS} real chats are still there and not tagged`);
    ok(
      msgs.every((m) => m.timestamp.getTime() <= Date.now()),
      'no message is dated in the future'
    );
    ok(
      demo.every((c) => c.createdAt <= c.lastMessageAt && c.lastMessageAt.getTime() <= Date.now()),
      'every chat starts before it ends'
    );
    ok(
      demo.every((c) => {
        const t = threads.get(String(c._id));
        return t && t[0].internal && /Demo chat/.test(t[0].text);
      }),
      'every demo chat opens with the note that says it is seeded'
    );
    ok(
      demo.every((c) => {
        const real = realOf(c);
        const last = real[real.length - 1];
        let tr = 0;
        for (let i = real.length - 1; i >= 0 && real[i].direction === 'inbound'; i -= 1) tr += 1;
        return c.lastMessage.direction === last.direction && c.unreadCount <= tr;
      }),
      "each chat's last direction and unread count follow from its messages"
    );
    ok(
      demo.filter((c) => c.status === 'resolved').every((c) => c.resolvedAt && c.unreadCount === 0 && !c.nextFollowUpAt),
      'resolved chats carry the date, no unread, no follow-up'
    );
    const casts = fake.rows('whatsappbroadcasts');
    ok(
      casts.length > 0 && casts.every((b) => b.status === 'completed' && b.audience.demo),
      `${casts.length} broadcasts, all finished (none queued — a queued one would be SENT by the server)`
    );
    ok(
      casts.every(
        (b) =>
          b.recipientCount === b.recipients.length &&
          Object.values(b.counters).reduce((a, x) => a + x, 0) === b.recipients.length &&
          b.recipients.every((r) => {
            const m = msgs.find((x) => String(x._id) === String(r.message));
            return (
              m && String(m.broadcast) === String(b._id) && m.status === r.status && demoIds.has(String(m.conversation))
            );
          })
      ),
      "each broadcast's counters equal its recipients' message statuses"
    );
    const kinds = (f) => msgs.filter((m) => demoIds.has(String(m.conversation)) && f(m)).length;
    ok(
      kinds((m) => m.type === 'audio') > 5 &&
        kinds((m) => m.type === 'image') > 5 &&
        kinds((m) => m.type === 'document') > 3 &&
        kinds((m) => m.type === 'template') > 10 &&
        kinds((m) => m.status === 'failed') > 0 &&
        kinds((m) => /[؀-ۿ]/.test(m.text || '')) > 5,
      'voice notes, photos, files, templates, failed sends and Arabic messages are all there',
      JSON.stringify({
        audio: kinds((m) => m.type === 'audio'),
        image: kinds((m) => m.type === 'image'),
        document: kinds((m) => m.type === 'document'),
        template: kinds((m) => m.type === 'template'),
        failed: kinds((m) => m.status === 'failed'),
        arabic: kinds((m) => /[؀-ۿ]/.test(m.text || '')),
      })
    );
    const hours = Array.from({ length: 24 }, () => 0);
    msgs
      .filter((m) => demoIds.has(String(m.conversation)) && !m.internal)
      .forEach((m) => {
        hours[new RealDate(m.timestamp.getTime() + 3 * H).getUTCHours()] += 1;
      });
    const all = hours.reduce((a, b) => a + b, 0);
    const office = hours.slice(9, 23).reduce((a, b) => a + b, 0);
    ok(
      office / all > 0.8,
      `messages fall in Kuwait working hours (${Math.round((100 * office) / all)}% between 09:00 and 23:00 Kuwait time)`
    );
    const again = await runScript('scripts/seed-whatsapp-demo.js', ['--env=staging', '--confirm=upply_staging']);
    ok(again.code === 1 && fake.rows('whatsappconversations').length === convs.length, 'seeding twice is refused');

    // 4 ---------------------------------------------------------------------------
    section('4. Dashboard against the records');
    const after = await agrees('with demo data', new Date());
    const k = after['30d'].overview.kpis;
    ok(
      k.waitingForReply > 12 &&
        k.conversationsHandled > 100 &&
        k.lateReplies > 0 &&
        k.resolved > 20 &&
        k.followUpsOverdue > 5 &&
        k.templatesSent > 20 &&
        k.voiceReceived > 0 &&
        k.voiceSent > 0 &&
        k.docsFiled > 0,
      'the 30-day figures are all populated',
      JSON.stringify(k)
    );
    const slowest = Math.max(...after['30d'].team.counselors.map((c) => c.avgResponseSec));
    ok(
      k.avgResponseSec > 4 * 60 && k.avgResponseSec < 30 * 60 && slowest < 90 * 60,
      `first reply: ${Math.round(k.avgResponseSec / 60)} minutes on average over 30 days, ${
        k.lateReplies
      } late; the slowest person averages ${Math.round(slowest / 60)} minutes`
    );
    const total = (r) => after[r].overview.kpis.messagesTotal;
    ok(
      total('7d') > total('today') && total('30d') > total('7d'),
      `the range changes the figures (messages: today ${total('today')}, 7 days ${total('7d')}, 30 days ${total('30d')})`
    );
    ok(
      after['30d'].team.counselors.length >= 5 && after['30d'].team.counselors.every((c) => c.name !== 'Unknown'),
      `${after['30d'].team.counselors.length} people on the team table, all named`
    );
    ok(
      after['30d'].overview.messagesPerDay.filter((d) => d.sent + d.received > 0).length >= 13,
      'the 14-day chart has messages on (nearly) every day'
    );
    ok(after['30d'].overview.funnel.filter((f) => f.count > 0).length >= 4, 'the chat-to-student funnel has every stage');

    // 5 ---------------------------------------------------------------------------
    section('5. Inbox against dashboard');
    const chip = convs.filter((c) => c.lastMessage && c.lastMessage.direction === 'inbound' && c.status !== 'resolved');
    ok(
      chip.length === k.waitingForReply,
      `the inbox's "Needs reply" chip (${chip.length}) = the dashboard's waiting count (${k.waitingForReply})`
    );
    const unread = convs.filter((c) => c.status !== 'resolved').reduce((a, c) => a + c.unreadCount, 0);
    ok(unread === k.unread, `unread across the open chats (${unread}) = the dashboard's (${k.unread})`);
    const expectWait = new Map(waitingSet(convs, byConversation(msgs)).map((w) => [String(w.conv._id), w]));
    let dtoOk = true;
    for (const c of chip.slice(0, 40)) {
      const dto = await inbox.getConversation(c._id);
      const w = expectWait.get(String(c._id));
      if (!w || dto.waitingSince !== w.since.toISOString() || dto.unanswered !== w.unanswered) dtoOk = false;
    }
    ok(dtoOk, 'each waiting chat the inbox opens carries the same wait start and unanswered count the dashboard uses');
    const answered = convs.find((c) => c.lastMessage && c.lastMessage.direction === 'outbound');
    ok((await inbox.getConversation(answered._id)).waitingSince === null, 'an answered chat has no wait');
    const fingerprint = crypto
      .createHash('sha1')
      .update(stable(RANGES.map((r) => [after[r].overview, after[r].team])))
      .digest('hex')
      .slice(0, 12);

    // 6 ---------------------------------------------------------------------------
    section('6. A chat created, answered, noted, resolved and reopened through the service code');
    const user = sales[1];
    const kp = async () => {
      const now = new Date();
      const [overview, team] = await Promise.all([analytics.overview('30d', now), analytics.team('30d', now)]);
      return { overview, team, diffs: compare({ overview, team }, recount(data(), '30d', now)) };
    };
    const d = (a, b, key) => a.overview.kpis[key] - b.overview.kpis[key];
    const mine = (snap) => snap.team.counselors.find((c) => c.userId === String(user._id)) || {};
    const same = (snap, label = 'dashboard = recount') =>
      ok(!snap.diffs.length, label, snap.diffs.slice(0, 4).join('\n      '));
    const base = await kp();
    const inboundAt = Math.floor((Date.now() - 20 * 60e3) / 1000);
    const payload = (phoneNumberId, id, body, ts, from = '96500000777', name = 'Selftest Contact') => ({
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: phoneNumberId },
                contacts: [{ profile: { name }, wa_id: from }],
                messages: [{ from, id, timestamp: String(ts), type: 'text', text: { body } }],
              },
            },
          ],
        },
      ],
    });
    await inbox.processWebhook(
      io,
      payload('123456123', 'ABGGFlA5Fpa', 'this is a text message', 1504902988, '16315551181', 'test user name')
    );
    const sample = await kp();
    ok(
      stable(sample.overview.kpis) === stable(base.overview.kpis) &&
        !fake.rows('whatsappconversations').some((c) => c.contact.waId === '16315551181'),
      'Meta\'s sample "Test" webhook (another number, dated 2017) is not stored'
    );
    await inbox.processWebhook(io, payload('700000000000001', 'wamid.selftest.in1', 'Hello, is anyone there?', inboundAt));
    await inbox.processWebhook(io, payload('700000000000001', 'wamid.selftest.in2', 'I want to apply', inboundAt + 60));
    const created = fake.rows('whatsappconversations').find((c) => c.contact.waId === '96500000777');
    let s1 = await kp();
    ok(
      !!created &&
        d(s1, base, 'openConversations') === 1 &&
        d(s1, base, 'waitingForReply') === 1 &&
        d(s1, base, 'unread') === 2 &&
        d(s1, base, 'messagesReceived') === 2 &&
        d(s1, base, 'newConversations') === 1 &&
        d(s1, base, 'unlinked') === 1 &&
        d(s1, base, 'conversationsHandled') === 0,
      'created by two inbound messages: +1 open, +1 waiting, +2 unread, +2 received, +1 new, +1 not in the CRM'
    );
    same(s1);
    const dto1 = await inbox.getConversation(created._id);
    ok(
      dto1.unanswered === 2 && Math.abs(Date.now() - new Date(dto1.waitingSince).getTime() - 20 * 60e3) < 5000,
      'its wait is 20 minutes, 2 messages unanswered'
    );

    await inbox.addNote(io, created._id, 'Looks like a new lead', [], user);
    let s2 = await kp();
    ok(
      d(s2, s1, 'waitingForReply') === 0 &&
        d(s2, s1, 'messagesTotal') === 0 &&
        d(s2, s1, 'conversationsHandled') === 0 &&
        created.lastMessage.direction === 'inbound' &&
        created.lastMessage.preview === '📝 Internal note',
      'an internal note changes nothing: the student is still waiting, and the wait has not restarted'
    );
    same(s2);

    await inbox.updateConversationMeta(created._id, {
      tags: ['demo', 'selftest'],
      nextFollowUpAt: new Date(Date.now() - H),
    });
    created.assignees = [
      { userId: user._id, role: 'sales person' },
      { userId: user._id, role: 'account manager' },
    ];
    s1 = await kp();
    ok(
      d(s1, s2, 'followUpsOverdue') === 1 &&
        mine(s1).pending - mine(s2).pending === 1 &&
        mine(s1).openConversations - mine(s2).openConversations === 1 &&
        mine(s1).followUpsOverdue - mine(s2).followUpsOverdue === 1 &&
        mine(s1).unlinked - mine(s2).unlinked === 1,
      'owned by one person in two roles, follow-up an hour ago: +1 overdue; +1 (not +2) pending / open / overdue / not-in-CRM on their row'
    );
    same(s1);

    await inbox.sendText(io, created._id, 'Hello! Yes — how can we help?', 'ref-1', user);
    await inbox.markRead(created._id);
    s2 = await kp();
    ok(
      d(s2, s1, 'waitingForReply') === -1 &&
        d(s2, s1, 'messagesSent') === 1 &&
        d(s2, s1, 'conversationsHandled') === 1 &&
        d(s2, s1, 'lateReplies') === 1 &&
        d(s2, s1, 'unread') === -2 &&
        mine(s2).messagesSent - mine(s1).messagesSent === 1 &&
        mine(s2).lateReplies - mine(s1).lateReplies === 1 &&
        mine(s2).pending - mine(s1).pending === -1,
      'answered after 20 minutes and read: −1 waiting, +1 sent, +1 handled, +1 late reply, −2 unread — and on the row of the person who replied'
    );
    same(s2);

    await inbox.updateConversationMeta(created._id, { status: 'resolved' });
    s1 = await kp();
    ok(
      d(s1, s2, 'openConversations') === -1 &&
        d(s1, s2, 'resolved') === 1 &&
        d(s1, s2, 'followUpsOverdue') === -1 &&
        d(s1, s2, 'unlinked') === -1 &&
        !!created.resolvedAt,
      'resolved: −1 open, +1 resolved, and it leaves the overdue and not-in-CRM counts'
    );
    same(s1);
    await inbox.updateConversationMeta(created._id, { status: 'open' });
    s2 = await kp();
    ok(
      d(s2, s1, 'openConversations') === 1 && d(s2, s1, 'resolved') === -1 && !created.resolvedAt,
      'reopened: back in the open chats, no longer counted as resolved'
    );
    same(s2);

    // 7 ---------------------------------------------------------------------------
    section('7. Rollback');
    const rbDry = await runScript('scripts/seed-whatsapp-demo.js', ['--env=staging', '--rollback']);
    ok(rbDry.code === 0 && fake.rows('whatsappconversations').length === convs.length, 'a rollback dry run removes nothing');
    const rb = await runScript('scripts/seed-whatsapp-demo.js', ['--env=staging', '--confirm=upply_staging', '--rollback']);
    ok(rb.code === 0, 'the rollback runs', rb.out.slice(-600));
    if (!quiet)
      console.log(
        rb.out
          .split('\n')
          .filter((l) => /^removed|^left/.test(l))
          .map((l) => `    ${l}`)
          .join('\n')
      );
    ok(
      JSON.stringify(fake.rows('whatsappconversations')) === realConvs &&
        JSON.stringify(fake.rows('whatsappmessages')) === realMsgs,
      'the real chats and their messages are exactly as they were; every demo row (and the test chat, tagged "demo") is gone',
      (() => {
        const was = JSON.parse(realConvs);
        const is = JSON.parse(JSON.stringify(fake.rows('whatsappconversations')));
        const i = was.findIndex((c, x) => JSON.stringify(c) !== JSON.stringify(is[x]));
        return i < 0 ? 'messages differ' : `was ${JSON.stringify(was[i])}\n      is  ${JSON.stringify(is[i])}`;
      })()
    );
    ok(!fake.rows('leads').length && !fake.rows('whatsappbroadcasts').length, 'demo leads and broadcasts are gone');
    ok(fake.rows('students').length === STUDENTS, 'students were never written to');
    const back = await agrees('after rollback', new Date());
    const bk = back['30d'].overview.kpis;
    const b0 = before['30d'].overview.kpis;
    ok(
      bk.openConversations === b0.openConversations &&
        bk.waitingForReply === b0.waitingForReply &&
        bk.messagesTotal === b0.messagesTotal &&
        bk.unread === b0.unread,
      'the dashboard is back to the real chats only'
    );
    const reseed = await runScript('scripts/seed-whatsapp-demo.js', ['--env=staging', '--confirm=upply_staging']);
    ok(reseed.code === 0 && fake.rows('whatsappconversations').length > 180, 'and the seed can be run again');

    console.log(failures ? `\n${failures} check(s) failed` : `${quiet ? '' : '\nall checks passed'}`);
    console.log(`FINGERPRINT ${fingerprint}`);
    process.exit(failures ? 1 : 0);
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

if (process.env.SELFTEST_CHILD) runChild();
else runParent();
