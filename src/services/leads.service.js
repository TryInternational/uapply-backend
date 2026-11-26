const httpStatus = require('http-status');
const mongoose = require('mongoose');
const { Leads, Students, Reminder, CourseLevels, User } = require('../models');
const ApiError = require('../utils/ApiError');
const { logActivity } = require('./activities.service');
const { kuwaitDayRange } = require('../utils/kuwaitDays');

/**
 * Create a lead
 * @param {Object} leadBody
 * @returns {Promise<Leads>}
 */
const createLead = async (studentBody) => {
  // if (await Leads.isEmailTaken(studentBody.email)) {
  //   throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
  // }
  return Leads.create({ ...studentBody, phoneNo: studentBody.phoneNo.replace(/[+\s]/g, '') });
};

/**
 * Query for users
 * @param {Object} filter - Mongo filter
 * @param {Object} options - Query options
 * @param {string} [options.sortBy] - Sort option in the format: sortField:(desc|asc)
 * @param {number} [options.limit] - Maximum number of results per page (default = 10)
 * @param {number} [options.page] - Current page (default = 1)
 * @returns {Promise<QueryResult>}
 */

const queryLeads = async (filter, options) => {
  const lead = await Leads.paginate(filter, options);
  return lead;
};

const getTop5ByContries = async (data) => {
  const matchQuery = {
    qualified: true,
  };

  // Check if qualification status is provided and add it to the match query
  if (data.status) {
    matchQuery.status = data.status;
  }

  // The Kuwait days asked for, as dates. They were passed to the aggregate as
  // text, which never matches a date there, so the list was always empty; and
  // with no dates at all the conversion threw before the `if` was reached.
  const range = kuwaitDayRange(data.startDate, data.endDate);
  if (range) {
    matchQuery.createdAt = { $gte: range.from, $lte: range.to };
  }

  const aggregationPipeline = [
    {
      $match: matchQuery,
    },
    {
      $group: {
        _id: '$nationality.english_name', // Grouping by country name
        countryCode: { $first: '$nationality.alpha2_code' },
        count: { $sum: 1 },
      },
    },
    {
      $sort: { count: -1 }, // Sort by count in descending order
    },
    {
      $limit: 5, // Limit to top 5 countries
    },
  ];
  const result = await Leads.aggregate(aggregationPipeline);

  return result;
};

const getTop5ByDegree = async (data) => {
  const matchQuery = {
    qualified: true,
  };

  // The Kuwait days asked for, as dates. They were passed to the aggregate as
  // text, which never matches a date there, so the list was always empty; and
  // with no dates at all the conversion threw before the `if` was reached.
  const range = kuwaitDayRange(data.startDate, data.endDate);
  if (range) {
    matchQuery.createdAt = { $gte: range.from, $lte: range.to };
  }
  const aggregationPipeline = [
    {
      $match: matchQuery,
    },
    {
      $group: {
        _id: '$degree.en_name', // Grouping by country name
        count: { $sum: 1 },
      },
    },
    {
      $sort: { count: -1 }, // Sort by count in descending order
    },
    {
      $limit: 5, // Limit to top 5 countries
    },
  ];
  const result = await Leads.aggregate(aggregationPipeline);

  return result;
};

/**
 * Get student by id
 * @param {ObjectId} id
 * @returns {Promise<Leads>}
 */
const getLeadById = async (id) => {
  return Leads.findById(id);
};

/**
 * Get student by email
 * @param {string} email
 * @returns {Promise<Leads>}
 */
const getLeadByEmail = async (email) => {
  return Leads.findOne({ email });
};

/**
 * Update lead by id
 * @param {ObjectId} leadId
 * @param {Object} updateBody
 * @returns {Promise<Leads>}
 */
const updateLeadById = async (leadId, updateBody) => {
  const lead = await getLeadById(leadId);
  if (!lead) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Leads not found');
  }
  // if (updateBody.email && (await Leads.isEmailTaken(updateBody.email, studentId))) {
  //   throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
  // }
  Object.assign(lead, updateBody);
  await lead.save();
  return lead;
};

