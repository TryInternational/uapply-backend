/**
 * The admin dashboard's Stats breakdowns — everything the cards used to show
 * "Coming with the backend update" for:
 *
 *   people.{sales|am|ops}[]  one row per team member: students / applied /
 *                            offers / enrolled, and where their students went
 *                            (universities applied to, where they enrolled,
 *                            cities, levels) — each with the students behind it
 *   cities · schools · funding   students added in the range (Denied excluded,
 *                                cities = the UK cities of the universities
 *                                they applied to, not where they live;
 *                                as the channel card does)
 *   courses.applied/enrolled     applications in the range by course
 *   offerRate                    per university: offers vs rejections
 *   lostReasons                  students marked Lost in the range, by reason
 *   team[]                       one row per student with an application in
 *                                the range (Lost / Denied left out): intake,
 *                                level, channel, furthest stage and the
 *                                sales / am / ops ids — Team rankings filters
 *                                and tallies these in the browser
 *   speed                        median days lead → applied and applied →
 *                                first offer, this range vs the same range a
 *                                year earlier, a first-offer histogram and the
 *                                per-salesperson medians
 *
 * One set of definitions for every card (and the Sales leaderboard):
 *   applied   the student has a LIVE application (any stage), or enrolled
 *   offer     enrolled, or a LIVE application that is not rejected and has
 *             reached Conditional offer or later (an offer that has moved on
 *             to Confirmation / CAS / Done still counts)
 *   enrolled  Enrolled now or in an earlier journey (everEnrolled)
 * Students are scoped by createdAt (Stats, Analysis), applications by
 * createdAt + LIVE_ONLY (Top statistics, Offer rate, Team rankings).
 *
 * Two things are counted by WHEN THEY HAPPENED rather than by the cohort:
 *   enrolled in the period   students whose `enrolledAt` falls in the range,
 *                            whatever their date added (the Enrolled column,
 *                            "Where they enrolled", Top enrolled, enrolled
 *                            majors). A student with no enrolledAt (enrolled
 *                            before the date existed) counts by the cohort
 *                            rule instead, so nothing vanishes.
 *   lost in the period       students whose `lostAt` falls in the range
 *                            (updatedAt for those without one).
 * Conversion stays a cohort number — enrolled ÷ applied among the students
 * added in the range — because that is what a conversion rate means.
 *
 * With `intake` (e.g. "September 2026") the cohort is the students aiming at
 * that intake, whatever their date added — the cycle the business actually
 * runs on: a student added in October 2025 for September 2026 belongs to the
 * 2026 intake, and that intake's conversion is meaningful once it has started.
 * The Sales table, the Analysis card and the arrivals list follow the intake;
 * the application-scoped cards (Top statistics, offer rate, speed) keep the
 * date range.
 *
 * `arrivals` — students whose CAS was issued and whose intake has started but
 * who are not marked enrolled yet (the team used to tidy these into Done
 * months later). Listed so they can be confirmed one by one.
 *
 * `computeBreakdowns` is pure (plain objects in, plain objects out) so it is
 * unit-tested without Mongo; `getDashboardBreakdowns` only loads the inputs.
 */
const { Students, Application, CourseLevels, Courses, User } = require('../models');
const { LIVE_ONLY } = require('./application.service');

const PHASES = [
  'Initiated',
  'Submitted',
  'Conditional offer',
  'Unconditional offer',
  'Confirmation',
  'FG/BS',
  'CAS Received',
  'Done',
];
const OFFER_PHASES = ['Conditional offer', 'Unconditional offer'];
const DONE_IDX = PHASES.indexOf('Done');
const DAY = 24 * 60 * 60 * 1000;

/** assignedTo.role → slot. Same mapping as the profile's team chips (ProfileParts slotOfRole). */
const slotOf = (role) => {
  const r = String(role || '').toLowerCase();
  if (/sales|counsel/.test(r)) return 'sales';
  if (/account/.test(r)) return 'am';
  if (/operation|ops/.test(r)) return 'ops';
  return null;
};

const levelBucket = (name) => {
  const s = String(name || '').toLowerCase();
  if (!s) return null;
  if (s.includes('found')) return 'Foundation';
  if (s.includes('phd') || s.includes('doctor')) return 'PhD';
  if (s.includes('master') || s.includes('post')) return "Master's";
  if (s.includes('bachelor') || s.includes('under') || s.includes('degree') || s.includes('year')) return "Bachelor's";
  return null;
};

const validDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const phasesOf = (app) => (app && app.portalApplicationStatus && app.portalApplicationStatus.applicationPhases) || [];

/** The stage an application is at (the marker, else isCurrent) — currentPhaseStages in application.service. */
const currentPhase = (app) => {
  const ph = phasesOf(app);
  const awaiting = ph.find((p) => p && p.phaseState === 'AwaitingResponseStudent');
  if (awaiting) return awaiting.status;
  const cur = ph.find((p) => p && p.isCurrent);
  return cur ? cur.status : null;
};

