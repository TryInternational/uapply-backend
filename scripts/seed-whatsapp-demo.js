/* eslint-disable no-console, no-await-in-loop, no-restricted-syntax, no-continue, no-bitwise, no-nested-ternary */
/**
 * Demo WhatsApp chats on STAGING, linked to real (Trello-imported) students, so
 * the team can see how the inbox, the student record, documents and
 * applications connect: 10 scripted chats across every stage, ~120 more seeded
 * ones spread over the counsellors, the hours of the day and the last 30 days
 * (so the dashboards read like a working inbox), plus 10 numbers the CRM
 * doesn't know yet (four are leads → "Convert to student", the rest →
 * "Add as student").
 *
 *   node scripts/seed-whatsapp-demo.js --env=staging
 *       dry run: prints which students it would use and what it would write
 *   node scripts/seed-whatsapp-demo.js --env=staging --confirm=upply_staging
 *       writes the chats (database rows only — nothing is sent to WhatsApp or Slack)
 *   node scripts/seed-whatsapp-demo.js --env=staging --confirm=upply_staging --rollback
 *       removes everything this script added (tag "demo" / marker on the lead)
 *
 * Every chat carries the tag "demo" and opens with an internal note saying it
 * is seeded, so nobody mistakes it for a real exchange.
 */
const path = require('path');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.length ? v.join('=') : true];
  })
);
if (args.env !== 'staging') {
  console.error('This script only runs against staging: add --env=staging');
  process.exit(1);
}
process.env.APP_ENV = 'staging';
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

const mongoose = require('mongoose');
// eslint-disable-next-line import/no-dynamic-require
const config = require(path.join(__dirname, '..', 'src', 'config', 'config'));

const DEMO_TAG = 'demo';
const LEAD_MARK = 'demo://whatsapp-inbox-seed';
const H = 3600 * 1000;
const D = 24 * H;
const now = Date.now();
const ago = (ms) => new Date(now - ms);
const digits = (p) => String(p || '').replace(/\D/g, '');
const mask = (p) => String(p || '').replace(/\d(?=\d{3})/g, 'x');
const oid = (x) => (x && x._id ? x._id : x);

/** "+965 5123 4567" / "51234567" → "+96551234567" (Kuwait when there is no country code) */
const e164 = (p) => {
  let d = digits(p);
  if (d.length === 8) d = `965${d}`;
  return `+${d}`;
};

const at = (hour, minute = 0, dayOffset = 0) => {
  const d = new Date(now + dayOffset * D);
  d.setHours(hour, minute, 0, 0);
  return d;
};
const nextMonday = () => {
  const d = new Date(now);
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  d.setHours(10, 0, 0, 0);
  return d;
};