/**
 * Delete student by id
 * @param {ObjectId} leadId
 * @returns {Promise<Leads>}
 */
const deleteLeadById = async (leadId) => {
  const lead = await getLeadById(leadId);
  if (!lead) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Leads not found');
  }
  await lead.remove();
  return lead;
};

const countLeads = async (filter) => {
  return Leads.countDocuments(filter);
};

// typed text is matched literally — "+965…" or "(" used to throw and fail the search
const literal = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const searchLead = async (text, options, extraFilter) => {
  // eslint-disable-next-line security/detect-non-literal-regexp
  const regex = new RegExp(literal(text), 'i');
  // `status` is optional (the back office's status tabs); without it the
  // search behaves exactly as before. `extraFilter` carries the Leads filter
  // drawer's choices (degree, destination, residence, …) so a search keeps them.
  const match = { $or: [{ fullname: regex }, { phoneNo: regex }, { email: regex }] };
  // no `qualified` = both (the filter drawer's Qualification cleared)
  if (options.qualified !== undefined && options.qualified !== '') match.qualified = options.qualified;
  if (options.status) match.status = options.status;
  const leads = await Leads.paginate({ $and: [match, ...(extraFilter ? [extraFilter] : [])] }, options);
  return leads;
};

const escapeRegex = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Mongo filter for the Ad Source column (utm_source in the landing `webUrl`):
 * "N/A" = no landing URL, "No Ad" = a URL without a campaign tag, anything
 * else = that utm_source (labels are cut at 20 characters, so a 20-character
 * value matches as a prefix).
 * @param {string} value
 */