/** How far it got: the current stage, else the furthest completed one. */
const reachedIdx = (app) => {
  const cur = currentPhase(app);
  if (cur) return PHASES.indexOf(cur);
  let best = -1;
  phasesOf(app).forEach((p) => {
    if (p && p.phaseState === 'Completed') best = Math.max(best, PHASES.indexOf(p.status));
  });
  return best;
};

/** When it was submitted: the stamped Submitted entry, else (if it is past Initiated) its creation. */
const submittedAt = (app) => {
  if (reachedIdx(app) < 1) return null;
  const sub = phasesOf(app).find((p) => p && p.status === 'Submitted');
  return validDate(sub && sub.createdDate) || validDate(app.createdAt);
};

/** When the first offer stage was entered — only stamped entries count (older records have none). */
const firstOfferAt = (app) => {
  if (reachedIdx(app) < PHASES.indexOf('Conditional offer')) return null;
  const dates = phasesOf(app)
    .filter(
      (p) =>
        p && OFFER_PHASES.includes(p.status) && (p.phaseState === 'Completed' || p.phaseState === 'AwaitingResponseStudent')
    )
    .map((p) => validDate(p.createdDate))
    .filter(Boolean);
  return dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null;
};

const median = (xs) => {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return Math.round(v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2);
};
const daysBetween = (a, b) => Math.max(0, (b.getTime() - a.getTime()) / DAY);

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
/** "Sep" / "September" / "9" + "2026" → "September 2026" (the students list's intake form) */
const fullIntake = (month, year) => {
  const m = String(month || '').trim();
  const y = String(year || '').trim();
  if (!m || !y) return null;
  const n = Number(m);
  const i =
    Number.isInteger(n) && n >= 1 && n <= 12
      ? n - 1
      : MONTHS.findIndex((x) => x.slice(0, 3).toLowerCase() === m.slice(0, 3).toLowerCase());
  return i >= 0 ? `${MONTHS[i]} ${y}` : `${m} ${y}`;
};
/** "September 2026" -> { month: 8, year: 2026 } (null when it is not an intake label) */
const parseIntake = (label) => {
  const m = /^([A-Za-z]+)\s+(\d{4})$/.exec(String(label || '').trim());
  if (!m) return null;
  const month = MONTHS.findIndex((x) => x.slice(0, 3).toLowerCase() === m[1].slice(0, 3).toLowerCase());
  return month >= 0 ? { month, year: Number(m[2]) } : null;
};
/** the student's intake: their own preference, else the first application that names one */
const intakeOfStudent = (s, apps) => {
  const pref = (s && s.preference) || {};
  if (pref.intakeMonth && pref.intakeYear) return fullIntake(pref.intakeMonth, pref.intakeYear);
  const app = (apps || []).find((a) => a.intakeMonth && a.intakeYear);
  return app ? fullIntake(app.intakeMonth, app.intakeYear) : null;
};
/** the day an intake starts (the 1st of its month) */
const intakeStart = (label) => {
  const p = parseIntake(label);
  return p ? new Date(Date.UTC(p.year, p.month, 1)) : null;
};

/* the channel card's labels (students.service getStudentsByChannel) */
const CHANNEL_LABEL = {
  subagent: 'Sub-agent',
  counselor: 'School counselor',
  lead: 'Online lead',
  direct: 'Walk-in',
  exhibition: 'Exhibition',
  referral: 'Referral',
  campaign: 'Campaign',
  other: 'Other',
};

const idOf = (x) => String((x && (x._id || x.id)) || x || '');
const nameOf = (s) => `${s.firstName || ''} ${s.lastName || ''}`.replace(/\s+/g, ' ').trim() || 'Student';
const uniOf = (app) => String((app && app.institute && app.institute.name) || '').trim();
const OFFER_IDX = PHASES.indexOf('Conditional offer');

/** Count rows by key, keeping the students behind each (for the click-through lists). */
const tally = (items, keyOf, extra) => {
  const m = new Map();
  items.forEach((it) => {
    const keys = [].concat(keyOf(it) || []).filter(Boolean);
    new Set(keys).forEach((k) => {
      const row = m.get(k) || { label: k, n: 0, students: [], ...(extra ? extra(it, k) : {}) };
      row.n += 1;
      if (it.__student) row.students.push(it.__student);
      m.set(k, row);
    });
  });
  return Array.from(m.values()).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
};
const counts = (items, keyOf) => tally(items, keyOf).map(({ label, n }) => ({ label, n }));