// ---------------------------------------------------------------------------
// Scenarios. `m` builds messages: in(text, agoMs) · out(text, agoMs) ·
// note(text, agoMs) · tpl(name, text, agoMs) · file(doc, agoMs, filed)
// ---------------------------------------------------------------------------
const SCENARIOS = [
  {
    key: 'hot-1',
    pick: { stage: 'NotApplied', labels: 'Hot', wantDoc: 'passport' },
    priority: 'high',
    tags: ['Sep 2026'],
    followUp: () => at(10, 0, 1),
    thread: (m, s) => [
      m.in(
        `Hi, I got your number from my cousin. I want to study ${
          s.course || 'business'
        } in the UK, September intake. What do I need?`,
        2 * H + 20 * 60e3
      ),
      m.out(
        `Welcome ${s.first}! I'm ${s.counsellor} from ULearn. Could you send your passport and your latest transcript here? Then I'll shortlist universities for you.`,
        2 * H + 5 * 60e3
      ),
      m.file(s.doc, 90 * 60e3, true),
      m.in('Sent. Also, is IELTS required? I have 6.0', 30 * 60e3),
      m.note('Very keen — the cousin is an existing student. Call before 6pm.', 25 * 60e3),
    ],
    unread: 1,
  },
  {
    key: 'hot-2',
    pick: { stage: 'NotApplied', labels: 'Hot', wantDoc: 'transcript' },
    priority: 'high',
    tags: ['Foundation'],
    followUp: () => at(17, 0, -1), // overdue
    thread: (m, s) => [
      m.in("Salam, I'm interested in a foundation year in business. Which universities do you work with?", 2 * D),
      m.out(
        `Wa alaikum salam ${s.first}! Several — it depends on your grades. Can you send your transcript so I can check the entry requirements?`,
        2 * D - 15 * 60e3
      ),
      m.file(s.doc, D + 3 * H, false),
      m.out("Got it, I'll check the requirements and come back to you today.", D + 2 * H),
    ],
    unread: 0,
  },
  {
    key: 'hot-3',
    pick: { stage: 'NotApplied', labels: 'Hot' },
    priority: 'medium',
    tags: ['UK', 'Fees'],
    thread: (m, s) => [
      m.in('Can you send me the fees for Coventry?', 3 * D + 2 * H),
      m.out(
        `Sure ${s.first} — tuition is £16,800 a year for most undergraduate courses, scholarships of up to £3,000 are available. I'll send the full sheet.`,
        3 * D + 90 * 60e3
      ),
      m.tpl(
        'fees_follow_up',
        `Hi ${s.first}, following up on the fee sheet we sent — any questions? Reply here and I'll help.`,
        D
      ),
    ],
    unread: 0,
  },
  {
    key: 'applied-offer',
    pick: { stage: 'Applied', wantApp: true },
    priority: 'medium',
    tags: ['Offer'],
    thread: (m, s) => [
      m.out(
        `Good news ${s.first} — ${s.uni || 'the university'} has issued your offer for ${
          s.course || 'your course'
        }! The offer letter is on your record. Next step: the deposit and the CAS documents.`,
        D + 4 * H
      ),
      m.in("Alhamdulillah! What's the deadline for the deposit?", D + 3 * H),
      m.out("It's 15 December. I'll send the bank details and the amount this afternoon.", D + 2 * H),
      m.in('Thank you 🙏', 40 * 60e3),
      m.note('Offer letter filed under Documents. Waiting for the deposit.', 35 * 60e3),
    ],
    unread: 1,
  },
  {
    key: 'applied-cas',
    pick: { stage: 'Applied', wantApp: true, wantDoc: 'passport' },
    priority: 'medium',
    tags: ['CAS'],
    followUp: nextMonday,
    thread: (m, s) => [
      m.out(
        `Hi ${s.first}, for your CAS ${
          s.uni ? `from ${s.uni} ` : ''
        }we need: a TB test certificate, a bank statement covering 28 days, and a copy of your passport. You can send them here.`,
        2 * D
      ),
      m.file(s.doc, 2 * D - 2 * H, true),
      m.in('TB test is booked for Monday.', 2 * D - 100 * 60e3),
      m.out('Perfect. Send the bank statement whenever it is ready.', 2 * D - 95 * 60e3),
    ],
    unread: 0,
  },
  {
    key: 'applied-waiting',
    pick: { stage: 'Applied', wantApp: true },
    priority: 'high',
    tags: ['Chase uni'],
    thread: (m, s) => [
      m.out(
        `Hi ${s.first}, your application to ${s.uni || 'the university'} went in on time. Decisions usually take 2–4 weeks.`,
        20 * D
      ),
      m.in(`Any update from ${s.uni || 'the university'}? It's been 3 weeks 😕`, 70 * 60e3),
      m.note(
        `Chased the university on ${new Date(now - 2 * D).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
        })}; no decision yet.`,
        60 * 60e3
      ),
    ],
    unread: 1,
  },
  {
    key: 'applied-visa',
    pick: { stage: 'Applied', wantApp: true },
    priority: 'low',
    tags: ['Visa'],
    status: 'resolved',
    thread: (m, s) => [
      m.in('Received the visa! Thank you so much', 4 * D),
      m.out(
        `Congratulations ${s.first}! 🎉 The pre-departure briefing is on Thursday — I'll send the invite.`,
        4 * D - 20 * 60e3
      ),
    ],
    unread: 0,
  },
  {
    key: 'enrolled-arrived',
    pick: { stage: 'Enrolled', wantApp: true },
    priority: 'low',
    tags: ['Arrived'],
    status: 'resolved',
    thread: (m, s) => [
      m.in(`Reached ${s.uni ? s.uni.replace(/^University of /i, '') : 'the city'} safely. Induction is tomorrow.`, 9 * D),
      m.out('Wonderful! Keep in touch and send a photo from campus 😊', 9 * D - 30 * 60e3),
    ],
    unread: 0,
  },
  {
    key: 'enrolled-referral',
    pick: { stage: 'Enrolled' },
    priority: 'medium',
    tags: ['Referral'],
    thread: (m, s) => [
      m.in('My friend wants to apply for January. Can I share your number?', 6 * H),
      m.out(`Of course ${s.first}! Ask them to message me here and I'll take it from there.`, 5 * H + 40 * 60e3),
    ],
    unread: 0,
  },
  {
    key: 'lost',
    pick: { stage: 'Lost' },
    priority: 'low',
    tags: [],
    status: 'resolved',
    thread: (m, s) => [
      m.tpl(
        'paused_application',
        `Hi ${s.first}, we noticed you paused your application. If you'd like to pick it up again, just reply here.`,
        12 * D
      ),
      m.in('I decided to study locally. Thanks for your help.', 11 * D),
      m.out("Understood — all the best. We're here if plans change.", 11 * D - 10 * 60e3),
    ],
    unread: 0,
  },
];