const adSourceFilter = (value) => {
  if (!value) return null;
  if (value === 'N/A') return { $or: [{ webUrl: { $exists: false } }, { webUrl: null }, { webUrl: '' }] };
  if (value === 'No Ad') return { webUrl: { $exists: true, $nin: [null, ''], $not: /[?&]utm_source=[^&#]/ } };
  const tail = value.length >= 20 ? '' : '(?:[&#]|$)';
  // eslint-disable-next-line security/detect-non-literal-regexp
  return { webUrl: new RegExp(`[?&]utm_source=${escapeRegex(value)}${tail}`) };
};

// Same derivation as adSourceFilter, as an aggregation expression.
const AD_SOURCE_EXPR = {
  $let: {
    vars: {
      url: { $ifNull: ['$webUrl', ''] },
      m: { $regexFind: { input: { $ifNull: ['$webUrl', ''] }, regex: /[?&]utm_source=([^&#]*)/ } },
    },
    in: {
      $cond: [
        { $eq: ['$$url', ''] },
        'N/A',
        {
          $let: {
            vars: { cap: { $ifNull: [{ $arrayElemAt: [{ $ifNull: ['$$m.captures', []] }, 0] }, ''] } },
            in: { $cond: [{ $gt: [{ $strLenCP: '$$cap' }, 0] }, { $substrCP: ['$$cap', 0, 20] }, 'No Ad'] },
          },
        },
      ],
    },
  },
};

/**
 * Options + counts for the Leads filter drawer, scoped to the qualification
 * (and status tab) the list is showing.
 * @param {{ qualified?: string|boolean, status?: string }} query
 */
const leadFacets = async ({ qualified, status, assignedTo } = {}) => {
  const match = {};
  if (assignedTo && mongoose.Types.ObjectId.isValid(String(assignedTo))) {
    match.assignedTo = mongoose.Types.ObjectId(String(assignedTo));
  }
  if (qualified === true || qualified === 'true') match.qualified = true;
  else if (qualified === false || qualified === 'false') match.qualified = false;
  if (status) match.status = String(status);
  const count = (expr) => [
    { $group: { _id: expr, count: { $sum: 1 } } },
    { $match: { _id: { $nin: [null, ''] } } },
    { $sort: { count: -1, _id: 1 } },
    { $limit: 60 },
  ];
  const [res] = await Leads.aggregate([
    { $match: match },
    {
      $facet: {
        degree: count('$degree.en_name'),
        destination: count('$destination.en_name'),
        residence: count('$residence.english_name'),
        nationality: count('$nationality.english_name'),
        adSource: count(AD_SOURCE_EXPR),
        platform: count('$source'),
      },
    },
  ]);
  const out = {};
  Object.entries(res || {}).forEach(([k, rows]) => {
    out[k] = rows.map((r) => ({ value: String(r._id), count: r.count }));
  });
  return out;
};

/**
 * Convert a lead into a student. Maps the lead's fields onto a new Students doc
 * (channel = 'lead' so it shows under "Online lead"), links the lead to the new
 * student, and marks the lead 'Converted'. Guards against double-conversion and
 * duplicate emails.
 * @param {ObjectId} leadId
 * @returns {Promise<Students>} the created student
 */
const leadOrThrow = async (leadId) => {
  const lead = mongoose.isValidObjectId(leadId) ? await Leads.findById(leadId) : null;
  if (!lead) throw new ApiError(httpStatus.NOT_FOUND, 'Lead not found');
  return lead;
};

// "Master's" / "Masters" / "master" all compare equal.
const levelKey = (v) =>
  String(v || '')
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    .replace(/s$/, '');

// The lead form stores the degree as { en_name }; the student keeps the
// CourseLevels id in preference.courseLevel.
const courseLevelIdFor = async (degree) => {
  const name = degree && typeof degree === 'object' ? degree.en_name || degree.name : degree;
  const key = levelKey(name);
  if (!key) return undefined;
  const levels = await CourseLevels.find({}, 'en_name').lean();
  const hit = levels.find((l) => levelKey(l.en_name) === key);
  return hit ? String(hit._id) : undefined;
};

const nameOf = (v) => (v && typeof v === 'object' ? v.en_name || v.name || v.label || v.value : v);

/**
 * Convert a lead into a student: creates the student record (channel 'lead'),
 * carries the lead's profile and counselor across, links the lead and marks it
 * Converted, and moves any follow-up reminders onto the new student.
 * @param {ObjectId} leadId
 * @param {{ id?: string, name?: string }} [actor] - who converted it
 */
const convertLeadToStudent = async (leadId, actor = {}) => {
  const lead = await leadOrThrow(leadId);
  if (lead.convertedStudentId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This lead has already been converted to a student');
  }
  if (lead.email && (await Students.isEmailTaken(lead.email))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'A student with this email already exists');
  }

  const name = String(lead.fullname || '').trim();
  const parts = name.split(/\s+/).filter(Boolean);
  const firstName = parts.shift() || name || 'Lead';
  const lastName = parts.join(' ');
  const destName = nameOf(lead.destination);
  const universities = (lead.selectedUniversity || []).map(nameOf).filter(Boolean);

  // Reference number — same scheme the students controller uses (ddMMyy-000N).
  const studentCount = await Students.countDocuments();
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const refrenceNo = `${pad(now.getDate())}${pad(now.getMonth() + 1)}${String(now.getFullYear()).slice(-2)}-000${
    studentCount + 1
  }`;

  // The lead's counselor becomes the student's sales owner.
  const counselor = lead.assignedTo ? await User.findById(lead.assignedTo, 'role').lean() : null;
  const assignedTo = counselor ? [{ user: counselor._id, role: 'sales', userRole: counselor.role }] : [];

  const student = await Students.create({
    firstName,
    lastName,
    refrenceNo,
    email: lead.email || undefined,
    phoneNo: lead.phoneNo,
    city: lead.city,
    cgpa: lead.cgpa,
    testScore: lead.iltesScore,
    nationality: lead.nationality || undefined,
    residence: lead.residence || undefined,
    previousSchool: lead.previousSchool || undefined,
    parentsIncome: lead.parentsIncome || undefined,
    source: lead.source || 'uapply',
    channel: 'lead',
    stage: 'NotApplied',
    qualified: lead.qualified,
    assignedTo,
    createdBy: actor.id && mongoose.isValidObjectId(actor.id) ? actor.id : undefined,
    preference: {
      studyDestinations: destName,
      courseLevel: await courseLevelIdFor(lead.degree),
      // same shape the back-office Add student form writes
      courseSubjectIds: String(lead.subjects || '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
        .map((n) => ({ name: n })),
      universities: universities.length ? universities : undefined,
      sponsoredBy: lead.sponsoredBy || undefined,
    },
    applications: [],
  });

  lead.convertedStudentId = student._id;
  lead.status = 'Converted';
  lead.convertedAt = new Date();
  await lead.save();

  await Reminder.updateMany({ lead: lead._id }, { $set: { student: student._id } });
  await logActivity({
    student: student._id,
    type: 'note',
    text: 'Converted from lead',
    actorId: actor.id,
    actorName: actor.name,
    meta: { leadId: String(lead._id) },
  });

  return student;
};

/**
 * Hand a lead to another counselor. Open follow-ups move with it.
 * @param {ObjectId} leadId
 * @param {ObjectId} userId - the counselor
 */
const assignLead = async (leadId, userId) => {
  const lead = await leadOrThrow(leadId);
  const user = mongoose.isValidObjectId(userId) ? await User.findById(userId, '_id').lean() : null;
  if (!user) throw new ApiError(httpStatus.BAD_REQUEST, 'Pick a counselor from the team');
  lead.assignedTo = user._id;
  lead.assignedAt = new Date();
  await lead.save();
  await Reminder.updateMany({ lead: lead._id, status: { $ne: 'completed' } }, { $set: { user: user._id } });
  return lead;
};

/**
 * Set the lead's next follow-up: stores the date on the lead and keeps one open
 * follow-up reminder for the lead's counselor (or, with none, the caller), so it
 * shows on their desk and in the nav calendar.
 * @param {ObjectId} leadId
 * @param {{ dueDate: string, note?: string }} body
 * @param {string} [actorId]
 */
const setLeadFollowUp = async (leadId, body, actorId) => {
  const { dueDate, note } = body || {};
  const lead = await leadOrThrow(leadId);
  const due = new Date(dueDate);
  if (!dueDate || Number.isNaN(due.getTime())) throw new ApiError(httpStatus.BAD_REQUEST, 'Pick a follow-up date');
  const owner = lead.assignedTo || (mongoose.isValidObjectId(actorId) ? actorId : null);
  if (!owner) throw new ApiError(httpStatus.BAD_REQUEST, 'Assign a counselor before setting a follow-up');

  const open = await Reminder.findOne({ lead: lead._id, type: 'follow-up', status: { $ne: 'completed' } });
  if (open) {
    open.dueDate = due;
    open.user = owner;
    open.status = 'pending';
    if (note !== undefined) open.note = note;
    await open.save();
  } else {
    await Reminder.create({
      user: owner,
      lead: lead._id,
      student: lead.convertedStudentId || undefined,
      title: `Follow up with ${lead.fullname}`,
      note: note || undefined,
      dueDate: due,
      type: 'follow-up',
      createdBy: mongoose.isValidObjectId(actorId) ? actorId : undefined,
    });
  }

  lead.nextFollowUp = due;
  await lead.save();
  return lead;
};

module.exports = {
  createLead,
  queryLeads,
  getLeadById,
  getLeadByEmail,
  updateLeadById,
  deleteLeadById,
  searchLead,
  getTop5ByContries,
  getTop5ByDegree,
  countLeads,
  convertLeadToStudent,
  adSourceFilter,
  leadFacets,
  assignLead,
  setLeadFollowUp,
};