/** Lead → applied and applied → first-offer day spans for a set of students and their applications. */
const speedSpans = (students, appsByStudent) => {
  const leadToApplied = [];
  const appliedToOffer = [];
  const perStudent = new Map();
  students.forEach((s) => {
    const created = validDate(s.createdAt);
    const apps = appsByStudent.get(idOf(s)) || [];
    const subs = apps.map(submittedAt).filter(Boolean);
    const rec = { lead: null, offer: [] };
    if (created && subs.length) {
      const first = new Date(Math.min(...subs.map((d) => d.getTime())));
      rec.lead = daysBetween(created, first);
      leadToApplied.push(rec.lead);
    }
    apps.forEach((a) => {
      const sub = submittedAt(a);
      const off = firstOfferAt(a);
      if (sub && off && off >= sub) {
        const d = daysBetween(sub, off);
        rec.offer.push(d);
        appliedToOffer.push(d);
      }
    });
    perStudent.set(idOf(s), rec);
  });
  return { leadToApplied, appliedToOffer, perStudent };
};

const BUCKETS = [
  ['< 1 week', 0, 7],
  ['1–2 weeks', 7, 14],
  ['2–4 weeks', 14, 28],
  ['1–2 months', 28, 61],
  ['2+ months', 61, Infinity],
];

/**
 * @param {object} input
 * @param {object[]} input.students     students created in the range (lean)
 * @param {object[]} input.apps         LIVE applications of those students
 * @param {object[]} input.rangeApps    LIVE applications created in the range, each with `_studentStage`
 * @param {object[]} input.lostStudents students marked Lost in the range
 * @param {Map<string,string>} input.levelNames   course-level id → en_name
 * @param {Map<string,string>} input.courseNames  course id → name
 * @param {{students: object[], apps: object[]}|null} input.last  the same window a year earlier
 * @param {object[]} input.rangeStudents the students behind `rangeApps` (Team rankings)
 * @param {object[]|null} input.enrolledStudents students whose enrolledAt is in the range (any
 *   date added); null when there is no range, so the cohort rule applies
 */
/**
 * Enrolled now, or in an earlier journey — a student whose Foundation year
 * ended in a place and who has moved on to a Bachelor's journey (stage back at
 * NotApplied) still counts as enrolled for that Foundation.
 */
const everEnrolled = (s) =>
  !!s && (s.stage === 'Enrolled' || (Array.isArray(s.journeys) && s.journeys.some((j) => j && j.outcome === 'Enrolled')));