const UNLINKED = [
  {
    key: 'new-lead',
    profileName: 'Noor',
    phone: '+96599990001',
    priority: 'medium',
    assign: false, // lands in "Unassigned"
    lead: {
      fullname: 'Noor Al-Sabah',
      degree: { en_name: 'Masters', name: 'Masters' },
      destination: { en_name: 'United Kingdom', name: 'United Kingdom' },
      subjects: 'Data Science',
      status: 'Sent Whatsapp',
    },
    thread: (m) => [m.in("Hello, I filled the form on your website for a master's in the UK. Can we talk?", 20 * 60e3)],
    unread: 1,
  },
  {
    key: 'new-unknown',
    profileName: 'Yousef',
    phone: '+96599990002',
    priority: 'medium',
    assign: true,
    thread: (m) => [
      m.in('Hi, is this ULearn? I want to apply for a diploma in Australia.', 7 * 60e3),
      m.in('I graduated last year with 82%.', 5 * 60e3),
    ],
    unread: 2,
  },
  {
    key: 'new-lead-2',
    profileName: 'Fatima',
    phone: '+96599990003',
    priority: 'high',
    assign: true,
    lead: {
      fullname: 'Fatima Al-Rashid',
      degree: { en_name: 'Bachelor', name: 'Bachelor' },
      destination: { en_name: 'Australia', name: 'Australia' },
      subjects: 'Nursing',
      status: 'Sent Whatsapp',
    },
    thread: (m) => [
      m.in('Hi, I saw your ad on Instagram about nursing in Australia.', 3 * H),
      m.out(
        'Hi Fatima! Yes — nursing degrees in Australia start in February and July. Which year did you finish school?',
        3 * H - 12 * 60e3
      ),
      m.in("Last year. What's the total cost?", 40 * 60e3),
    ],
    unread: 1,
  },
  {
    key: 'new-unknown-2',
    profileName: 'Abdullah',
    phone: '+96599990004',
    priority: 'medium',
    assign: false,
    thread: (m) => [
      m.in('Assalamu alaikum, do you have scholarships for engineering in the UK?', D + 2 * H),
      m.out(
        'Wa alaikum salam! Yes, several universities give 15–30% for strong grades. Could you send your transcript?',
        D + 1.5 * H
      ),
      m.in('Ok I will send my transcript', 5 * H),
    ],
    unread: 1,
  },
  {
    key: 'new-unknown-3',
    profileName: 'Mariam',
    phone: '+96599990005',
    priority: 'low',
    assign: true,
    thread: (m) => [m.in('Hello? Is this ULearn?', 2 * D)],
    unread: 1,
  },
  {
    key: 'new-lead-3',
    profileName: 'Hamad',
    phone: '+96599990006',
    priority: 'medium',
    assign: true,
    lead: {
      fullname: 'Hamad Al-Mutairi',
      degree: { en_name: 'Masters', name: 'Masters' },
      destination: { en_name: 'Ireland', name: 'Ireland' },
      subjects: 'Business Analytics',
      status: 'New',
    },
    thread: (m) => [
      m.in("Hi, I registered on your site for a master's in Ireland. Is September still possible?", 6 * H),
      m.out(
        'Hi Hamad! September is possible if we apply this month. Do you have your degree certificate and transcript ready?',
        6 * H - 20 * 60e3
      ),
      m.in('Yes, both. Also an IELTS 6.5 from last year.', 90 * 60e3),
    ],
    unread: 1,
  },
  {
    key: 'new-unknown-4',
    profileName: 'Dana',
    phone: '+96599990007',
    priority: 'medium',
    assign: true,
    thread: (m) => [
      m.in('Do you do IELTS preparation classes?', 3 * D + 2 * H),
      m.out('We book the test and have partner tutors for preparation. When would you like to sit it?', 3 * D + 90 * 60e3),
      m.in('Maybe December. How much is the test?', 3 * D + H),
      m.out('KD 75 for the academic test. I can hold a December date for you — shall I?', 3 * D + 50 * 60e3),
    ],
    unread: 0,
  },
  {
    key: 'new-lead-4',
    profileName: 'Khalid',
    phone: '+96599990008',
    priority: 'high',
    assign: false,
    lead: {
      fullname: 'Khalid Al-Enezi',
      degree: { en_name: 'Foundation', name: 'Foundation' },
      destination: { en_name: 'United Kingdom', name: 'United Kingdom' },
      subjects: 'Engineering',
      status: 'New',
    },
    thread: (m) => [
      m.in('Salam, my son finished grade 12 with 85%. We want a foundation year in the UK for engineering.', 2 * H),
      m.in('Which cities do you recommend?', 100 * 60e3),
    ],
    unread: 2,
  },
  {
    key: 'new-unknown-5',
    profileName: 'Sara',
    phone: '+96599990009',
    priority: 'low',
    assign: true,
    thread: (m) => [m.in('Hi, do you have offices in Salmiya?', 3 * D)],
    unread: 1,
  },
  {
    key: 'new-unknown-6',
    profileName: 'Omar',
    phone: '+96599990010',
    priority: 'low',
    assign: true,
    thread: (m) => [
      m.in('Do you send students to Canada?', 5 * D),
      m.out(
        "Not at the moment — we work with the UK, Ireland and Australia. Happy to compare them for you if you're open to it.",
        5 * D - 25 * 60e3
      ),
      m.in('Ok thanks, I will think about it.', 5 * D - H),
      m.out('Sure, Omar. Message me any time.', 5 * D - 50 * 60e3),
    ],
    unread: 0,
  },
];

