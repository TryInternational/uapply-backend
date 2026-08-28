/* eslint-disable no-console, no-restricted-syntax, no-await-in-loop, no-plusplus, no-nested-ternary */
/**
 * Seed sample WhatsApp data so the inbox + analytics dashboards are populated
 * before real WhatsApp traffic (WABA) is connected. Idempotent: re-running
 * replaces the seeded conversations/messages (matched by their +96550-000-0xx
 * demo phone numbers) without touching real data.
 *
 * Run:  APP_ENV=development node scripts/seedWhatsapp.js
 * (uses MONGODB_URL from .env.<APP_ENV>)
 */

const path = require('path');
const mongoose = require('mongoose');

require('dotenv').config({ path: path.join(__dirname, `../.env.${process.env.APP_ENV || 'development'}`) });

// Require model files directly (avoids the config/firebase load chain).
const Students = require('../src/models/students.model');
const User = require('../src/models/user.model');
const WhatsappConversation = require('../src/models/whatsappConversation.model');
const WhatsappMessage = require('../src/models/whatsappMessage.model');

const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;
const ago = (ms) => new Date(Date.now() - ms);
const ahead = (ms) => new Date(Date.now() + ms);

const SEED = [
  {
    phone: '+96550000001',
    first: 'Ahmed',
    last: 'Khan',
    stage: 'Applied',
    testScore: 'IELTS not taken',
    ambassador: 'Instagram',
    note: 'Strong lead — mother is a physician. Prefers Russell Group.',
    parent: '+96599551122',
    status: 'waiting',
    priority: 'high',
    tags: ['New Lead', 'UK', 'Medicine'],
    followUp: ahead(2 * 24 * HOUR),
    windowExpiresAt: ahead(16 * HOUR),
    unread: 2,
    msgs: [
      ['outbound', 'text', 'Hi Ahmed, this is Noura from uLearn 👋', 30 * HOUR, {}],
      ['inbound', 'text', 'Hello! I wanted to ask about the UK application.', 50 * MIN, {}],
      ['inbound', 'audio', '', 46 * MIN, { durationSec: 14 }],
      ['outbound', 'text', 'Got your voice note 🙌 Which intake are you targeting?', 40 * MIN, {}],
      [
        'outbound',
        'text',
        'Booking a consultation for Thursday — mother is a doctor, budget is solid.',
        38 * MIN,
        { internal: true },
      ],
      ['inbound', 'text', 'September 2026. Is it too late to apply?', 8 * MIN, {}],
    ],
  },
  {
    phone: '+96550000002',
    first: 'Maria',
    last: 'Gomez',
    stage: 'NotApplied',
    testScore: '7.0',
    ambassador: 'Website',
    status: 'open',
    priority: 'medium',
    tags: ['UK', 'Scholarship', 'MSc'],
    windowExpiresAt: null, // closed
    unread: 0,
    msgs: [
      ['inbound', 'text', 'Do you offer scholarships for MSc programs?', 30 * HOUR, {}],
      ['outbound', 'text', "Yes! I'll send you the eligibility details shortly.", 29 * HOUR, {}],
      ['outbound', 'text', "Here's the scholarship brochure link.", 28 * HOUR, {}],
    ],
  },
  {
    phone: '+96550000003',
    first: 'Abdullah',
    last: 'Al-Rashidi',
    stage: 'NotApplied',
    ambassador: 'TikTok',
    status: 'waiting',
    priority: 'high',
    tags: ['New Lead', 'Canada', 'Follow-up'],
    windowExpiresAt: ahead(23 * HOUR),
    unread: 2,
    unassigned: true,
    msgs: [
      ['inbound', 'text', 'Hi, I saw your ad about studying in Canada.', 12 * MIN, {}],
      ['inbound', 'text', 'Can someone call me back?', 10 * MIN, {}],
    ],
  },
  {
    phone: '+96550000004',
    first: 'Wei',
    last: 'Chen',
    stage: 'Enrolled',
    testScore: '6.5',
    ambassador: 'Referral',
    status: 'resolved',
    priority: 'low',
    tags: ['UK', 'Visa', 'Offer'],
    windowExpiresAt: ahead(21 * HOUR),
    unread: 0,
    msgs: [
      ['outbound', 'text', 'Congrats on your offer from Manchester! 🎉', 3 * HOUR, {}],
      ['inbound', 'text', 'Thank you so much! What are the next steps?', 2 * HOUR, {}],
      ['outbound', 'text', "Let's get your visa documents ready. I'll email a checklist.", 90 * MIN, {}],
    ],
  },
];

