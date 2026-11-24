/* eslint-disable no-console, no-await-in-loop, no-restricted-syntax, no-continue, no-bitwise, no-nested-ternary, no-param-reassign */
/**
 * Demo WhatsApp chats on STAGING, linked to real (Trello-imported) students, so
 * the team can see how the inbox, the student record, documents and
 * applications connect, and so the dashboards read like a working inbox:
 *
 *   · 24 scripted chats — every stage, English and Arabic, a parent writing, a
 *     visa refusal, a complaint about a slow reply, voice notes, photos, a
 *     failed message after the 24-hour window, a five-week history
 *   · ~165 seeded ones spread over the counsellors, the hours of the day
 *     (Kuwait office hours, quieter on Fridays) and the last 30–45 days
 *   · 22 numbers the CRM doesn't know yet — leads ("Convert to student"), new
 *     contacts ("Add as student"), a wrong number, spam, a partner enquiry
 *   · 3 finished template broadcasts over those chats (the Broadcasts tab)
 *
 * Everything is stored in the database; nothing is hardcoded in the CRM and
 * nothing is sent to WhatsApp or Slack. The dashboards count these rows like
 * any others — check them with scripts/check-whatsapp-analytics.js.
 *
 *   node scripts/seed-whatsapp-demo.js --env=staging
 *       dry run: prints which students it would use and what it would write
 *   node scripts/seed-whatsapp-demo.js --env=staging --confirm=upply_staging
 *       writes the chats
 *   node scripts/seed-whatsapp-demo.js --env=staging --confirm=upply_staging --rollback
 *       removes everything this script added, and only that
 *
 * HOW DEMO DATA IS MARKED (what --rollback removes)
 *   chats        the tag "demo" (shown as a chip in the inbox); each opens with
 *                an internal note saying it is seeded
 *   messages     every message of a chat tagged "demo"
 *   leads        webUrl = demo://whatsapp-inbox-seed
 *   broadcasts   audience.demo = demo://whatsapp-inbox-seed (label "Demo · …")
 * Students, documents and applications are only read, never written.
 *
 * Demo chats use numbers that cannot exist (+965 0…), not the students' own:
 * nothing typed into one can reach a real person.
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

// Hours are KUWAIT hours, wherever this script is run from (it used the
// machine's own clock: run from India, the "office hours" landed 2½ hours early
// on the dashboard's "When students write").
const KW = 3 * H;
const kw = (t) => {
  const d = new Date(t + KW);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), day: d.getUTCDate(), hour: d.getUTCHours(), dow: d.getUTCDay() };
};
const kwTime = (y, mo, day, hour, minute = 0, second = 0) => Date.UTC(y, mo, day, hour, minute, second) - KW;
/** a Kuwait clock time today (or `dayOffset` days from today) */
const at = (hour, minute = 0, dayOffset = 0) => {
  const p = kw(now);
  return new Date(kwTime(p.y, p.mo, p.day + dayOffset, hour, minute));
};
/** how long ago a Kuwait clock time was — always in the past (at least two minutes) */
const agoAt = (hour, minute = 0, dayOffset = 0) => Math.max(2 * 60e3, now - at(hour, minute, dayOffset).getTime());
const nextMonday = () => {
  const p = kw(now);
  return new Date(kwTime(p.y, p.mo, p.day + ((8 - p.dow) % 7 || 7), 10));
};