// ---------------------------------------------------------------------------
// Bulk chats — a seeded spread across stages, counsellors, hours and the last
// 14 days, so the dashboards (team table, busy hours, per-day bars, funnel)
// read like a working inbox. Same seed → same plan on every run.
// ---------------------------------------------------------------------------
const BULK = { NotApplied: 40, Applied: 44, Enrolled: 20, Lost: 16 };

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
const rng = mulberry(20261105);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const chance = (pr) => rng() < pr;
const between = (lo, hi) => lo + rng() * (hi - lo);

const POOL = {
  NotApplied: {
    in: [
      'Hi, I want to study abroad. What are the options?',
      'Do you have universities in the UK for computer science?',
      'What are the fees for a foundation year?',
      'Is IELTS required?',
      'Can I apply for the January intake?',
      'My friend studied with you. Can you help me too?',
      'Which is cheaper, the UK or Australia?',
      'Do you help with the visa as well?',
      'What documents do I need to start?',
      'Can we meet at your office this week?',
      'I have 78% in grade 12. Is that enough?',
      'How long does the application take?',
    ],
    out: [
      'Hi {first}! Happy to help. Which subject and which country are you thinking of?',
      "We work with over 60 universities in the UK, Australia and Ireland. Send me your transcript and I'll shortlist.",
      'Yes — IELTS 6.0 for most courses; a few accept the Duolingo test instead.',
      'Fees start around £14,000 a year and scholarships of up to 30% are available.',
      'Of course — the office is open 10am to 6pm, any day this week.',
      "Received, thank you. I'll check the entry requirements and come back to you today.",
      'Most applications take 2–4 weeks for a decision. We prepare everything with you.',
      '78% is fine for many universities. A foundation year opens up the top ones too.',
    ],
    note: [
      'Keen — wants UK, CS. Send shortlist.',
      'Needs IELTS; suggested booking the test.',
      'Parent will call tomorrow.',
      'Walk-in planned Thursday.',
      'Budget is tight — look at Ireland too.',
    ],
    tags: ['UK', 'Australia', 'Ireland', 'Sep 2026', 'Jan 2027', 'IELTS', 'Callback', 'Parent', 'Scholarship'],
  },
  Applied: {
    in: [
      'Any news from the university?',
      'I paid the deposit yesterday, did you receive the receipt?',
      'When will the CAS come?',
      'Do I need to book the TB test myself?',
      'The bank statement is ready, sending it now.',
      'Can I change my course to business management?',
      'What should I bring to the visa appointment?',
      'My offer says conditional — what is missing?',
      'Is the accommodation deposit refundable?',
      'How much money should the bank statement show?',
    ],
    out: [
      "Nothing yet, {first} — I've chased them today and will tell you the moment it lands.",
      'Yes, the deposit is on your record. The university will issue the CAS within 5 working days.',
      "The TB test is at the IOM clinic — I'll send you the booking link.",
      "Bring your passport, the CAS letter, the TB certificate and the bank statement. I'll prepare a checklist.",
      'The condition is your final transcript — send it as soon as the school releases it.',
      'Your course change request went in; the admissions team usually answers within a week.',
      'The bank statement needs to show the first-year fees plus £1,023 a month for 9 months.',
      'Received the statement, thank you — filing it on your record now.',
    ],
    note: [
      'Chased admissions by email.',
      'Deposit confirmed by finance.',
      'CAS requested.',
      'Visa appointment booked for next week.',
      'Course change pending.',
    ],
    tags: ['Offer', 'CAS', 'Visa', 'Deposit', 'Sep 2026', 'UK', 'Australia', 'TB test'],
    tpl: ['offer_reminder', 'cas_documents', 'visa_checklist'],
  },
  Enrolled: {
    in: [
      'I arrived safely, thank you for everything!',
      'How do I open a bank account here?',
      'Can I work part time?',
      'My friend wants to apply too, can I share your number?',
      'Induction week was great.',
      'Do you know a good place to buy a SIM card?',
      'Is there a Kuwaiti student society here?',
    ],
    out: [
      'Wonderful! Keep in touch and send a photo from campus 😊',
      'Most students use Monzo or the campus bank branch — take your passport and the enrolment letter.',
      'Yes, up to 20 hours a week during term time.',
      'Of course {first}! Ask them to message me here.',
      'Giffgaff or Lebara — both have shops near the campus.',
      'Yes, the Kuwaiti Students Union has a branch there. I will send the contact.',
    ],
    note: ['Arrived. Marked enrolled.', 'Referral — expect a message.'],
    tags: ['Arrived', 'Referral', 'Alumni'],
  },
  Lost: {
    in: [
      'I decided to study locally. Thanks for your help.',
      'Sorry, I went with another agency.',
      "We can't afford it this year.",
      'I got a job, maybe next year.',
      'Please stop sending me messages.',
    ],
    out: [
      "Understood — all the best. We're here if plans change.",
      'No problem at all, {first}. Good luck!',
      'Of course. I will close your file; reach out any time.',
    ],
    note: ['Lost — studying locally.', 'Lost — budget.', 'Lost — another agency.'],
    tags: ['Local', 'Budget', 'Next year'],
    tpl: ['paused_application'],
  },
};