async function run() {
  const url = process.env.MONGODB_URL;
  if (!url) throw new Error('MONGODB_URL not set (check .env.<APP_ENV>)');
  await mongoose.connect(url, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log('connected to', url.replace(/\/\/[^@]*@/, '//***@'));

  const counselors = await User.find({}).limit(2).select('_id name');
  const me = counselors[0];
  const other = counselors[1] || counselors[0];
  console.log(
    `assigning to ${counselors.length} user(s):`,
    counselors.map((u) => u.name).join(', ') || '(none — will be unassigned)'
  );

  let convCount = 0;
  let msgCount = 0;

  for (const s of SEED) {
    // upsert the student
    const student = await Students.findOneAndUpdate(
      { phoneNo: s.phone },
      {
        $set: {
          firstName: s.first,
          lastName: s.last,
          phoneNo: s.phone,
          stage: s.stage,
          testScore: s.testScore,
          ambassadorName: s.ambassador,
          importantComment: s.note,
          nationality: { label: 'Kuwait' },
          ...(s.parent ? { emergencyContact: [{ emergencyContactNo: s.parent, relation: 'Parent' }] } : {}),
        },
        $setOnInsert: { refrenceNo: `SEED-${s.phone.slice(-4)}`, applications: [], qualified: false },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const assignees = s.unassigned || !me ? [] : [{ userId: me._id, role: 'Counsellor' }];
    if (assignees.length) {
      student.assignedTo = assignees.map((a) => ({ user: a.userId, role: a.role }));
      await student.save();
    }

    // replace any prior seeded conversation for this phone
    const existing = await WhatsappConversation.findOne({ 'contact.phone': s.phone });
    if (existing) await WhatsappMessage.deleteMany({ conversation: existing._id });

    const last = s.msgs[s.msgs.length - 1];
    const lastAt = ago(last[3]);
    const conv = await WhatsappConversation.findOneAndUpdate(
      { 'contact.phone': s.phone },
      {
        $set: {
          contact: { phone: s.phone, name: `${s.first} ${s.last}`, waId: s.phone.replace(/\D/g, '') },
          student: student._id,
          assignees,
          lastMessage: {
            preview: last[4].internal ? '📝 Internal note' : last[2] || '🎤 Voice note',
            at: lastAt,
            direction: last[0],
          },
          lastMessageAt: lastAt,
          unreadCount: s.unread,
          windowExpiresAt: s.windowExpiresAt,
          status: s.status,
          priority: s.priority,
          tags: s.tags,
          ...(s.followUp ? { nextFollowUpAt: s.followUp } : {}),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    convCount += 1;

    // messages
    for (const m of s.msgs) {
      const [direction, type, text, offset, extra] = m;
      // eslint-disable-next-line no-await-in-loop
      await WhatsappMessage.create({
        conversation: conv._id,
        direction,
        type,
        text: text || undefined,
        internal: !!extra.internal,
        durationSec: extra.durationSec,
        ...(type === 'audio' ? { media: { mediaId: `seed-voice-${conv._id}`, mimeType: 'audio/ogg', type: 'audio' } } : {}),
        status: direction === 'outbound' ? 'read' : 'delivered',
        timestamp: ago(offset),
        sentByUser:
          direction === 'outbound' && !extra.internal
            ? s.status === 'resolved'
              ? other && other._id
              : me && me._id
            : me && me._id,
      });
      msgCount += 1;
    }
  }

  console.log(`✓ seeded ${convCount} conversations, ${msgCount} messages`);
  await mongoose.disconnect();
  process.exit(0);
}

run().catch((e) => {
  console.error('seed failed:', e.message);
  process.exit(1);
});