// ---------------------------------------------------------------------------
// Scenarios. `m` builds messages: in(text, agoMs) · out(text, agoMs) ·
// note(text, agoMs) · tpl(name, text, agoMs) · file(doc, agoMs, filed) ·
// voiceIn(sec, agoMs) · voiceOut(sec, agoMs) · photoIn(label, agoMs, caption) ·
// docIn(filename, agoMs) · docOut(filename, agoMs) · fail(text, agoMs, code, title) ·
// sys(text, agoMs)
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
      m.file(s.doc, 90 * 60e3, true, 'Passport'),
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
      m.file(s.doc, D + 3 * H, false, 'Transcript'),
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
      m.file(s.doc, 2 * D - 2 * H, true, 'Passport'),
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
  {
    key: 'arabic-enquiry',
    pick: { stage: 'NotApplied' },
    priority: 'medium',
    tags: ['Foundation', 'عربي'],
    thread: (m, s) => [
      m.in('السلام عليكم، أبغى أدرس سنة تأسيسية في بريطانيا. شنو المطلوب؟', agoAt(18, 5, -1)),
      m.out(
        `وعليكم السلام ${s.first}! حياك الله. نحتاج صورة الجواز وكشف الدرجات، وبعدها أرشح لك الجامعات المناسبة.`,
        agoAt(18, 11, -1)
      ),
      m.in('تمام. وكم الرسوم تقريباً؟', agoAt(18, 20, -1)),
      m.out('السنة التأسيسية من ١٤ إلى ١٨ ألف باوند، وفيه منح توصل ٣٠٪.', agoAt(18, 26, -1)),
      m.in('وهل لازم آيلتس؟', agoAt(10, 42)),
      m.in('عندي دولينجو ١٠٥', agoAt(10, 44)),
    ],
  },
  {
    key: 'parent-writing',
    pick: { stage: 'NotApplied' },
    priority: 'medium',
    tags: ['Parent', 'Callback'],
    followUp: () => at(11, 0, 1),
    thread: (m, s) => [
      m.in(
        `Good evening, this is ${s.first}'s father. He gave me this number. We want to understand the total cost before we decide.`,
        2 * D + 3 * H
      ),
      m.out(
        `Good evening, and thank you for writing. I'm ${s.counsellor}. I'll send a full breakdown — tuition, accommodation and living costs — and we can go through it on a call.`,
        2 * D + 3 * H - 9 * 60e3
      ),
      m.voiceIn(21, 2 * D + 2 * H),
      m.note(
        'Father asked (voice note) whether fees can be paid in instalments, and about safety in Coventry.',
        2 * D + 2 * H - 4 * 60e3
      ),
      m.out(
        'Yes — most universities take the deposit first and the rest in two or three instalments. I will include that in the breakdown.',
        2 * D + 2 * H - 12 * 60e3
      ),
      m.docOut('Cost breakdown — September intake.pdf', 2 * D + H),
      m.in('Thank you. Please call me tomorrow after 11.', 2 * D + 40 * 60e3),
      m.out('Will do. Speak tomorrow.', 2 * D + 33 * 60e3),
    ],
  },
  {
    key: 'ielts-booking',
    pick: { stage: 'Applied' },
    priority: 'medium',
    tags: ['IELTS'],
    thread: (m, s) => [
      m.tpl(
        'ielts_reminder',
        `Hi ${s.first}, your offer needs IELTS 6.0. We can book the test for you — reply here to choose a date.`,
        6 * D
      ),
      m.in('Yes please, the earliest date', 6 * D - 2 * H),
      m.out(
        'The earliest is the 14th at the British Council, Mansouriya. Shall I book it? The fee is 85 KD.',
        6 * D - 2 * H + 6 * 60e3
      ),
      m.in('Book it', 6 * D - 2 * H + 15 * 60e3),
      m.photoIn('Payment receipt', 5 * D + 20 * H, 'Paid, here is the receipt'),
      m.out('Booked ✅ I have sent the confirmation to your email. Bring your passport on the day.', 5 * D + 19 * H),
      m.in('Thanks!', 5 * D + 18 * H + 50 * 60e3),
    ],
  },
  {
    key: 'deposit-receipt',
    pick: { stage: 'Applied', wantApp: true },
    priority: 'high',
    tags: ['Deposit', 'CAS'],
    followUp: () => at(16, 0, 0),
    thread: (m, s) => [
      m.out(
        `${s.first}, ${
          s.uni || 'the university'
        } needs the £4,000 deposit by Friday to hold your place. Here are the bank details.`,
        D + 6 * H
      ),
      m.docOut('Deposit payment instructions.pdf', D + 6 * H - 60e3),
      m.in('I will pay today from my father account. Is that ok?', D + 4 * H),
      m.out('Yes, a parent can pay. Please put your student ID in the reference.', D + 4 * H - 7 * 60e3),
      m.photoIn('Bank transfer receipt', 3 * H + 10 * 60e3, 'Done'),
      m.in('When will I get the CAS?', 3 * H + 8 * 60e3),
      m.note('Receipt received — forward to finance and chase the CAS today.', 3 * H),
    ],
  },
  {
    key: 'visa-refused',
    pick: { stage: 'Applied' },
    priority: 'high',
    tags: ['Visa', 'Urgent'],
    followUp: () => at(9, 30, -1), // overdue
    thread: (m, s) => [
      m.in('I got an email from UKVI. My visa is refused 😞', D + 5 * H),
      m.in('What do I do now?? The course starts in 3 weeks', D + 5 * H - 2 * 60e3),
      m.out(
        `I'm sorry ${s.first}. Don't panic — send me the refusal letter and we will see whether it is an administrative review or a fresh application.`,
        D + 5 * H - 6 * 60e3
      ),
      m.docIn('UKVI refusal notice.pdf', D + 4 * H + 40 * 60e3),
      m.voiceOut(14, D + 4 * H + 20 * 60e3),
      m.note(
        'Refused on the bank statement — funds held 21 days, needs 28. Fresh application once the statement matures. Told the university.',
        D + 4 * H
      ),
      m.in('So I need to wait one more week and apply again?', D + 3 * H),
      m.out(
        'Exactly. I have asked the university to hold your place and issue a new CAS. I will confirm tomorrow morning.',
        D + 2 * H + 50 * 60e3
      ),
      m.in('Any update from the university?', 2 * H + 30 * 60e3),
      m.in('Please, I am very worried', 35 * 60e3),
    ],
  },
  {
    key: 'deferral',
    pick: { stage: 'Applied', wantApp: true },
    priority: 'low',
    tags: ['Deferral', 'Jan 2027'],
    status: 'resolved',
    thread: (m, s) => [
      m.in('Can I move my start date to January? My military service paper is delayed.', 8 * D),
      m.out(
        `Yes ${s.first}, most courses allow it. I will ask ${s.uni || 'the university'} for a deferral to January.`,
        8 * D - 18 * 60e3
      ),
      m.note('Deferral request sent to admissions.', 8 * D - 20 * 60e3),
      m.out('Good news — the deferral is approved. Your new offer letter is on your record.', 5 * D),
      m.in('Thank you so much 🙏', 5 * D - 3 * H),
    ],
  },
  {
    key: 'accommodation',
    pick: { stage: 'Enrolled' },
    priority: 'low',
    tags: ['Accommodation', 'Airport'],
    status: 'resolved',
    thread: (m, s) => [
      m.in('Is the airport pickup included? My flight lands at Heathrow at 7am.', 13 * D),
      m.out('It is — send me the flight number and I will book the university shuttle.', 13 * D - 25 * 60e3),
      m.in('KU 101, Sunday', 13 * D - 40 * 60e3),
      m.out('Booked. The driver will hold a sign with your name at arrivals, Terminal 4.', 13 * D - 70 * 60e3),
      m.photoIn('Room photo', 10 * D, 'Arrived! This is the room'),
      m.out(`Looks great ${s.first}! Enjoy induction week.`, 10 * D - 50 * 60e3),
    ],
  },
  {
    key: 'complaint-slow',
    pick: { stage: 'Applied' },
    priority: 'high',
    tags: ['Complaint'],
    thread: (m, s) => [
      m.in('Hello, I sent my documents two days ago and nobody answered.', 2 * D + 5 * H),
      m.in('??', 2 * D + 3 * H),
      m.in('I will go to another agency if there is no answer today', 2 * D + H),
      m.out(
        `${s.first}, I'm very sorry for the delay — that is not how we want to work. I have your documents and I am submitting the application now.`,
        2 * D - 2 * H
      ),
      m.note('Reply was 7 hours late. Application submitted the same evening; call to apologise.', 2 * D - 2 * H - 5 * 60e3),
      m.out('Submitted ✅ You will get the acknowledgement email from the university within 24 hours.', 2 * D - 5 * H),
      m.in('Ok. Thank you.', 2 * D - 6 * H),
    ],
  },
  {
    key: 'window-closed',
    pick: { stage: 'NotApplied' },
    priority: 'low',
    tags: ['Follow-up'],
    thread: (m, s) => [
      m.in('I will think about it and come back to you.', 16 * D),
      m.out('Of course, take your time.', 16 * D - 12 * 60e3),
      m.fail(`Hi ${s.first}, just checking in — have you had a chance to decide?`, 9 * D, '131047', 'Re-engagement message'),
      m.note(
        "The 24-hour window had closed — a free message can't be delivered. Sent the template instead.",
        9 * D - 2 * 60e3
      ),
      m.tpl(
        'checking_in',
        `Hi ${s.first}, we're still here to help with your study plans. Reply to this message and we'll pick up where we left off.`,
        9 * D - 5 * 60e3
      ),
    ],
  },
  {
    key: 'long-history',
    pick: { stage: 'Applied', wantApp: true },
    priority: 'medium',
    tags: ['Offer', 'Sep 2026'],
    thread: (m, s) => [
      m.in('Hi, I want to apply for a business degree in the UK.', 36 * D),
      m.out(
        `Welcome ${s.first}! Send me your passport and transcript and I will shortlist universities today.`,
        36 * D - 8 * 60e3
      ),
      m.in('Sending now', 36 * D - 30 * 60e3),
      m.out(
        'Got them. With your grades I suggest three: a safe choice, a good match and one ambitious. Details by email.',
        35 * D
      ),
      m.in("I like the second one. What's the next step?", 34 * D + 5 * H),
      m.out(
        'A short personal statement — 400 words on why this course. I will send a template.',
        34 * D + 4 * H + 48 * 60e3
      ),
      m.docOut('Personal statement — guide.pdf', 34 * D + 4 * H + 45 * 60e3),
      m.in('Here is my draft', 30 * D),
      m.docIn('Personal statement draft.docx', 30 * D - 60e3),
      m.out(
        'Good start. Two changes: open with your own story, and mention the placement year. Updated copy attached.',
        29 * D + 20 * H
      ),
      m.in('Done, sent it back', 28 * D),
      m.out(`Application submitted to ${s.uni || 'the university'} ✅`, 27 * D + 21 * H),
      m.in('How long until they answer?', 24 * D),
      m.out('Usually two to three weeks. I chase them every Monday.', 24 * D - 15 * 60e3),
      m.in('Any news?', 17 * D),
      m.out('Not yet — chased again this morning.', 17 * D - 40 * 60e3),
      m.out(
        `🎉 ${s.first}, you have a conditional offer${s.course ? ` for ${s.course}` : ''}! The condition is IELTS 6.0.`,
        12 * D
      ),
      m.in('Alhamdulillah!! Thank you', 12 * D - 4 * 60e3),
      m.in('When is the IELTS test?', 12 * D - 5 * 60e3),
      m.out('I can book the 14th or the 28th. Which suits you?', 12 * D - 20 * 60e3),
      m.in('28th', 11 * D + 20 * H),
      m.out('Booked for the 28th.', 11 * D + 19 * H),
      m.voiceIn(9, 4 * D),
      m.out('Got your voice note — yes, the deposit is due after the IELTS result, not before.', 4 * D - 25 * 60e3),
      m.in('Ok great', 4 * D - 30 * 60e3),
    ],
  },
  {
    key: 'scholarship',
    pick: { stage: 'NotApplied' },
    priority: 'medium',
    tags: ['Scholarship'],
    thread: (m, s) => [
      m.in('Do you have scholarships for Kuwaiti students?', 4 * H + 25 * 60e3),
      m.out(
        `Yes ${s.first} — most of our partner universities give £2,000 to £5,000 automatically, and some up to 50% for high grades. What was your final percentage?`,
        4 * H + 21 * 60e3
      ),
      m.in('91%', 4 * H),
      m.out("Excellent, that opens the merit scholarships. I'll send the list tonight.", 3 * H + 52 * 60e3),
    ],
  },
  {
    key: 'returning-alumni',
    pick: { stage: 'Enrolled' },
    priority: 'medium',
    tags: ['Alumni', 'Masters'],
    followUp: nextMonday,
    thread: (m, s) => [
      m.in("Hi! I graduate in June and I'm thinking about a master's. Can you help again?", D + 2 * H),
      m.out(
        `Congratulations ${s.first}! Of course. Do you want to stay at the same university or look at others?`,
        D + 2 * H - 14 * 60e3
      ),
      m.in('Others too. Maybe London.', D + H),
      m.out("London it is — I'll prepare options for Monday.", D + 52 * 60e3),
    ],
  },
  {
    key: 'lost-price',
    pick: { stage: 'Lost' },
    priority: 'low',
    tags: ['Budget'],
    status: 'resolved',
    thread: (m, s) => [
      m.in('The fees are too high for us. Is there anything cheaper?', 20 * D),
      m.out(
        `I understand ${s.first}. Ireland and some UK foundation routes are lower — around £9,000. Shall I send them?`,
        20 * D - 22 * 60e3
      ),
      m.in('No, we decided to wait until next year.', 19 * D),
      m.out(
        "No problem at all. I'll keep your file and message you when next year's scholarships open.",
        19 * D - 35 * 60e3
      ),
    ],
  },
  {
    key: 'call-permission',
    pick: { stage: 'Applied' },
    priority: 'medium',
    tags: ['Call'],
    callPermission: 'permanent',
    thread: (m, s) => [
      m.out(`${s.first}, it is easier to explain the visa form on a call. Can I call you on WhatsApp?`, 7 * H),
      m.sys('✅ Allowed WhatsApp calls', 6 * H + 50 * 60e3),
      m.in('Yes call me after 5', 6 * H + 49 * 60e3),
      m.out('Will do 👍', 6 * H + 44 * 60e3),
    ],
  },
];