// reply speed per counsellor — some answer in minutes, some in hours
const speedOf = (id) => {
  let h = 0;
  const str = String(id || '');
  for (let i = 0; i < str.length; i += 1) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return ['fast', 'fast', 'medium', 'medium', 'slow'][h % 5];
};
const replyGap = (speed) => {
  const minutes =
    speed === 'fast'
      ? between(1, 9)
      : speed === 'medium'
      ? chance(0.6)
        ? between(3, 14)
        : between(16, 50)
      : between(12, 240);
  return minutes * 60e3;
};
// Kuwait office hours bias: 10–13 and 17–22, lighter in between, quiet at night
const pickHour = () => {
  const r = rng();
  if (r < 0.38) return Math.floor(between(10, 14));
  if (r < 0.8) return Math.floor(between(17, 23));
  if (r < 0.95) return Math.floor(between(14, 17));
  return Math.floor(between(0, 10));
};
/** a moment within the last `days` days (recent days more likely) at a plausible hour, as ms-ago */
const momentAgo = (days) => {
  const dayBack = Math.floor(days * rng() ** 1.6);
  const d = new Date(now - dayBack * D);
  d.setHours(pickHour(), Math.floor(between(0, 60)), Math.floor(between(0, 60)), 0);
  const agoMs = now - d.getTime();
  return agoMs > 5 * 60e3 ? agoMs : 5 * 60e3 + between(0, 60e3);
};
const fill = (t, ctx) => t.replace(/\{first\}/g, ctx.first);
/** nobody writes between midnight and 9am — a reply that lands there waits for the morning */
const snapToDay = (agoMs) => {
  const d = new Date(now - agoMs);
  if (d.getHours() < 9) d.setHours(9 + Math.floor(between(0, 3)), Math.floor(between(0, 60)), 0, 0);
  return now - d.getTime();
};

/**
 * Builds a thread for a bulk chat. Returns { rows-through-m, unread, status, followUp, priority, tags }.
 * Every emitted timestamp is in the past, in order.
 */
const bulkThread = (m, ctx) => {
  const pool = POOL[ctx.stage];
  const length = ctx.stage === 'Lost' ? Math.floor(between(2, 4)) : Math.floor(between(3, 9));
  const oldest = ctx.stage === 'Lost' || ctx.stage === 'Enrolled' ? 45 : 30;
  let t = momentAgo(oldest); // ms ago of the first message
  let dir = chance(0.7) ? 'in' : 'out';
  let usedDoc = false;
  let lastDir = dir;
  for (let i = 0; i < length && t > 2 * 60e3; i += 1) {
    if (dir === 'in') {
      if (!usedDoc && ctx.docs.length && ctx.stage !== 'Lost' && chance(0.35)) {
        m.file(pick(ctx.docs), t, chance(0.6));
        usedDoc = true;
      } else m.in(pick(pool.in), t);
      lastDir = 'in';
      // the counsellor answers after their usual gap; sometimes a note goes in first
      const gap = replyGap(ctx.speed);
      if (chance(0.25)) m.note(pick(pool.note), Math.max(60e3, t - gap * 0.5));
      t = snapToDay(t - gap);
      dir = 'out';
    } else {
      if (pool.tpl && chance(0.15)) m.tpl(pick(pool.tpl), fill(pick(pool.out), ctx), t);
      else m.out(fill(pick(pool.out), ctx), t);
      lastDir = 'out';
      // the student writes back between 10 minutes and 14 hours later
      t = snapToDay(t - between(10, 14 * 60) * 60e3);
      dir = 'in';
    }
  }
  // most chats end answered; about a third are still waiting for the counsellor
  if (lastDir === 'in' && t > 2 * 60e3 && chance(0.65)) {
    m.out(fill(pick(pool.out), ctx), t);
    lastDir = 'out';
  }
  const waiting = lastDir === 'in';
  const resolved = !waiting && (ctx.stage === 'Lost' || ctx.stage === 'Enrolled' ? chance(0.7) : chance(0.15));
  const prio = ctx.stage === 'Lost' ? 'low' : chance(0.15) ? 'high' : chance(0.3) ? 'low' : 'medium';
  const tags = chance(0.6) ? [pick(pool.tags)].concat(chance(0.4) ? [pick(pool.tags)] : []) : [];
  const followUp = !resolved && chance(0.4) ? () => new Date(now + (chance(0.5) ? -1 : 1) * between(2, 72) * H) : undefined;
  return {
    unread: waiting ? Math.floor(between(1, 4)) : 0,
    status: resolved ? 'resolved' : 'open',
    priority: prio,
    tags: [...new Set(tags)],
    followUp,
  };
};

// ---------------------------------------------------------------------------

