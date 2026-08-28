const httpStatus = require('http-status');
const { DateTime } = require('luxon');
const { Leads, Students } = require('../models');
const ApiError = require('../utils/ApiError');
const { convertASTToUTC } = require('../utils/Common');

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

  const startDate = DateTime.fromISO(new Date(data.startDate).toISOString(), {
    zone: 'Asia/Riyadh',
  }).startOf('day');
  const endDate = DateTime.fromISO(new Date(data.endDate).toISOString(), {
    zone: 'Asia/Riyadh',
  }).endOf('day');

  const sd = convertASTToUTC(startDate, true).toString();
  const ed = convertASTToUTC(endDate, true).toString();

  if (data.startDate && data.endDate) {
    matchQuery.createdAt = {
      $gte: sd,
      $lte: ed,
    };
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

  const startDate = DateTime.fromISO(new Date(data.startDate).toISOString(), {
    zone: 'Asia/Riyadh',
  }).startOf('day');
  const endDate = DateTime.fromISO(new Date(data.endDate).toISOString(), {
    zone: 'Asia/Riyadh',
  }).endOf('day');

  const sd = convertASTToUTC(startDate, true).toString();
  const ed = convertASTToUTC(endDate, true).toString();

  if (data.startDate && data.endDate) {
    matchQuery.createdAt = {
      $gte: sd,
      $lte: ed,
    };
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

const searchLead = async (text, options) => {
  // eslint-disable-next-line security/detect-non-literal-regexp
  const regex = new RegExp(text, 'i');
  const leads = await Leads.paginate(
    { $and: [{ qualified: options.qualified, $or: [{ fullname: regex }, { phoneNo: regex }, { email: regex }] }] },
    options
  );
  return leads;
};

/**
 * Convert a lead into a student. Maps the lead's fields onto a new Students doc
 * (channel = 'lead' so it shows under "Online lead"), links the lead to the new
 * student, and marks the lead 'Converted'. Guards against double-conversion and
 * duplicate emails.
 * @param {ObjectId} leadId
 * @returns {Promise<Students>} the created student
 */
const convertLeadToStudent = async (leadId) => {
  const lead = await Leads.findById(leadId);
  if (!lead) throw new ApiError(httpStatus.NOT_FOUND, 'Lead not found');
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
  const dest = lead.destination;
  const destName =
    dest && typeof dest === 'object' ? dest.name || dest.label || dest.value : typeof dest === 'string' ? dest : undefined;

  // Reference number — same scheme the students controller uses (ddMMyy-000N).
  const studentCount = await Students.countDocuments();
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const refrenceNo = `${pad(now.getDate())}${pad(now.getMonth() + 1)}${String(now.getFullYear()).slice(-2)}-000${studentCount + 1}`;

  const student = await Students.create({
    firstName,
    lastName,
    refrenceNo,
    email: lead.email || undefined,
    phoneNo: lead.phoneNo,
    city: lead.city,
    cgpa: lead.cgpa,
    testScore: lead.iltesScore,
    source: lead.source || 'uapply',
    channel: 'lead',
    stage: 'NotApplied',
    qualified: lead.qualified,
    preference: {
      studyDestinations: destName,
      subjects: lead.subjects ? [lead.subjects] : undefined,
    },
    applications: [],
  });

  lead.convertedStudentId = student._id;
  lead.status = 'Converted';
  lead.convertedAt = new Date();
  await lead.save();

  return student;
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
};
