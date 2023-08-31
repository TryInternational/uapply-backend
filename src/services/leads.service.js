const httpStatus = require('http-status');
const { Leads } = require('../models');
const ApiError = require('../utils/ApiError');

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

const searchLead = async (text, options) => {
  // eslint-disable-next-line security/detect-non-literal-regexp
  const regex = new RegExp(text, 'i');
  const leads = await Leads.paginate(
    { $and: [{ qualified: options.qualified, $or: [{ fullname: regex }, { phoneNo: regex }, { email: regex }] }] },
    options
  );
  return leads;
};

module.exports = {
  createLead,
  queryLeads,
  getLeadById,
  getLeadByEmail,
  updateLeadById,
  deleteLeadById,
  searchLead,
};