async function main() {
  await mongoose.connect(config.mongoose.url, config.mongoose.options);
  const db = mongoose.connection;
  const write = !!args.confirm;
  if (write && args.confirm !== db.name) {
    console.error(`--confirm=${args.confirm} does not match the staging database "${db.name}". Nothing written.`);
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log(`${write ? 'Writing to' : 'Dry run against'} "${db.name}"`);

  const Conv = db.collection('whatsappconversations');
  const Msg = db.collection('whatsappmessages');
  const Leads = db.collection('leads');

  if (args.rollback) {
    const convs = await Conv.find({ tags: DEMO_TAG }).project({ _id: 1 }).toArray();
    const ids = convs.map((c) => c._id);
    const leads = await Leads.countDocuments({ webUrl: LEAD_MARK });
    console.log(`${ids.length} demo chats, their messages, and ${leads} demo lead(s)`);
    if (write) {
      const m = await Msg.deleteMany({ conversation: { $in: ids } });
      const c = await Conv.deleteMany({ _id: { $in: ids } });
      const l = await Leads.deleteMany({ webUrl: LEAD_MARK });
      console.log(`removed: ${c.deletedCount} chats, ${m.deletedCount} messages, ${l.deletedCount} lead(s)`);
    }
    await mongoose.disconnect();
    return;
  }

  const already = await Conv.countDocuments({ tags: DEMO_TAG });
  if (already) {
    console.error(`${already} demo chats exist already. Run with --rollback first.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  const users = await db.collection('users').find({}).project({ name: 1, role: 1 }).toArray();
  const userName = (id) => {
    const u = users.find((x) => String(x._id) === String(id));
    return u ? u.name : null;
  };
  const inChat = new Set(
    (
      await Conv.find({ student: { $ne: null } })
        .project({ student: 1 })
        .toArray()
    ).map((c) => String(c.student))
  );

  // ---- pick the students --------------------------------------------------
  const used = new Set();
  const picked = [];
  for (const sc of SCENARIOS) {
    const q = { phoneNo: { $regex: /(\d\D*){7}/ }, stage: sc.pick.stage };
    if (sc.pick.labels) q.labels = sc.pick.labels;
    const cands = await db
      .collection('students')
      .find(q)
      .project({ firstName: 1, lastName: 1, phoneNo: 1, stage: 1, labels: 1, assignedTo: 1, refrenceNo: 1, preference: 1 })
      .sort({ updatedAt: -1 })
      .limit(120)
      .toArray();
    let chosen = null;
    for (const s of cands) {
      const id = String(s._id);
      if (used.has(id) || inChat.has(id)) continue;
      if (!(s.assignedTo || []).some((a) => a.user)) continue; // needs an owner for the notes
      const info = { doc: null, app: null };
      if (sc.pick.wantDoc) {
        info.doc = await db
          .collection('documents')
          .findOne({ studentId: s._id, docTypeKey: sc.pick.wantDoc, 'blobInfo.0.blobUrl': { $exists: true } });
        if (!info.doc) continue;
      }
      if (sc.pick.wantApp) {
        info.app = await db.collection('applications').findOne({ studentId: s._id }, { sort: { createdAt: -1 } });
        if (!info.app) continue;
      }
      chosen = { s, ...info };
      break;
    }
    if (!chosen) {
      console.log(`  ✗ ${sc.key}: no student fits (${JSON.stringify(sc.pick)})`);
      continue;
    }
    used.add(String(chosen.s._id));
    picked.push({ sc, ...chosen });
  }

  // ---- bulk: more students per stage, spread across sales owners -----------
  const ownerOf = (st) =>
    (st.assignedTo || []).find((x) => x.user && /sales/i.test(x.role || '')) || (st.assignedTo || []).find((x) => x.user);
  const bulk = [];
  for (const [stage, want] of Object.entries(BULK)) {
    const cands = (
      await db
        .collection('students')
        .find({ phoneNo: { $regex: /(\d\D*){7}/ }, stage })
        .project({ firstName: 1, lastName: 1, phoneNo: 1, stage: 1, labels: 1, assignedTo: 1, refrenceNo: 1 })
        .sort({ updatedAt: -1 })
        .limit(400)
        .toArray()
    ).filter((st) => !used.has(String(st._id)) && !inChat.has(String(st._id)) && ownerOf(st));
    // round-robin over owners so the team table has everyone in it
    const byOwner = new Map();
    cands.forEach((st) => {
      const k = String(oid(ownerOf(st).user));
      if (!byOwner.has(k)) byOwner.set(k, []);
      byOwner.get(k).push(st);
    });
    const queues = [...byOwner.values()];
    let taken = 0;
    for (let round = 0; taken < want && queues.some((q) => q.length); round += 1) {
      for (const q of queues) {
        if (taken >= want) break;
        const st = q.shift();
        if (!st) continue;
        used.add(String(st._id));
        bulk.push({ s: st, stage });
        taken += 1;
      }
    }
  }
  for (const b of bulk) {
    b.docs = await db
      .collection('documents')
      .find({ studentId: b.s._id, 'blobInfo.0.blobUrl': { $exists: true } })
      .project({ docTypeKey: 1, documentType: 1, blobInfo: { $slice: 1 } })
      .limit(4)
      .toArray();
    b.app =
      b.stage === 'NotApplied'
        ? null
        : await db.collection('applications').findOne({ studentId: b.s._id }, { sort: { createdAt: -1 } });
  }

  // a counsellor for the unassigned fallbacks: the first picked student's sales owner
  const fallbackOwner = (() => {
    for (const p of picked) {
      const a =
        (p.s.assignedTo || []).find((x) => x.user && /sales/i.test(x.role || '')) ||
        (p.s.assignedTo || []).find((x) => x.user);
      if (a) return a;
    }
    return null;
  })();

  console.log('\nLinked chats:');
  for (const p of picked) {
    const owner =
      (p.s.assignedTo || []).find((x) => x.user && /sales/i.test(x.role || '')) ||
      (p.s.assignedTo || []).find((x) => x.user);
    console.log(
      `  ${p.sc.key.padEnd(18)} ${p.s.firstName} ${p.s.lastName || ''}  ${mask(p.s.phoneNo)}  ${p.s.stage}${
        p.sc.pick.labels ? ' 🔥' : ''
      }  owner ${userName(owner && owner.user) || '—'}` +
        `${p.app ? `  app: ${(p.app.institute && p.app.institute.name) || '?'} · ${p.app.courseName || ''}` : ''}${
          p.doc ? `  file: ${p.doc.docTypeKey}` : ''
        }`
    );
  }
  console.log(`\nBulk chats: ${bulk.length}`);
  const perStage = {};
  const perOwner = {};
  bulk.forEach((b) => {
    perStage[b.stage] = (perStage[b.stage] || 0) + 1;
    const o = userName(ownerOf(b.s).user) || '—';
    perOwner[o] = (perOwner[o] || 0) + 1;
  });
  console.log(
    `  by stage: ${Object.entries(perStage)
      .map(([k, v]) => `${k} ${v}`)
      .join(' · ')}`
  );
  console.log(
    `  by owner: ${Object.entries(perOwner)
      .map(
        ([k, v]) =>
          `${k} ${v} (${speedOf(
            [...bulk, ...picked].find((b) => userName(ownerOf(b.s).user) === k) &&
              oid(ownerOf([...bulk, ...picked].find((b) => userName(ownerOf(b.s).user) === k).s).user)
          )} replies)`
      )
      .join(' · ')}`
  );
  console.log('\nNew contacts (not in the CRM):');
  for (const u of UNLINKED)
    console.log(
      `  ${u.key.padEnd(18)} ${u.profileName}  ${u.phone}${u.lead ? `  + lead "${u.lead.fullname}"` : ''}${
        u.assign ? '' : '  (unassigned)'
      }`
    );

  if (!write) {
    console.log('\nDry run — add --confirm=upply_staging to write these chats.');
    await mongoose.disconnect();
    return;
  }

  // ---- write ----------------------------------------------------------------
  const makeThread = (convId, sentBy) => {
    const rows = [];
    const base = (direction, agoMs, extra) => {
      rows.push({
        conversation: convId,
        direction,
        type: 'text',
        status: direction === 'outbound' ? 'read' : 'delivered',
        timestamp: ago(agoMs),
        internal: false,
        ...extra,
        createdAt: ago(agoMs),
        updatedAt: ago(agoMs),
      });
      return rows[rows.length - 1];
    };
    return {
      rows,
      in: (text, agoMs) => base('inbound', agoMs, { text }),
      out: (text, agoMs) => base('outbound', agoMs, { text, sentByUser: sentBy }),
      note: (text, agoMs) => base('outbound', agoMs, { text, internal: true, sentByUser: sentBy }),
      tpl: (name, text, agoMs) =>
        base('outbound', agoMs, { type: 'template', text, template: { name, language: 'en' }, sentByUser: sentBy }),
      file: (doc, agoMs, filed) => {
        const b = doc.blobInfo[0];
        const isImage = /image\//.test(b.mimeType || '') || /\.(jpe?g|png|webp)$/i.test(b.fileName || b.blobUrl || '');
        return base('inbound', agoMs, {
          type: isImage ? 'image' : 'document',
          media: {
            mediaId: `demo-${doc._id}`,
            url: b.blobUrl,
            mimeType: b.mimeType || (isImage ? 'image/jpeg' : 'application/pdf'),
            type: isImage ? 'image' : 'document',
            filename: b.fileName || b.name || undefined,
          },
          ...(filed
            ? { savedDocument: { id: doc._id, label: doc.documentType || doc.docTypeKey, docTypeKey: doc.docTypeKey } }
            : {}),
        });
      },
    };
  };

  const insertConversation = async ({ contact, student, assignees, build, sentBy, ...given }) => {
    const convId = new mongoose.Types.ObjectId();
    const m = makeThread(convId, sentBy);
    const first = {
      conversation: convId,
      direction: 'outbound',
      type: 'text',
      text: 'Demo chat — seeded for the CRM walkthrough, not a real WhatsApp exchange.',
      internal: true,
      status: 'sent',
      sentByUser: sentBy || undefined,
      timestamp: ago(30 * D),
      createdAt: ago(30 * D),
      updatedAt: ago(30 * D),
    };
    // a builder may hand back priority / tags / status / followUp / unread (bulk threads do)
    const verdict = build(m) || {};
    const priority = verdict.priority || given.priority;
    const tags = verdict.tags || given.tags;
    const status = verdict.status || given.status;
    const followUp = verdict.followUp || given.followUp;
    const unread = verdict.unread !== undefined ? verdict.unread : given.unread;
    const rows = [first, ...m.rows].sort((a, b) => a.timestamp - b.timestamp);
    const visible = rows.filter((r) => !r.internal);
    const last = visible[visible.length - 1];
    const lastIn = [...visible].reverse().find((r) => r.direction === 'inbound');
    const previewOf = (r) => {
      if (r.type === 'image') return '📷 Photo';
      if (r.type === 'document') return `📄 ${(r.media && r.media.filename) || 'Document'}`;
      return r.text;
    };
    const preview = previewOf(last);
    await Conv.insertOne({
      _id: convId,
      contact,
      student: student || undefined,
      assignees,
      lastMessage: { preview, at: last.timestamp, direction: last.direction },
      lastMessageAt: last.timestamp,
      unreadCount: unread,
      windowExpiresAt: lastIn ? new Date(lastIn.timestamp.getTime() + D) : undefined,
      status: status || 'open',
      priority,
      tags: [DEMO_TAG, ...tags],
      nextFollowUpAt: followUp ? followUp() : undefined,
      createdAt: rows[0].timestamp,
      updatedAt: last.timestamp,
    });
    await Msg.insertMany(rows);
    return rows.length;
  };

  let chats = 0;
  let messages = 0;
  for (const p of picked) {
    const { s } = p;
    const owner =
      (s.assignedTo || []).find((x) => x.user && /sales/i.test(x.role || '')) || (s.assignedTo || []).find((x) => x.user);
    const ctx = {
      first: s.firstName,
      counsellor: (userName(owner && owner.user) || 'your counsellor').split(' ')[0],
      uni: p.app && p.app.institute && p.app.institute.name,
      course: p.app && p.app.courseName,
      doc: p.doc,
    };
    messages += await insertConversation({
      contact: { phone: e164(s.phoneNo), waId: digits(e164(s.phoneNo)) },
      student: s._id,
      assignees: (s.assignedTo || []).filter((a) => a.user).map((a) => ({ userId: oid(a.user), role: a.role })),
      priority: p.sc.priority,
      tags: p.sc.tags,
      status: p.sc.status,
      followUp: p.sc.followUp,
      unread: p.sc.unread,
      sentBy: owner && oid(owner.user),
      build: (m) => p.sc.thread(m, ctx),
    });
    chats += 1;
  }

  for (const b of bulk) {
    const owner = ownerOf(b.s);
    const ctx = {
      first: b.s.firstName,
      stage: b.stage,
      docs: b.docs || [],
      speed: speedOf(oid(owner.user)),
    };
    messages += await insertConversation({
      contact: { phone: e164(b.s.phoneNo), waId: digits(e164(b.s.phoneNo)) },
      student: b.s._id,
      assignees: (b.s.assignedTo || []).filter((a) => a.user).map((a) => ({ userId: oid(a.user), role: a.role })),
      priority: 'medium',
      tags: [],
      unread: 0,
      sentBy: oid(owner.user),
      // the thread decides priority / tags / status / follow-up / unread
      build: (m) => bulkThread(m, ctx),
    });
    chats += 1;
  }

  for (const u of UNLINKED) {
    if (u.lead) {
      await Leads.insertOne({
        ...u.lead,
        phoneNo: digits(u.phone),
        qualified: true,
        source: 'uapply',
        webUrl: LEAD_MARK,
        assignedTo: fallbackOwner ? oid(fallbackOwner.user) : undefined,
        assignedAt: fallbackOwner ? ago(D) : undefined,
        applications: [],
        selectedUniversity: [],
        createdAt: ago(D),
        updatedAt: ago(D),
      });
    }
    messages += await insertConversation({
      contact: { phone: u.phone, name: u.profileName, waId: digits(u.phone) },
      student: null,
      assignees: u.assign && fallbackOwner ? [{ userId: oid(fallbackOwner.user), role: fallbackOwner.role }] : [],
      priority: u.priority,
      tags: [],
      unread: u.unread,
      sentBy: fallbackOwner && oid(fallbackOwner.user),
      build: (m) => u.thread(m),
    });
    chats += 1;
  }

  console.log(
    `\nWritten: ${chats} chats, ${messages} messages, ${UNLINKED.filter((u) => u.lead).length} leads. Undo with --rollback.`
  );
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e.message || e);
  try {
    await mongoose.disconnect();
  } catch (_) {
    /* ignore */
  }
  process.exit(1);
});