const computeBreakdowns = ({
  students = [],
  apps = [],
  rangeApps = [],
  lostStudents = [],
  levelNames = new Map(),
  courseNames = new Map(),
  courseCities = new Map(),
  // university name (lower-cased) → its usual UK city, for applications with no course link
  uniCities = new Map(),
  userNames = new Map(),
  last = null,
  rangeStudents = [],
  enrolledStudents = null,
  intake = null,
  now = new Date(),
}) => {
  const appsByStudent = new Map();
  apps.forEach((a) => {
    const k = idOf(a.studentId);
    appsByStudent.set(k, (appsByStudent.get(k) || []).concat(a));
  });
  const levelOfId = (raw) => levelBucket(levelNames.get(String(raw || '')) || raw);
  const levelOfStudent = (s) => {
    const own = levelOfId(s.preference && s.preference.courseLevel);
    if (own) return own;
    const fromApp = (appsByStudent.get(idOf(s)) || []).map((a) => levelOfId(a.courseLevel)).find(Boolean);
    return fromApp || null;
  };
  const courseOf = (a) => String(a.courseName || courseNames.get(idOf(a.course)) || '').trim();
  // "Cities" are where the student wants to study: the UK city of each university
  // they applied to (the course's locations, as the Courses page's Campus filter
  // reads them), else the campus named on the application. Not their home city.
  const citiesOfApp = (a) => {
    const fromCourse = courseCities.get(idOf(a.course)) || [];
    if (fromCourse.length) return fromCourse;
    const campus = String((a.campus && a.campus.name) || '').trim();
    if (campus) return [campus];
    // imported and hand-typed applications name the university but no course:
    // the city is where that university's catalogue courses are taught
    return uniCities.get(uniOf(a).toLowerCase()) || [];
  };
  const studyCities = (s) => Array.from(new Set((appsByStudent.get(idOf(s)) || []).flatMap(citiesOfApp)));
  /** the application a student enrolled with: the one that reached Done, else the one marked final choice */
  const enrolledApp = (s) => {
    const list = appsByStudent.get(idOf(s)) || [];
    return list.find((a) => reachedIdx(a) === DONE_IDX) || list.find((a) => a.finalChoice) || null;
  };
  /** applied: a LIVE application at any stage (a Lost student who applied did apply), or enrolled */
  const hasApplied = (s) => everEnrolled(s) || (appsByStudent.get(idOf(s)) || []).length > 0;
  /** reached an offer: enrolled, or a LIVE application not rejected at Conditional offer or later */
  const hasOffer = (s) =>
    everEnrolled(s) || (appsByStudent.get(idOf(s)) || []).some((a) => !a.rejected && reachedIdx(a) >= OFFER_IDX);
  const enrolledUni = (s) => {
    const a = enrolledApp(s);
    return a ? uniOf(a) : '';
  };
  // Enrolled in the period: by enrolment date when the range has one; students
  // without a date fall back to the cohort rule (see the header)
  const enrolledSet = (() => {
    if (!enrolledStudents) return students.filter(everEnrolled);
    const seen = new Set();
    return [...enrolledStudents, ...students.filter((s) => !s.enrolledAt && everEnrolled(s))].filter((s) => {
      const k = idOf(s);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  })();
  const ref = (s) => ({ id: idOf(s), name: nameOf(s) });
  const logos = {};
  apps.forEach((a) => {
    if (uniOf(a) && a.institute && a.institute.logoUrl && !logos[uniOf(a)]) logos[uniOf(a)] = a.institute.logoUrl;
  });

  /* ---------- per person ---------- */
  const spans = speedSpans(students, appsByStudent);
  const people = { sales: new Map(), am: new Map(), ops: new Map() };
  const eachSlot = (s, fn) => {
    const seen = new Set();
    (s.assignedTo || []).forEach((a) => {
      const slot = slotOf(a && a.role);
      const user = idOf(a && a.user);
      if (!slot || !user || user === 'null' || seen.has(`${slot}:${user}`)) return;
      seen.add(`${slot}:${user}`);
      fn(slot, user);
    });
  };
  const rowFor = (slot, user) => {
    const row = people[slot].get(user) || { userId: user, list: [], enrolledList: [] };
    people[slot].set(user, row);
    return row;
  };
  students.forEach((s) => eachSlot(s, (slot, user) => rowFor(slot, user).list.push(s)));
  // someone whose only students in the period are enrolments still gets a row
  enrolledSet.forEach((s) => eachSlot(s, (slot, user) => rowFor(slot, user).enrolledList.push(s)));
  const personRow = ({ userId, list, enrolledList }) => {
    const applied = list.filter(hasApplied);
    // cohort enrolled: the Conversion column (enrolled ÷ applied of the students added)
    const enrolled = list.filter(everEnrolled);
    const offers = list.filter(hasOffer);
    const tag = (s) => ({ ...s, __student: ref(s) });
    const withLogo = (rows) => rows.map((r) => ({ ...r, logoUrl: logos[r.label] || null }));
    const leads = list.map((s) => spans.perStudent.get(idOf(s))).filter(Boolean);
    return {
      userId,
      students: list.length,
      applied: applied.length,
      offers: offers.length,
      enrolled: enrolled.length,
      // enrolled in the period, by enrolment date (the Enrolled column)
      enrolledInPeriod: enrolledList.length,
      universities: withLogo(tally(applied.map(tag), (s) => (appsByStudent.get(idOf(s)) || []).map(uniOf))),
      enrolledAt: withLogo(tally(enrolledList.map(tag), enrolledUni)),
      cities: tally(applied.map(tag), studyCities),
      levels: tally(applied.map(tag), levelOfStudent),
      speed: {
        leadToApplied: median(leads.map((r) => r.lead).filter((x) => x != null)),
        appliedToOffer: median([].concat(...leads.map((r) => r.offer))),
      },
    };
  };
  const peopleOut = {};
  Object.keys(people).forEach((slot) => {
    peopleOut[slot] = Array.from(people[slot].values())
      .map(personRow)
      .sort((a, b) => b.applied - a.applied || b.students - a.students);
  });

  /* ---------- analysis panels (Denied excluded, as the channel card does) ---------- */
  const live = students.filter((s) => s.stage !== 'Denied');
  const cities = counts(live, studyCities);
  const schools = counts(live, (s) => String(s.previousSchool || '').trim());
  // the profile's Funding chip: "Govt Sponsor" is Sponsored, any other stated source is self-funded
  const funding = counts(live, (s) => {
    const f = String(s.sourceOfFund || '').trim();
    if (!f) return null;
    return f === 'Govt Sponsor' ? 'Sponsored' : 'Self-funded';
  });

  /* ---------- courses (Top statistics · majors) ---------- */
  // "applications sent": past Initiated (an application still being prepared
  // was not sent), whatever the student's stage now
  const appliedApps = rangeApps.filter((a) => reachedIdx(a) >= PHASES.indexOf('Submitted'));
  const courseRows = (list) => {
    const m = new Map();
    list.forEach((a) => {
      const c = courseOf(a);
      if (!c) return;
      const row = m.get(c) || { label: c, n: 0, levels: {} };
      row.n += 1;
      const lvl = levelOfId(a.courseLevel);
      if (lvl) row.levels[lvl] = (row.levels[lvl] || 0) + 1;
      m.set(c, row);
    });
    return Array.from(m.values()).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
  };
  // Enrolled = students enrolled in the period (by enrolment date), by the
  // application they enrolled with — the same students as "Where they enrolled".
  const enrolledApps = enrolledSet.map((s) => ({ s, a: enrolledApp(s) })).filter((x) => x.a);
  const courses = {
    applied: courseRows(appliedApps),
    enrolled: courseRows(enrolledApps.map((x) => x.a)),
  };
  /* ---------- Top statistics card: rows it counts and filters (Level, Intake) in the browser ---------- */
  const topRow = (a, s) => ({
    uni: uniOf(a) || null,
    logoUrl: (a.institute && a.institute.logoUrl) || null,
    course: courseOf(a) || null,
    level: levelOfId(a.courseLevel),
    intake:
      fullIntake(a.intakeMonth, a.intakeYear) ||
      (s && s.preference ? fullIntake(s.preference.intakeMonth, s.preference.intakeYear) : null),
  });
  const top = {
    applications: appliedApps.map((a) => ({
      studentId: idOf(a.studentId),
      studentName: a._studentName || 'Student',
      // reached an offer stage and not rejected — the design's "→ Offers"
      offer: !a.rejected && reachedIdx(a) >= OFFER_IDX,
      ...topRow(a, null),
    })),
    enrolled: enrolledApps.map(({ s, a }) => ({ studentId: idOf(s), studentName: nameOf(s), ...topRow(a, s) })),
  };

  /* ---------- offer rate by university ---------- */
  const uni = new Map();
  rangeApps.forEach((a) => {
    const u = uniOf(a);
    if (!u) return;
    const row = uni.get(u) || {
      label: u,
      logoUrl: (a.institute && a.institute.logoUrl) || null,
      applied: 0,
      offers: 0,
      rejected: 0,
    };
    row.applied += 1;
    if (a.rejected) row.rejected += 1;
    else if (reachedIdx(a) >= OFFER_IDX) row.offers += 1;
    uni.set(u, row);
  });
  const offerRate = Array.from(uni.values())
    .filter((r) => r.offers + r.rejected > 0)
    .sort((a, b) => b.offers + b.rejected - (a.offers + a.rejected));

  /* ---------- lost reasons ---------- */
  // every Lost student counts; one moved to Lost without "Move to lost" has no reason saved
  const lostReasons = counts(lostStudents, (s) => String(s.lostReason || '').trim() || 'No reason recorded');

  /* ---------- speed ---------- */
  const lastSpans = last
    ? speedSpans(
        last.students || [],
        (() => {
          const m = new Map();
          (last.apps || []).forEach((a) => m.set(idOf(a.studentId), (m.get(idOf(a.studentId)) || []).concat(a)));
          return m;
        })()
      )
    : null;
  const offerN = spans.appliedToOffer.length;
  const speed = {
    leadToApplied: {
      now: median(spans.leadToApplied),
      last: lastSpans ? median(lastSpans.leadToApplied) : null,
      n: spans.leadToApplied.length,
    },
    appliedToOffer: {
      now: median(spans.appliedToOffer),
      last: lastSpans ? median(lastSpans.appliedToOffer) : null,
      n: offerN,
    },
    buckets: BUCKETS.map(([label, lo, hi]) => {
      const n = spans.appliedToOffer.filter((d) => d >= lo && d < hi).length;
      return { label, n, pct: offerN ? Math.round((n / offerN) * 100) : 0 };
    }),
  };

  const sponsored = (funding.find((r) => r.label === 'Sponsored') || {}).n || 0;

  /* ---------- Analysis card: one row per student (design anBase / anOutcome) ----------
     The card filters and counts these in the browser, so every KPI and panel
     on it describes the same set of students. */
  const providerOf = (s) => {
    const own = String((s.preference && s.preference.provider) || '').trim();
    if (own && own.toUpperCase() !== 'N/A') return own;
    const app = (appsByStudent.get(idOf(s)) || []).find((a) => {
      const pv = String(a.provider || '').trim();
      return pv && pv.toUpperCase() !== 'N/A' && levelOfId(a.courseLevel) === 'Foundation';
    });
    return app ? String(app.provider).trim() : null;
  };
  const intakeOf = (s) => intakeOfStudent(s, appsByStudent.get(idOf(s)) || []);
  const analysis = live.map((s) => {
    const list = appsByStudent.get(idOf(s)) || [];
    const ch = String(s.channel || 'direct').toLowerCase();
    const channel = CHANNEL_LABEL[ch] || CHANNEL_LABEL.other;
    // the design's "partner": the sub-agent / school counsellor who referred them, else the channel
    const referrer = (ch === 'subagent' || ch === 'counselor') && s.createdBy ? userNames.get(idOf(s.createdBy)) : null;
    const enrolledNow = everEnrolled(s);
    const f = String(s.sourceOfFund || '').trim();
    const fundingOf = (v) => {
      if (!v) return null;
      return v === 'Govt Sponsor' ? 'Sponsored' : 'Self-funded';
    };
    return {
      id: idOf(s),
      name: nameOf(s),
      intake: intakeOf(s),
      level: levelOfStudent(s),
      school: String(s.previousSchool || '').trim() || null,
      funding: fundingOf(f),
      cities: studyCities(s),
      unis: Array.from(new Set(list.map(uniOf).filter(Boolean))),
      provider: providerOf(s),
      channel,
      partner: referrer || channel,
      applied: hasApplied(s),
      offer: hasOffer(s),
      enrolled: enrolledNow,
    };
  });

  /* ---------- Team rankings (design teamRankings): one row per student with an application
     in the range, the card filters by intake / level / channel / stage and tallies in the browser.
     stage = the furthest stage among their range applications (not-rejected ones first). ---------- */
  const rangeByStudent = new Map();
  rangeApps.forEach((a) => {
    const k = idOf(a.studentId);
    rangeByStudent.set(k, (rangeByStudent.get(k) || []).concat(a));
  });
  const team = rangeStudents
    .filter((s) => s && !['Lost', 'Denied'].includes(s.stage))
    .map((s) => {
      const list = rangeByStudent.get(idOf(s)) || [];
      const open = list.filter((a) => !a.rejected);
      const idx = Math.max(-1, ...(open.length ? open : list).map(reachedIdx));
      if (idx < 0) return null;
      const slots = { sales: [], am: [], ops: [] };
      (s.assignedTo || []).forEach((a) => {
        const slot = slotOf(a && a.role);
        const user = idOf(a && a.user);
        if (slot && user && user !== 'null' && !slots[slot].includes(user)) slots[slot].push(user);
      });
      const pref = s.preference || {};
      const appWith = (f) => list.find(f);
      const intakeApp = appWith((a) => a.intakeMonth && a.intakeYear);
      const ch = String(s.channel || 'direct').toLowerCase();
      return {
        id: idOf(s),
        name: nameOf(s),
        intake:
          fullIntake(pref.intakeMonth, pref.intakeYear) ||
          (intakeApp ? fullIntake(intakeApp.intakeMonth, intakeApp.intakeYear) : null),
        level: levelOfId(pref.courseLevel) || list.map((a) => levelOfId(a.courseLevel)).find(Boolean) || null,
        channel: CHANNEL_LABEL[ch] || CHANNEL_LABEL.other,
        stage: PHASES[idx],
        stageIdx: idx,
        ...slots,
      };
    })
    .filter(Boolean);

  /* ---------- arrivals: CAS issued, intake started, not yet enrolled ----------
     With an intake picked, that intake's; otherwise every intake that has
     started. Each row names the application to confirm (move to Done). */
  const CAS_IDX = PHASES.indexOf('CAS Received');
  const arrivals = students
    .filter((s) => !['Enrolled', 'Lost', 'Denied'].includes(s.stage) && !everEnrolled(s))
    .map((s) => {
      const label = intakeOf(s);
      const start = intakeStart(label);
      if (!start || start > now) return null;
      if (intake && label !== intake) return null;
      const app = (appsByStudent.get(idOf(s)) || [])
        .filter((a) => !a.rejected && reachedIdx(a) >= CAS_IDX)
        .sort((a, b) => reachedIdx(b) - reachedIdx(a))[0];
      if (!app) return null;
      const slots = { sales: [], am: [], ops: [] };
      (s.assignedTo || []).forEach((a) => {
        const slot = slotOf(a && a.role);
        const user = idOf(a && a.user);
        if (slot && user && user !== 'null' && !slots[slot].includes(user)) slots[slot].push(user);
      });
      return {
        studentId: idOf(s),
        studentName: nameOf(s),
        applicationId: idOf(app),
        uni: uniOf(app) || null,
        logoUrl: (app.institute && app.institute.logoUrl) || null,
        course: courseOf(app) || null,
        intake: label,
        stage: PHASES[reachedIdx(app)],
        ...slots,
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(a.intake).localeCompare(String(b.intake)) || a.studentName.localeCompare(b.studentName));

  return {
    cohort: intake ? { intake } : { range: true },
    arrivals,
    people: peopleOut,
    cities,
    schools,
    funding,
    sponsored,
    courses,
    top,
    offerRate,
    lostReasons,
    speed,
    analysis,
    team,
  };
};

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */
const STUDENT_FIELDS = {
  firstName: 1,
  lastName: 1,
  stage: 1,
  createdAt: 1,
  previousSchool: 1,
  sourceOfFund: 1,
  'preference.courseLevel': 1,
  'preference.intakeMonth': 1,
  'preference.intakeYear': 1,
  'preference.provider': 1,
  'journeys.outcome': 1,
  enrolledAt: 1,
  channel: 1,
  createdBy: 1,
  assignedTo: 1,
};
const APP_FIELDS = {
  studentId: 1,
  institute: 1,
  courseName: 1,
  course: 1,
  courseLevel: 1,
  createdAt: 1,
  rejected: 1,
  finalChoice: 1,
  'campus.name': 1,
  provider: 1,
  intakeMonth: 1,
  intakeYear: 1,
  'portalApplicationStatus.applicationPhases.status': 1,
  'portalApplicationStatus.applicationPhases.phaseState': 1,
  'portalApplicationStatus.applicationPhases.isCurrent': 1,
  'portalApplicationStatus.applicationPhases.createdDate': 1,
};

const rangeOf = (startDate, endDate) => {
  if (!startDate || !endDate) return null;
  const s = new Date(startDate);
  const e = new Date(endDate);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null;
  return { $gte: s, $lte: e };
};
const yearEarlier = (r) => {
  if (!r) return null;
  const s = new Date(r.$gte);
  const e = new Date(r.$lte);
  s.setFullYear(s.getFullYear() - 1);
  e.setFullYear(e.getFullYear() - 1);
  return { $gte: s, $lte: e };
};

// `autopopulate` is off for these reads: `course` stays an id, named below in one query.
const findApps = (filter) => Application.find(filter, APP_FIELDS, { autopopulate: false }).lean();

const studentsWithApps = async (created) => {
  const students = await Students.find(created ? { createdAt: created } : {}, STUDENT_FIELDS).lean();
  const ids = students.map((s) => s._id);
  const apps = ids.length ? await findApps({ ...LIVE_ONLY, studentId: { $in: ids } }) : [];
  return { students, apps };
};
// students enrolled in the range, whatever their date added (null = no range: the cohort rule)
const enrolledInRange = async (created) => {
  if (!created) return null;
  const students = await Students.find({ enrolledAt: created }, STUDENT_FIELDS).lean();
  const ids = students.map((s) => s._id);
  const apps = ids.length ? await findApps({ ...LIVE_ONLY, studentId: { $in: ids } }) : [];
  return { students, apps };
};

// the students aiming at an intake, whatever their date added (their own intake, else an application's)
const intakeCohort = async (intake) => {
  const p = parseIntake(intake);
  if (!p) return null;
  const years = [String(p.year), p.year];
  const [byPref, appIds] = await Promise.all([
    Students.find({ 'preference.intakeYear': { $in: years } }, STUDENT_FIELDS).lean(),
    Application.distinct('studentId', { ...LIVE_ONLY, intakeYear: { $in: years } }),
  ]);
  const seen = new Set(byPref.map((s) => idOf(s)));
  const extra = appIds.filter((id) => !seen.has(idOf(id)));
  const byApp = extra.length ? await Students.find({ _id: { $in: extra } }, STUDENT_FIELDS).lean() : [];
  const candidates = byPref.concat(byApp);
  const ids = candidates.map((s) => s._id);
  const apps = ids.length ? await findApps({ ...LIVE_ONLY, studentId: { $in: ids } }) : [];
  const byStudent = new Map();
  apps.forEach((a) => byStudent.set(idOf(a.studentId), (byStudent.get(idOf(a.studentId)) || []).concat(a)));
  const students = candidates.filter((s) => intakeOfStudent(s, byStudent.get(idOf(s)) || []) === intake);
  const keep = new Set(students.map((s) => idOf(s)));
  return { students, apps: apps.filter((a) => keep.has(idOf(a.studentId))) };
};
// every intake students aim at, newest first, with how many (the picker)
const intakeOptions = async () => {
  const [students, apps] = await Promise.all([
    Students.find({ 'preference.intakeYear': { $exists: true, $ne: null } }, { preference: 1 }).lean(),
    Application.find(
      { ...LIVE_ONLY, intakeYear: { $exists: true, $ne: null } },
      { studentId: 1, intakeMonth: 1, intakeYear: 1 },
      { autopopulate: false }
    ).lean(),
  ]);
  const byStudent = new Map();
  apps.forEach((a) => byStudent.set(idOf(a.studentId), (byStudent.get(idOf(a.studentId)) || []).concat(a)));
  const seen = new Set();
  const count = new Map();
  students.forEach((s) => {
    seen.add(idOf(s));
    const label = intakeOfStudent(s, byStudent.get(idOf(s)) || []);
    if (label) count.set(label, (count.get(label) || 0) + 1);
  });
  byStudent.forEach((list, sid) => {
    if (seen.has(sid)) return;
    const label = intakeOfStudent({}, list);
    if (label) count.set(label, (count.get(label) || 0) + 1);
  });
  return Array.from(count.entries())
    .map(([label, n]) => ({ label, students: n, start: intakeStart(label) }))
    .filter((x) => x.start)
    .sort((a, b) => b.start - a.start)
    .map((x) => ({ label: x.label, students: x.students }));
};

const getDashboardBreakdowns = async ({ startDate, endDate, intake } = {}) => {
  const created = rangeOf(startDate, endDate);
  const before = yearEarlier(created);
  const wantIntake = parseIntake(intake) ? String(intake).trim() : null;
  const [cohortIn, rangeApps, lostStudents, levels, last, enrolled, intakes] = await Promise.all([
    wantIntake ? intakeCohort(wantIntake) : studentsWithApps(created),
    findApps({ ...LIVE_ONLY, ...(created ? { createdAt: created } : {}) }),
    // lost in the range by the date they were marked Lost; updatedAt for records without one
    Students.find(
      {
        stage: 'Lost',
        ...(created ? { $or: [{ lostAt: created }, { lostAt: null, updatedAt: created }] } : {}),
      },
      { lostReason: 1 }
    ).lean(),
    CourseLevels.find({}, { en_name: 1 }).lean(),
    before && !wantIntake ? studentsWithApps(before) : Promise.resolve(null),
    // an intake cohort counts its own enrolments; a date range counts enrolments in the period
    wantIntake ? Promise.resolve(null) : enrolledInRange(created),
    intakeOptions(),
  ]);
  const { students, apps: cohortApps } = cohortIn;
  // the enrolled-in-period students' applications, for "Where they enrolled"
  const apps = enrolled
    ? cohortApps.concat(enrolled.apps.filter((a) => !cohortApps.some((b) => idOf(b) === idOf(a))))
    : cohortApps;

  // the stage of each range application's student (the top-universities card's gate)
  const stuIds = Array.from(new Set(rangeApps.map((a) => idOf(a.studentId)).filter(Boolean)));
  // the full fields: Team rankings filters these students by intake / level / channel and their team
  const stages = stuIds.length ? await Students.find({ _id: { $in: stuIds } }, STUDENT_FIELDS).lean() : [];
  const stageOf = new Map(stages.map((s) => [idOf(s), s.stage]));
  const nameOfStudent = new Map(stages.map((s) => [idOf(s), nameOf(s)]));
  rangeApps.forEach((a) => {
    // eslint-disable-next-line no-param-reassign
    a._studentStage = stageOf.get(idOf(a.studentId)) || null;
    // eslint-disable-next-line no-param-reassign
    a._studentName = nameOfStudent.get(idOf(a.studentId)) || null;
  });

  // course names (for applications that only carry the course id) and the
  // course's study locations (the Cities panels)
  const courseIds = Array.from(new Set([...rangeApps, ...apps].filter((a) => a.course).map((a) => idOf(a.course))));
  const courseDocs = courseIds.length
    ? await Courses.find({ _id: { $in: courseIds } }, { name: 1, locations: 1 }, { autopopulate: false }).lean()
    : [];
  const ukCities = (c) =>
    Array.from(
      new Set(
        (Array.isArray(c.locations) ? c.locations : [])
          .filter((l) => l && (!l.key || /united kingdom|^uk$|england|scotland|wales|northern ireland/i.test(String(l.key))))
          .map((l) => String((l && l.value) || '').trim())
          .filter(Boolean)
      )
    );

  // Applications with no course link (the Trello import, hand-typed ones) still
  // name the university: borrow the city from that university's catalogue
  // courses, keeping its most common UK city.
  const uniNames = Array.from(
    new Set(
      [...rangeApps, ...apps]
        .filter((a) => !a.course)
        .map(uniOf)
        .filter(Boolean)
    )
  );
  const uniCourseDocs = uniNames.length
    ? await Courses.find(
        // case-insensitive exact names (escaped: the names are data, not patterns)
        // eslint-disable-next-line security/detect-non-literal-regexp
        { institution: { $in: uniNames.map((n) => new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')) } },
        { institution: 1, locations: 1 },
        { autopopulate: false }
      ).lean()
    : [];
  const cityTallies = new Map();
  uniCourseDocs.forEach((c) => {
    const key = String(c.institution || '')
      .trim()
      .toLowerCase();
    if (!key) return;
    const tallyFor = cityTallies.get(key) || new Map();
    ukCities(c).forEach((city) => tallyFor.set(city, (tallyFor.get(city) || 0) + 1));
    cityTallies.set(key, tallyFor);
  });
  const uniCities = new Map(
    Array.from(cityTallies.entries()).map(([key, tallyFor]) => [
      key,
      Array.from(tallyFor.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 1)
        .map(([city]) => city),
    ])
  );

  // the partners who referred sub-agent / school-counsellor students (the Analysis "Source")
  const referrerIds = Array.from(
    new Set(
      students
        .filter((s) => ['subagent', 'counselor'].includes(String(s.channel || '').toLowerCase()) && s.createdBy)
        .map((s) => idOf(s.createdBy))
    )
  );
  const referrers = referrerIds.length ? await User.find({ _id: { $in: referrerIds } }, { name: 1 }).lean() : [];

  const out = computeBreakdowns({
    students,
    apps,
    rangeApps,
    lostStudents,
    levelNames: new Map(levels.map((l) => [idOf(l), l.en_name])),
    courseNames: new Map(courseDocs.filter((c) => c.name).map((c) => [idOf(c), c.name])),
    courseCities: new Map(courseDocs.map((c) => [idOf(c), ukCities(c)])),
    uniCities,
    userNames: new Map(referrers.filter((u) => u.name).map((u) => [idOf(u), u.name])),
    last,
    rangeStudents: stages,
    enrolledStudents: enrolled ? enrolled.students : null,
    intake: wantIntake,
  });
  return { ...out, intakes };
};

module.exports = {
  getDashboardBreakdowns,
  computeBreakdowns,
  slotOf,
  reachedIdx,
  submittedAt,
  firstOfferAt,
  median,
};