const UNLINKED = [
  {
    key: 'new-lead',
    profileName: 'Noor',
    phone: '+96500990001',
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
    phone: '+96500990002',
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
    phone: '+96500990003',
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
    phone: '+96500990004',
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
    phone: '+96500990005',
    priority: 'low',
    assign: true,
    thread: (m) => [m.in('Hello? Is this ULearn?', 2 * D)],
    unread: 1,
  },
  {
    key: 'new-lead-3',
    profileName: 'Hamad',
    phone: '+96500990006',
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
    phone: '+96500990007',
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
    phone: '+96500990008',
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
    phone: '+96500990009',
    priority: 'low',
    assign: true,
    thread: (m) => [m.in('Hi, do you have offices in Salmiya?', 3 * D)],
    unread: 1,
  },
  {
    key: 'new-unknown-6',
    profileName: 'Omar',
    phone: '+96500990010',
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
  {
    key: 'new-arabic',
    profileName: 'أبو محمد',
    phone: '+96500990011',
    priority: 'medium',
    assign: false,
    thread: (m) => [
      m.in('السلام عليكم', 52 * 60e3),
      m.in('ولدي خلص ثانوية وأبي أسجله في جامعة برا', 51 * 60e3),
      m.in('ممكن أحد يكلمني؟', 14 * 60e3),
    ],
  },
  {
    key: 'new-parent',
    profileName: 'Um Abdullah',
    phone: '+96500990012',
    priority: 'medium',
    assign: true,
    thread: (m) => [
      m.in('Hello, my son finished grade 12 this year with 84%. Which countries do you recommend?', 5 * H),
      m.out(
        'Hello! With 84% he has good options in the UK, Ireland and Australia. What does he want to study?',
        5 * H - 4 * 60e3
      ),
      m.in('Engineering, mechanical I think', 4 * H + 30 * 60e3),
      m.out(
        "Great choice. Could you ask him to send his transcript here, or come by the office? We're open until 6.",
        4 * H + 22 * 60e3
      ),
    ],
  },
  {
    key: 'new-agent',
    profileName: 'Gulf Scholars Co.',
    phone: '+96500990013',
    priority: 'low',
    assign: true,
    followUp: nextMonday,
    thread: (m) => [
      m.in(
        'Good morning. We are an education consultancy in Hawally and would like to work with you as a sub-agent. Who should we speak to?',
        3 * D
      ),
      m.out(
        'Good morning, and thank you for getting in touch. I have passed your message to our partnerships team — they will send the agreement and commission terms.',
        3 * D - 35 * 60e3
      ),
      m.in('Thank you, we will wait for the email.', 3 * D - 50 * 60e3),
      m.note('Partner enquiry, not a student. Forwarded to partnerships; follow up Monday.', 3 * D - 55 * 60e3),
    ],
  },
  {
    key: 'new-wrong-number',
    profileName: 'Khaled',
    phone: '+96500990014',
    priority: 'low',
    assign: true,
    status: 'resolved',
    thread: (m) => [
      m.in('Is my order ready for pickup?', 6 * D),
      m.out('Hello! This is ULearn Abroad, an education agency — you may have the wrong number.', 6 * D - 3 * 60e3),
      m.in('Sorry wrong number', 6 * D - 4 * 60e3),
    ],
  },
  {
    key: 'new-spam',
    profileName: 'Best Offers KW',
    phone: '+96500990015',
    priority: 'low',
    assign: false,
    status: 'resolved',
    thread: (m) => [m.in('🔥 Limited offer! Get 5000 followers for only 9 KD. Reply YES to order now.', 8 * D)],
    unread: 0,
  },
  {
    key: 'new-voice',
    profileName: 'Dana',
    phone: '+96500990016',
    priority: 'medium',
    assign: false,
    thread: (m) => [m.voiceIn(14, agoAt(21, 40, -1)), m.voiceIn(6, agoAt(21, 42, -1))],
  },
  {
    key: 'new-photo',
    profileName: 'Bader',
    phone: '+96500990017',
    priority: 'medium',
    assign: true,
    thread: (m) => [
      m.photoIn('School certificate', 95 * 60e3, 'This is my certificate'),
      m.in('Can I get into a UK university with this?', 94 * 60e3),
    ],
  },
  {
    key: 'new-night',
    profileName: 'Hessa',
    phone: '+96500990018',
    priority: 'medium',
    assign: false,
    thread: (m) => [
      m.in(
        'Hi, sorry for the late message. I want to ask about medicine in Ireland. Do you take students with 95%?',
        agoAt(2, 14, 0)
      ),
    ],
  },
  {
    key: 'new-jobseeker',
    profileName: 'Imran',
    phone: '+96500990019',
    priority: 'low',
    assign: true,
    status: 'resolved',
    thread: (m) => [
      m.in('Hello sir, do you have any job vacancy? I have 4 years experience in admin.', 4 * D),
      m.out(
        'Hello, thank you for your interest. We have no openings at the moment — vacancies are posted on our website when we do.',
        4 * D - 2 * H
      ),
      m.in('Ok thank you sir', 4 * D - 2 * H - 5 * 60e3),
    ],
  },
  {
    key: 'new-lead-5',
    profileName: 'Lulwa',
    phone: '+96500990020',
    priority: 'high',
    assign: true,
    lead: {
      fullname: 'Lulwa Al-Mutairi',
      degree: { en_name: 'Bachelor', name: 'Bachelor' },
      destination: { en_name: 'United Kingdom', name: 'United Kingdom' },
      subjects: 'Architecture',
      status: 'Sent Whatsapp',
    },
    thread: (m) => [
      m.in('Hi, I registered at your stand in the Avenues exhibition. Architecture in the UK please.', 75 * 60e3),
      m.out(
        'Hi Lulwa! Lovely to hear from you. Architecture needs a portfolio — do you have drawings or design work you can share?',
        72 * 60e3
      ),
      m.in('Yes I have a portfolio from school', 60 * 60e3),
      m.out("Perfect. Send a few pages here and I'll tell you which universities it fits.", 57 * 60e3),
    ],
  },
  {
    key: 'new-old-unanswered',
    profileName: 'Faisal',
    phone: '+96500990021',
    priority: 'medium',
    assign: false,
    thread: (m) => [m.in('Hello, how much is the application fee?', 3 * D + 4 * H), m.in('Hello?', 2 * D + 20 * H)],
  },
  {
    key: 'new-school',
    profileName: 'Ms. Reem — Al Bayan School',
    phone: '+96500990022',
    priority: 'medium',
    assign: true,
    followUp: () => at(12, 0, 2),
    thread: (m) => [
      m.in(
        'Good afternoon. I am the university counsellor at Al Bayan Bilingual School. Could ULearn give a talk to our grade 12 students next month?',
        D + 3 * H
      ),
      m.out(
        'Good afternoon Ms. Reem — we would be glad to. Which dates suit the school, and roughly how many students?',
        D + 3 * H - 16 * 60e3
      ),
      m.in('Any Tuesday in the morning. About 80 students.', D + 2 * H),
      m.out("Wonderful. I'll confirm a Tuesday with our team and send you the outline of the talk.", D + 2 * H - 9 * 60e3),
    ],
  },
];

// ---------------------------------------------------------------------------
// Bulk chats — a seeded spread across stages, counsellors, hours and the last
// 14 days, so the dashboards (team table, busy hours, per-day bars, funnel)
// read like a working inbox. Same seed → same plan on every run.
// ---------------------------------------------------------------------------
const BULK = { NotApplied: 56, Applied: 60, Enrolled: 26, Lost: 22 };

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
      'السلام عليكم، أبي أستفسر عن الدراسة في بريطانيا',
      'كم تكلفة السنة التأسيسية؟',
      'هل تساعدون في الفيزا؟',
      'Do you have medicine or dentistry?',
      'Is there an application fee?',
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
      'وعليكم السلام {first}، حياك الله. أي تخصص تفكر فيه؟',
      'No application fee with us — the universities pay our fee, not you.',
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
      'متى يطلع القبول النهائي؟',
      'دفعت العربون اليوم',
      'The portal is asking me for a reference letter.',
      'Can my brother come with me for the first week?',
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
// Most replies land inside the 15-minute mark; the slower people run late more
// often. (The slow ones used to take up to four hours: one person's average
// reply read 4h 14m and the team's 54 minutes.)
const replyGap = (speed) => {
  let minutes;
  if (speed === 'fast') minutes = between(1, 9);
  else if (speed === 'medium') minutes = chance(0.75) ? between(3, 14) : between(16, 40);
  else minutes = chance(0.6) ? between(6, 22) : between(25, 90);
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
/**
 * a moment within the last `days` days (recent days more likely) at a plausible
 * Kuwait hour, as ms-ago. Fridays are quiet: half of what lands on one moves a day back.
 */
const momentAgo = (days) => {
  let dayBack = Math.floor(days * rng() ** 1.6);
  if (kw(now - dayBack * D).dow === 5 && chance(0.5)) dayBack += 1;
  const p = kw(now - dayBack * D);
  const t = kwTime(p.y, p.mo, p.day, pickHour(), Math.floor(between(0, 60)), Math.floor(between(0, 60)));
  const agoMs = now - t;
  return agoMs > 5 * 60e3 ? agoMs : 5 * 60e3 + between(0, 60e3);
};
const fill = (t, ctx) => t.replace(/\{first\}/g, ctx.first);
/** nobody writes between midnight and 9am (Kuwait) — a reply that lands there waits for the morning */
const snapToDay = (agoMs) => {
  const p = kw(now - agoMs);
  if (p.hour >= 9) return agoMs;
  const t = kwTime(p.y, p.mo, p.day, 9 + Math.floor(between(0, 3)), Math.floor(between(0, 60)));
  return now - t;
};

const SECOND_LINE = [
  '??',
  'Hello?',
  'Sorry, one more question',
  'Please let me know today if possible',
  'I can come to the office too',
  'Thanks in advance',
  'هلا؟',
];
const VOICE_SECONDS = [6, 9, 14, 21];

/**
 * Builds a thread for a bulk chat. Returns { status, followUp, priority, tags, seen }.
 * Every emitted timestamp is in the past, in order.
 */
const bulkThread = (m, ctx) => {
  const pool = POOL[ctx.stage];
  const length = ctx.stage === 'Lost' ? Math.floor(between(2, 5)) : Math.floor(between(3, 12));
  const oldest = ctx.stage === 'Lost' || ctx.stage === 'Enrolled' ? 45 : 30;
  let t = momentAgo(oldest); // ms ago of the first message
  let dir = chance(0.7) ? 'in' : 'out';
  let usedDoc = false;
  let lastDir = dir;
  let askedAt = 0; // ms ago of the student's latest question
  for (let i = 0; i < length && t > 2 * 60e3; i += 1) {
    if (dir === 'in') {
      if (!usedDoc && ctx.docs.length && ctx.stage !== 'Lost' && chance(0.35)) {
        m.file(pick(ctx.docs), t, chance(0.6));
        usedDoc = true;
      } else if (chance(0.04)) m.voiceIn(pick(VOICE_SECONDS), t);
      else m.in(pick(pool.in), t);
      askedAt = t;
      // one in five follows up before anyone has answered
      if (chance(0.2) && t > 6 * 60e3) {
        t -= between(1, 4) * 60e3;
        m.in(pick(SECOND_LINE), t);
      }
      lastDir = 'in';
      // the counsellor answers after their usual gap; sometimes a note goes in first
      const gap = replyGap(ctx.speed);
      if (chance(0.25)) m.note(pick(pool.note), Math.max(60e3, t - gap * 0.5));
      // a reply that would fall after midnight: an evening message is usually
      // answered the same evening from someone's phone, the rest wait for the morning
      const due = t - gap;
      if (kw(now - due).hour < 9 && kw(now - t).hour >= 19 && chance(0.85)) t = snapToDay(t - between(2, 12) * 60e3);
      else t = snapToDay(due);
      dir = 'out';
    } else {
      if (pool.tpl && chance(0.15)) m.tpl(pick(pool.tpl), fill(pick(pool.out), ctx), t);
      else if (chance(0.03)) m.voiceOut(pick(VOICE_SECONDS), t);
      else if (chance(0.02) && t > 10 * 60e3) {
        // a send that failed, then went through on the second try
        const text = fill(pick(pool.out), ctx);
        m.fail(text, t, '131000', 'Something went wrong');
        t -= between(1, 4) * 60e3;
        m.out(text, t);
      } else m.out(fill(pick(pool.out), ctx), t);
      lastDir = 'out';
      // the student writes back between 10 minutes and 14 hours later
      t = snapToDay(t - between(10, 14 * 60) * 60e3);
      dir = 'in';
    }
  }
  // Chats end answered, except recent ones: a question from the last day or so
  // is as likely as not still open; nobody is left waiting for a week. (A third
  // of all chats used to end unanswered whatever their age — "Waiting longest"
  // was a list of 20- and 30-day waits.)
  let answer = 0.5;
  if (askedAt > 5 * D) answer = 1;
  else if (askedAt > 30 * H) answer = 0.9;
  if (lastDir === 'in' && t > 2 * 60e3 && chance(answer)) {
    m.out(fill(pick(pool.out), ctx), t);
    lastDir = 'out';
  }
  const waiting = lastDir === 'in';
  const resolved = !waiting && (ctx.stage === 'Lost' || ctx.stage === 'Enrolled' ? chance(0.7) : chance(0.15));
  const prio = ctx.stage === 'Lost' ? 'low' : chance(0.15) ? 'high' : chance(0.3) ? 'low' : 'medium';
  const tags = chance(0.6) ? [pick(pool.tags)].concat(chance(0.4) ? [pick(pool.tags)] : []) : [];
  const followUp = !resolved && chance(0.4) ? () => new Date(now + (chance(0.5) ? -1 : 1) * between(2, 72) * H) : undefined;
  return {
    // a third of the waiting chats have been opened (read) but not answered yet
    seen: waiting && chance(0.3),
    status: resolved ? 'resolved' : 'open',
    priority: prio,
    tags: [...new Set(tags)],
    followUp,
  };
};

// Placeholder media for chats that have no student file to show: a short hum
// for a voice note, a labelled card for a photo. Both are data: URIs, so they
// play / show in the inbox without any file being stored anywhere.
const demoVoice = (() => {
  const made = new Map();
  return (sec) => {
    if (made.has(sec)) return made.get(sec);
    const rate = 1000;
    const n = rate * sec;
    const buf = Buffer.alloc(44 + n);
    buf.write('RIFF', 0);
    buf.writeUInt32LE(36 + n, 4);
    buf.write('WAVEfmt ', 8);
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20); // PCM
    buf.writeUInt16LE(1, 22); // mono
    buf.writeUInt32LE(rate, 24);
    buf.writeUInt32LE(rate, 28);
    buf.writeUInt16LE(1, 32);
    buf.writeUInt16LE(8, 34);
    buf.write('data', 36);
    buf.writeUInt32LE(n, 40);
    for (let i = 0; i < n; i += 1) {
      const fade = Math.min(1, i / 150, (n - i) / 150) * (0.55 + 0.45 * Math.sin(i / 170));
      buf[44 + i] = 128 + Math.round(16 * fade * Math.sin((2 * Math.PI * 160 * i) / rate));
    }
    const v = { url: `data:audio/wav;base64,${buf.toString('base64')}`, size: buf.length };
    made.set(sec, v);
    return v;
  };
})();
const demoPhoto = (label) => {
  const safe = String(label).replace(/[<>&]/g, '');
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320" viewBox="0 0 480 320">` +
    `<rect width="480" height="320" fill="#eef0f6"/><rect x="24" y="24" width="432" height="272" rx="14" fill="#fff" stroke="#d5d8e3"/>` +
    `<text x="240" y="150" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" fill="#3a3650">${safe}</text>` +
    `<text x="240" y="186" text-anchor="middle" font-family="Arial, sans-serif" font-size="15" fill="#8a879c">Demo image — not a real document</text></svg>`;
  return { url: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`, size: svg.length };
};

// Finished template broadcasts (the Broadcasts tab). `daysAgo` and the hour are
// Kuwait time; each goes to chats of one stage that had gone quiet by then.
const BROADCASTS = [
  {
    templateName: 'january_intake_reminder',
    label: 'Not applied — January intake',
    stage: 'NotApplied',
    daysAgo: 6,
    hour: 11,
    minute: 0,
    max: 18,
    text: 'Hi {first}, applications for the January intake close soon. Reply here and we will get yours started this week.',
  },
  {
    templateName: 'visa_checklist',
    label: 'Applied — visa checklist',
    stage: 'Applied',
    daysAgo: 3,
    hour: 17,
    minute: 30,
    max: 16,
    text: 'Hi {first}, your visa checklist is ready: passport, CAS, TB certificate and a 28-day bank statement. Reply if you need help with any of them.',
  },
  {
    templateName: 'alumni_referral',
    label: 'Enrolled — refer a friend',
    stage: 'Enrolled',
    daysAgo: 1,
    hour: 12,
    minute: 15,
    max: 10,
    text: 'Hi {first}, we hope the term is going well! If a friend is thinking of studying abroad, share this number with them.',
  },
];

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
  const Broadcasts = db.collection('whatsappbroadcasts');

  if (args.rollback) {
    const convs = await Conv.find({ tags: DEMO_TAG }).project({ _id: 1 }).toArray();
    const ids = convs.map((c) => c._id);
    const msgs = await Msg.countDocuments({ conversation: { $in: ids } });
    const leads = await Leads.countDocuments({ webUrl: LEAD_MARK });
    const casts = await Broadcasts.countDocuments({ 'audience.demo': LEAD_MARK });
    console.log(`${ids.length} demo chats, their ${msgs} message rows, ${leads} demo lead(s), ${casts} demo broadcast(s)`);
    if (write) {
      const m = await Msg.deleteMany({ conversation: { $in: ids } });
      const c = await Conv.deleteMany({ _id: { $in: ids }, tags: DEMO_TAG });
      const l = await Leads.deleteMany({ webUrl: LEAD_MARK });
      const b = await Broadcasts.deleteMany({ 'audience.demo': LEAD_MARK });
      console.log(
        `removed: ${c.deletedCount} chats, ${m.deletedCount} message rows, ${l.deletedCount} lead(s), ${b.deletedCount} broadcast(s)`
      );
      console.log(
        `left behind: ${await Conv.countDocuments({
          tags: DEMO_TAG,
        })} demo chats · every other chat untouched (${await Conv.countDocuments({})} chats, ${await Msg.countDocuments(
          {}
        )} message rows remain)`
      );
    } else console.log('Dry run — add --confirm=<database name> to remove them.');
    await mongoose.disconnect();
    return;
  }

  const already = await Conv.countDocuments({ tags: DEMO_TAG });
  if (already) {
    console.error(`${already} demo chats exist already. Run with --rollback first.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  const users = await db.collection('users').find({}).project({ name: 1, role: 1, former: 1 }).toArray();
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

  const used = new Set();
  // ---- who can own a demo chat ------------------------------------------------
  // A chat sits on the desk of the student's own sales person. Staff who have
  // left (a closed account) are passed over. A student nobody owns yet — most
  // new enquiries on staging — is LENT one of the working sales people in turn,
  // on the chat only: the student record is never written.
  const students = db.collection('students');
  const formerIds = new Set(users.filter((u) => u.former).map((u) => String(u._id)));
  const lent = new Map();
  const ownSlots = (st) => (st.assignedTo || []).filter((x) => x.user && !formerIds.has(String(oid(x.user))));
  const ownerOf = (st) =>
    lent.get(String(st._id)) || ownSlots(st).find((x) => /sales/i.test(x.role || '')) || ownSlots(st)[0];
  const assigneesOf = (st) => {
    const l = lent.get(String(st._id));
    if (l) return [{ userId: oid(l.user), role: l.role }];
    // the student's team, without anyone whose account is closed
    return ownSlots(st).map((a) => ({ userId: oid(a.user), role: a.role }));
  };
  const WITH_PHONE = { $regex: /(\d\D*){7}/ };
  const OWNED = { assignedTo: { $elemMatch: { user: { $ne: null } } } };
  const FIELDS = { firstName: 1, lastName: 1, phoneNo: 1, stage: 1, labels: 1, assignedTo: 1, refrenceNo: 1, preference: 1 };
  // the working sales people, busiest first
  const tally = new Map();
  (await students.find(OWNED).project({ assignedTo: 1 }).sort({ updatedAt: -1 }).limit(3000).toArray()).forEach((st) => {
    const o = ownSlots(st).find((x) => /sales/i.test(x.role || ''));
    if (!o) return;
    const k = String(oid(o.user));
    const t = tally.get(k) || { user: oid(o.user), role: o.role, n: 0 };
    t.n += 1;
    tally.set(k, t);
  });
  const salesPool = [...tally.values()].sort((a, b) => b.n - a.n || String(a.user).localeCompare(String(b.user)));
  let lendNo = 0;
  const ensureOwner = (st) => {
    const own = ownerOf(st);
    if (own || !salesPool.length) return own;
    const o = salesPool[lendNo % salesPool.length];
    lendNo += 1;
    lent.set(String(st._id), { user: o.user, role: o.role });
    return ownerOf(st);
  };
  const free = (st) => !used.has(String(st._id)) && !inChat.has(String(st._id));
  /** students with a phone, most recently updated first: { owned: with a working owner, unowned: the rest } */
  const candidates = async (query, limit) => {
    const find = (q) => students.find(q).project(FIELDS).sort({ updatedAt: -1 }).limit(limit).toArray();
    const owned = (await find({ ...query, phoneNo: WITH_PHONE, ...OWNED })).filter((st) => free(st) && ownerOf(st));
    const seen = new Set(owned.map((st) => String(st._id)));
    const unowned = (await find({ ...query, phoneNo: WITH_PHONE })).filter(
      (st) => free(st) && !seen.has(String(st._id)) && !ownerOf(st)
    );
    return { owned, unowned };
  };

  console.log('\nStudents with a phone number (with a working owner):');
  for (const stage of Object.keys(BULK)) {
    const all = await students.countDocuments({ stage, phoneNo: WITH_PHONE });
    const owned = await students.countDocuments({ stage, phoneNo: WITH_PHONE, ...OWNED });
    console.log(`  ${stage.padEnd(11)} ${all} (${owned})`);
  }
  console.log(
    `  sales people: ${salesPool.map((o) => userName(o.user) || '?').join(', ') || 'none found'}${
      formerIds.size ? ` · ${formerIds.size} closed account(s) passed over` : ''
    }`
  );

  // ---- pick the students --------------------------------------------------
  const picked = [];
  for (const sc of SCENARIOS) {
    // as asked; then without the document; then without the label
    const tries = [sc.pick];
    if (sc.pick.wantDoc) tries.push({ ...sc.pick, wantDoc: undefined });
    if (sc.pick.labels) tries.push({ ...sc.pick, wantDoc: undefined, labels: undefined });
    let chosen = null;
    for (const want of tries) {
      const q = { stage: want.stage };
      if (want.labels) q.labels = want.labels;
      const { owned, unowned } = await candidates(q, 120);
      for (const s of [...owned, ...unowned]) {
        const info = { doc: null, app: null };
        if (want.wantDoc) {
          info.doc = await db
            .collection('documents')
            .findOne({ studentId: s._id, docTypeKey: want.wantDoc, 'blobInfo.0.blobUrl': { $exists: true } });
          if (!info.doc) continue;
        }
        if (want.wantApp) {
          info.app = await db.collection('applications').findOne({ studentId: s._id }, { sort: { createdAt: -1 } });
          if (!info.app) continue;
        }
        if (!ensureOwner(s)) continue;
        chosen = { s, ...info };
        break;
      }
      if (chosen) break;
    }
    if (!chosen) {
      console.log(`  ✗ ${sc.key}: no student fits (${JSON.stringify(sc.pick)})`);
      continue;
    }
    used.add(String(chosen.s._id));
    picked.push({ sc, ...chosen });
  }

  // ---- bulk: more students per stage, spread across sales owners -----------
  const bulk = [];
  for (const [stage, want] of Object.entries(BULK)) {
    const { owned, unowned } = await candidates({ stage }, 400);
    // round-robin over owners so the team table has everyone in it
    const byOwner = new Map();
    owned.forEach((st) => {
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
    // not enough with an owner: the rest are students nobody owns yet
    for (const st of unowned) {
      if (taken >= want) break;
      if (!ensureOwner(st)) break;
      used.add(String(st._id));
      bulk.push({ s: st, stage });
      taken += 1;
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

  // a counsellor for the new contacts that are assigned: the first picked student's, else the busiest
  const fallbackOwner = picked.map((p) => ownerOf(p.s)).find(Boolean) || salesPool[0] || null;

  console.log('\nLinked chats:');
  for (const p of picked) {
    const owner = ownerOf(p.s);
    console.log(
      `  ${p.sc.key.padEnd(18)} ${p.s.firstName} ${p.s.lastName || ''}  ${mask(p.s.phoneNo)}  ${p.s.stage}${
        p.sc.pick.labels ? ' 🔥' : ''
      }  owner ${userName(owner && owner.user) || '—'}${lent.has(String(p.s._id)) ? ' (lent)' : ''}` +
        `${p.app ? `  app: ${(p.app.institute && p.app.institute.name) || '?'} · ${p.app.courseName || ''}` : ''}${
          p.doc ? `  file: ${p.doc.docTypeKey}` : ''
        }`
    );
  }
  console.log(
    `\nBulk chats: ${bulk.length}${
      lent.size ? ` (${lent.size} chats in all on students nobody owns yet, lent a sales person)` : ''
    }`
  );
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

  // ---- plan -----------------------------------------------------------------
  // Each chat is planned in memory first (its messages, then what follows from
  // them: preview, unread, window, status dates), the broadcasts are laid over
  // the plans, and only then is anything written.
  let voiceNo = 0;
  const makeThread = (convId, sentBy) => {
    const rows = [];
    const base = (direction, agoMs, extra) => {
      rows.push({
        conversation: convId,
        direction,
        type: 'text',
        timestamp: ago(agoMs),
        internal: false,
        ...extra,
        createdAt: ago(agoMs),
        updatedAt: ago(agoMs),
      });
      return rows[rows.length - 1];
    };
    const voice = (direction, sec, agoMs, extra) => {
      voiceNo += 1;
      const v = demoVoice(sec);
      return base(direction, agoMs, {
        type: 'audio',
        durationSec: sec,
        media: {
          mediaId: `demo-voice-${voiceNo}`,
          url: v.url,
          mimeType: 'audio/wav',
          type: 'audio',
          filename: 'Voice note.wav',
          size: v.size,
        },
        ...extra,
      });
    };
    const doc = (direction, filename, agoMs, extra) =>
      base(direction, agoMs, {
        type: 'document',
        media: {
          mediaId: `demo-doc-${convId}-${rows.length}`,
          mimeType: /\.docx$/i.test(filename)
            ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            : 'application/pdf',
          type: 'document',
          filename,
          size: 60000 + Math.floor(rng() * 400000),
        },
        ...extra,
      });
    const thread = {
      rows,
      in: (text, agoMs) => base('inbound', agoMs, { text }),
      out: (text, agoMs) => base('outbound', agoMs, { text, sentByUser: sentBy }),
      note: (text, agoMs) => base('outbound', agoMs, { text, internal: true, status: 'sent', sentByUser: sentBy }),
      tpl: (name, text, agoMs, extra) =>
        base('outbound', agoMs, {
          type: 'template',
          text,
          template: { name, language: 'en' },
          sentByUser: sentBy,
          ...extra,
        }),
      fail: (text, agoMs, code, title) =>
        base('outbound', agoMs, { text, status: 'failed', error: { code, title }, sentByUser: sentBy }),
      sys: (text, agoMs) => base('inbound', agoMs, { type: 'system', text }),
      voiceIn: (sec, agoMs) => voice('inbound', sec, agoMs),
      voiceOut: (sec, agoMs) => voice('outbound', sec, agoMs, { sentByUser: sentBy }),
      photoIn: (label, agoMs, caption) => {
        const img = demoPhoto(label);
        return base('inbound', agoMs, {
          type: 'image',
          text: caption || undefined,
          media: {
            mediaId: `demo-photo-${convId}-${rows.length}`,
            url: img.url,
            mimeType: 'image/svg+xml',
            type: 'image',
            filename: `${label}.svg`,
            size: img.size,
          },
        });
      },
      docIn: (filename, agoMs) => doc('inbound', filename, agoMs),
      docOut: (filename, agoMs) => doc('outbound', filename, agoMs, { sentByUser: sentBy }),
      file: (doc0, agoMs, filed, label = 'Document') => {
        // no such file on this student: a labelled placeholder instead
        if (!doc0 || !doc0.blobInfo || !doc0.blobInfo[0]) return thread.photoIn(label, agoMs);
        const b = doc0.blobInfo[0];
        const isImage = /image\//.test(b.mimeType || '') || /\.(jpe?g|png|webp)$/i.test(b.fileName || b.blobUrl || '');
        return base('inbound', agoMs, {
          type: isImage ? 'image' : 'document',
          media: {
            mediaId: `demo-${doc0._id}`,
            url: b.blobUrl,
            mimeType: b.mimeType || (isImage ? 'image/jpeg' : 'application/pdf'),
            type: isImage ? 'image' : 'document',
            filename: b.fileName || b.name || undefined,
          },
          ...(filed
            ? { savedDocument: { id: doc0._id, label: doc0.documentType || doc0.docTypeKey, docTypeKey: doc0.docTypeKey } }
            : {}),
        });
      },
    };
    return thread;
  };

  // Demo chats never carry a real number. A linked chat is tied to its student
  // by id; its number is one that cannot exist (Kuwait numbers do not start
  // with 0), so a reply typed into a demo chat by mistake reaches nobody, and a
  // real message from that student opens a chat of its own.
  let demoNo = 0;
  const demoContact = () => {
    demoNo += 1;
    const phone = `+9650${1000000 + demoNo}`;
    return { phone, waId: digits(phone) };
  };

  const plans = [];
  const planConversation = ({ contact, student, assignees, build, sentBy, stage, firstName, ...given }) => {
    const convId = new mongoose.Types.ObjectId();
    const m = makeThread(convId, sentBy);
    // a builder may hand back priority / tags / status / followUp / seen (bulk threads do)
    const verdict = build(m) || {};
    const plan = {
      convId,
      m,
      contact,
      student: student || undefined,
      assignees,
      sentBy,
      stage,
      firstName,
      priority: (!Array.isArray(verdict) && verdict.priority) || given.priority || 'medium',
      tags: (!Array.isArray(verdict) && verdict.tags) || given.tags || [],
      status: (!Array.isArray(verdict) && verdict.status) || given.status || 'open',
      followUp: (!Array.isArray(verdict) && verdict.followUp) || given.followUp,
      seen: !Array.isArray(verdict) && verdict.seen,
      unread: given.unread,
      callPermission: given.callPermission,
    };
    plans.push(plan);
    return plan;
  };

  for (const p of picked) {
    const { s } = p;
    const owner = ownerOf(s);
    const ctx = {
      first: s.firstName,
      counsellor: (userName(owner && owner.user) || 'your counsellor').split(' ')[0],
      uni: p.app && p.app.institute && p.app.institute.name,
      course: p.app && p.app.courseName,
      doc: p.doc,
    };
    planConversation({
      contact: demoContact(),
      student: s._id,
      assignees: assigneesOf(s),
      priority: p.sc.priority,
      tags: p.sc.tags,
      status: p.sc.status,
      followUp: p.sc.followUp,
      unread: p.sc.unread,
      callPermission: p.sc.callPermission,
      sentBy: owner && oid(owner.user),
      stage: s.stage,
      firstName: s.firstName,
      build: (m) => p.sc.thread(m, ctx),
    });
  }

  for (const b of bulk) {
    const owner = ownerOf(b.s);
    const ctx = {
      first: b.s.firstName,
      stage: b.stage,
      docs: b.docs || [],
      speed: speedOf(oid(owner.user)),
    };
    planConversation({
      contact: demoContact(),
      student: b.s._id,
      assignees: assigneesOf(b.s),
      sentBy: oid(owner.user),
      stage: b.stage,
      firstName: b.s.firstName,
      // the thread decides priority / tags / status / follow-up
      build: (m) => bulkThread(m, ctx),
    });
  }

  const leadRows = [];
  for (const u of UNLINKED) {
    if (u.lead) {
      leadRows.push({
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
    planConversation({
      contact: { phone: u.phone, name: u.profileName, waId: digits(u.phone) },
      student: null,
      assignees: u.assign && fallbackOwner ? [{ userId: oid(fallbackOwner.user), role: fallbackOwner.role }] : [],
      priority: u.priority,
      status: u.status,
      followUp: u.followUp,
      unread: u.unread,
      sentBy: fallbackOwner && oid(fallbackOwner.user),
      build: (m) => u.thread(m),
    });
  }

  // ---- broadcasts: finished template sends over the linked chats -----------
  // A recipient is a chat that had gone quiet, answered, before the send — so
  // the template lands at the end of the thread, as it would have.
  const broadcastRows = [];
  for (const def of BROADCASTS) {
    const sentAt = at(def.hour, def.minute, -def.daysAgo).getTime();
    if (sentAt >= now - 10 * 60e3) continue;
    const fits = plans.filter((p) => {
      if (!p.student || p.stage !== def.stage || p.status === 'resolved' || p.broadcast) return false;
      const real = p.m.rows.filter((r) => !r.internal);
      const last = real.reduce((a, r) => (!a || r.timestamp > a.timestamp ? r : a), null);
      return !!last && last.direction === 'outbound' && last.timestamp.getTime() < sentAt - H;
    });
    const chosen = fits.slice(0, def.max);
    if (chosen.length < 3) continue;
    const bId = new mongoose.Types.ObjectId();
    const sender = chosen[0].sentBy;
    const recipients = chosen.map((p, i) => {
      const r = rng();
      let status = 'read';
      if (r < 0.08) status = 'failed';
      else if (r < 0.13) status = 'sent';
      else if (r < 0.4) status = 'delivered';
      const text = def.text.replace(/\{first\}/g, p.firstName || 'there');
      const row = p.m.tpl(def.templateName, text, now - (sentAt + i * 1500), {
        broadcast: bId,
        sentByUser: sender,
        status,
        ...(status === 'failed' ? { error: { code: '131026', title: 'Message undeliverable' } } : {}),
      });
      row.waMessageId = `demo.broadcast.${bId}.${i}`;
      // eslint-disable-next-line no-param-reassign
      p.broadcast = true;
      return {
        student: p.student,
        phone: digits(p.contact.phone),
        name: p.firstName,
        conversation: p.convId,
        status,
        row,
        ...(status === 'failed' ? { error: { code: '131026', title: 'Message undeliverable' } } : {}),
      };
    });
    broadcastRows.push({ bId, def, sender, sentAt, recipients });
  }

  // ---- finish each chat: what follows from its messages ---------------------
  const convDocs = [];
  const msgDocs = [];
  const previewOf = (r) => {
    if (r.internal) return '📝 Internal note';
    if (r.type === 'image') return r.text || '📷 Photo';
    if (r.type === 'audio') return '🎤 Voice note';
    if (r.type === 'document') return `📄 ${(r.media && r.media.filename) || 'Document'}`;
    return r.text;
  };
  for (const p of plans) {
    const rows = p.m.rows.sort((a, b) => a.timestamp - b.timestamp);
    const real = rows.filter((r) => !r.internal);
    if (!real.length) continue;
    // the note that says the chat is seeded sits a minute before its first message
    const opened = new Date(rows[0].timestamp.getTime() - 60e3);
    rows.unshift({
      conversation: p.convId,
      direction: 'outbound',
      type: 'text',
      text: 'Demo chat — seeded for the CRM walkthrough, not a real WhatsApp exchange.',
      internal: true,
      status: 'sent',
      sentByUser: p.sentBy || undefined,
      timestamp: opened,
      createdAt: opened,
      updatedAt: opened,
    });
    // delivery ticks: a message the student answered was read; recent ones are still on their way
    real.forEach((r, i) => {
      if (r.status) return;
      if (r.direction === 'inbound') {
        r.status = 'delivered';
        return;
      }
      const answered = real.slice(i + 1).some((x) => x.direction === 'inbound');
      const age = now - r.timestamp.getTime();
      if (answered) r.status = 'read';
      else if (age > D) r.status = chance(0.85) ? 'read' : 'delivered';
      else if (age > H) r.status = chance(0.5) ? 'read' : 'delivered';
      else r.status = chance(0.25) ? 'read' : chance(0.8) ? 'delivered' : 'sent';
    });
    const last = real[real.length - 1];
    const lastRow = rows[rows.length - 1];
    const lastIn = [...real].reverse().find((r) => r.direction === 'inbound');
    // unread = what the student has sent since the last reply, unless staff have opened the chat
    let trailing = 0;
    for (let i = real.length - 1; i >= 0 && real[i].direction === 'inbound'; i -= 1) trailing += 1;
    let unread = p.unread === undefined ? trailing : Math.min(p.unread, trailing);
    if (p.seen || p.status === 'resolved') unread = 0;
    const resolvedAt =
      p.status === 'resolved'
        ? new Date(Math.min(now - 60e3, lastRow.timestamp.getTime() + between(5, 90) * 60e3))
        : undefined;
    convDocs.push({
      _id: p.convId,
      contact: p.contact,
      student: p.student,
      assignees: p.assignees,
      // as the app keeps it: the newest entry's preview and time (a note
      // included), with the direction of the last real message
      lastMessage: { preview: previewOf(lastRow), at: lastRow.timestamp, direction: last.direction },
      lastMessageAt: lastRow.timestamp,
      unreadCount: unread,
      windowExpiresAt: lastIn ? new Date(lastIn.timestamp.getTime() + D) : undefined,
      status: p.status,
      resolvedAt,
      priority: p.priority,
      tags: [DEMO_TAG, ...p.tags],
      nextFollowUpAt: p.followUp && p.status !== 'resolved' ? p.followUp() : undefined,
      ...(p.callPermission ? { callPermission: { status: p.callPermission, requestedAt: rows[1].timestamp } } : {}),
      createdAt: opened,
      updatedAt: resolvedAt || lastRow.timestamp,
    });
    rows.forEach((r) => {
      if (!r._id) r._id = new mongoose.Types.ObjectId();
      msgDocs.push(r);
    });
  }

  const broadcastDocs = broadcastRows.map(({ bId, def, sender, sentAt, recipients }) => {
    const counters = { queued: 0, sent: 0, delivered: 0, read: 0, failed: 0 };
    recipients.forEach((r) => {
      counters[r.status] += 1;
    });
    return {
      _id: bId,
      templateName: def.templateName,
      language: 'en',
      defaultComponents: [],
      audience: { filter: { stage: def.stage }, demo: LEAD_MARK },
      audienceLabel: `Demo · ${def.label}`,
      recipientCount: recipients.length,
      recipients: recipients.map(({ row, ...r }) => ({ ...r, message: row._id })),
      // never 'queued' or 'sending': the server picks those up and SENDS them
      status: 'completed',
      counters,
      createdBy: sender,
      startedAt: new Date(sentAt),
      completedAt: new Date(sentAt + recipients.length * 1500),
      createdAt: new Date(sentAt - 60e3),
      updatedAt: new Date(sentAt + recipients.length * 1500),
    };
  });

  // ---- what the dashboards should say about these rows ----------------------
  const real = msgDocs.filter((r) => !r.internal);
  const waitingDocs = convDocs.filter((c) => c.status !== 'resolved' && c.lastMessage.direction === 'inbound');
  const count = (list, f) => list.filter(f).length;
  console.log(
    `\nPlanned: ${convDocs.length} chats, ${msgDocs.length} rows (${real.length} messages + ${
      msgDocs.length - real.length
    } internal notes)`
  );
  console.log(
    `  chats      open ${count(convDocs, (c) => c.status !== 'resolved')} · resolved ${count(
      convDocs,
      (c) => c.status === 'resolved'
    )}` +
      ` · waiting for a reply ${waitingDocs.length} · unread messages ${convDocs.reduce((a, c) => a + c.unreadCount, 0)}` +
      ` · not in the CRM ${count(convDocs, (c) => !c.student)} · follow-ups overdue ${count(
        convDocs,
        (c) => c.nextFollowUpAt && c.nextFollowUpAt.getTime() < now
      )}`
  );
  console.log(
    `  messages   sent ${count(real, (r) => r.direction === 'outbound')} · received ${count(
      real,
      (r) => r.direction === 'inbound'
    )}` +
      ` · voice ${count(real, (r) => r.type === 'audio')} · photos/files ${count(
        real,
        (r) => r.type === 'image' || r.type === 'document'
      )}` +
      ` · templates ${count(real, (r) => r.type === 'template')} · failed ${count(real, (r) => r.status === 'failed')}`
  );
  console.log(
    `  broadcasts ${broadcastDocs.length}${
      broadcastDocs.length ? ` (${broadcastDocs.map((b) => `${b.templateName} → ${b.recipientCount}`).join(' · ')})` : ''
    } · leads ${leadRows.length}`
  );
  console.log(
    '  (the dashboard adds any real chats on top — scripts/check-whatsapp-analytics.js compares it with the records)'
  );

  if (!write) {
    console.log('\nDry run — add --confirm=upply_staging to write these chats.');
    await mongoose.disconnect();
    return;
  }

  // ---- write ----------------------------------------------------------------
  if (leadRows.length) await Leads.insertMany(leadRows);
  for (let i = 0; i < convDocs.length; i += 200) await Conv.insertMany(convDocs.slice(i, i + 200));
  for (let i = 0; i < msgDocs.length; i += 500) await Msg.insertMany(msgDocs.slice(i, i + 500));
  if (broadcastDocs.length) await Broadcasts.insertMany(broadcastDocs);

  console.log(
    `\nWritten: ${convDocs.length} chats, ${msgDocs.length} rows, ${leadRows.length} leads, ${broadcastDocs.length} broadcasts. Undo with --rollback.`
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
