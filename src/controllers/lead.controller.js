/* eslint-disable no-nested-ternary */
const httpStatus = require('http-status');
const { default: axios } = require('axios');
const pick = require('../utils/pick');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { leadsService } = require('../services');
const config = require('../config/config');

const createLead = catchAsync(async (req, res) => {
  const checkQualified =
    req.body.nationality.english_name === 'United States of America' ||
    req.body.nationality.english_name === 'Australia' ||
    req.body.nationality.english_name === 'Oman' ||
    req.body.nationality.english_name === 'France' ||
    req.body.nationality.english_name === 'Spain' ||
    req.body.nationality.english_name === 'United Kingdom' ||
    req.body.nationality.english_name === 'Qatar' ||
    req.body.nationality.english_name === 'Kuwait' ||
    req.body.nationality.english_name === 'Saudi Arabia' ||
    req.body.nationality.english_name === 'United Arab Emirates' ||
    req.body.nationality.english_name === 'Germany' ||
    req.body.nationality.english_name === 'Bahrain';

  const qualified = (req.body.parentsIncome || checkQualified) && req.body.destination.en_name === 'UK';

  const lead = await leadsService.createLead({ qualified, ...req.body });
  const slackBody = {
    attachments: [
      {
        pretext: `*New qualified user ${lead.fullname}*`,
        text: `\nEmail - ${lead.email}.\nPhone No - ${lead.phoneNo}.\nNationality - ${
          lead.nationality.english_name
        }.\nResidence - ${lead.residence.english_name}.\nDegree- ${lead.degree.en_name}.\nMajor - ${lead.subjects}.\nGPA - ${
          lead.cgpa
        }.\nCountry travelled - ${lead.countriesTraveled.toString() || 'N/A'}.\nIncome above $30,000 - ${
          lead.parentsIncome === 'true' ? 'Yes' : lead.parentsIncome === 'false' ? 'No' : 'N/A'
        }.\nSchool study in - ${lead.previousSchool || 'N/A'}`,
        color: '#fd3e60',
      },
    ],
  };
  // const Tryslack = {
  //   method: 'post',
  //   url: `https://hooks.slack.com/services/${config.slack.slackWebHook}`,
  //   data: JSON.stringify(slackBody),
  //   headers: { 'content-type': 'application/x-www-form-urlencoded' },
  // };
  const Ulearnslack = {
    method: 'post',
    url: `https://hooks.slack.com/services/${config.slack.slackWebHookUlearn}`,
    data: JSON.stringify(slackBody),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  };
  if (process.env.APP_ENV === 'production' && qualified) {
    // await axios(Tryslack);
    await axios(Ulearnslack);
  }

  res.status(httpStatus.CREATED).send(lead);
});

const getLeads = catchAsync(async (req, res) => {
  let filter = pick(req.query, [
    'name',
    'destination.en_name',
    'role',
    'qualified',
    'degree',
    'nationality',
    'residence',
    'status',
    'source',
  ]);
  if (req.query.destination && req.query.destination.en_name) {
    filter = { 'destination.en_name': req.query.destination.en_name };
  }

  const options = pick(req.query, ['sortBy', 'limit', 'page', 'webUrl']);
  const result = await leadsService.queryLeads(filter, options);
  res.send(result);
});

const getLead = catchAsync(async (req, res) => {
  const lead = await leadsService.getLeadById(req.params.leadId);
  if (!lead) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Lead not found');
  }
  res.send(lead);
});
const updateLead = catchAsync(async (req, res) => {
  const lead = await leadsService.updateLeadById(req.params.leadId, req.body);
  res.send(lead);
});

const getTop5ByContry = catchAsync(async (req, res) => {
  const lead = await leadsService.getTop5ByContries({
    ...req.query,
  });
  res.send(lead);
});
const getTop5ByDegrees = catchAsync(async (req, res) => {
  const lead = await leadsService.getTop5ByDegree({
    ...req.query,
  });
  res.send(lead);
});

const deleteLead = catchAsync(async (req, res) => {
  await leadsService.deleteLeadById(req.params.leadId);
  res.status(httpStatus.NO_CONTENT).send();
});

const getLeadsByMonths = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate']);
  let queryFilters = {
    $and: [
      {
        createdAt: {
          $gte: req.query.startDate,
          $lte: req.query.endDate,
        },
      },
      { qualified: req.query.qualified },
    ],
  };

  // Add filters for status and source if they are present in the request query
  if (req.query.status) {
    queryFilters.$and.push({ status: req.query.status });
  }
  if (req.query.source) {
    queryFilters.$and.push({ source: req.query.source });
  }
  if (req.query.destination) {
    queryFilters = {
      $and: [
        {
          createdAt: {
            $gte: req.query.startDate,
            $lte: req.query.endDate,
          },
        },
        { 'destination.en_name': req.query.destination.en_name },
      ],
    };
  }
  const result = await leadsService.queryLeads(queryFilters, options);
  res.send(result);
});
const searchLeads = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate', 'qualified', { searchString: req.params.text }]);
  const results = await leadsService.searchLead(req.params.text, options);
  res.status(200).send(results);
});

const getLeadsCountByDates = async (filter) => {
  const formattedFilter = {
    ...filter,
    startDate: filter.startDate,
    endDate: filter.endDate,
  };
  const count = await leadsService.countLeads({
    $and: [
      { createdAt: { $gte: new Date(formattedFilter.startDate), $lte: new Date(formattedFilter.endDate) } },
      { qualified: formattedFilter.qualified },
      ...(formattedFilter.status ? [{ status: formattedFilter.status }] : []),
      ...(formattedFilter.source ? [{ source: formattedFilter.source }] : []),
      ...(formattedFilter.destination ? [{ 'destination.en_name': formattedFilter.destination }] : []),
    ],
  });
  return count;
};

const getDashboardData = catchAsync(async (req, res) => {
  const { startDate, endDate } = req.query;

  const [
    studentsUlearnCount,
    studentsUapplyCount,
    studentsAppliedCount,
    studentsClosedCount,
    studentsNewCount,
    studentsWaCount,
    studentsOthersCount,
    studentsUkCount,
    top5ByCountry,
    top5ByDegree,
    qualifiedLeads,
    unqualifiedLeads,
  ] = await Promise.all([
    getLeadsCountByDates({ qualified: true, source: 'ulearn', startDate, endDate }),
    getLeadsCountByDates({ qualified: true, source: 'uapply', startDate, endDate }),
    getLeadsCountByDates({ qualified: true, status: 'Applied', startDate, endDate }),
    getLeadsCountByDates({ qualified: true, status: 'Closed', startDate, endDate }),
    getLeadsCountByDates({ qualified: true, status: 'New', startDate, endDate }),
    getLeadsCountByDates({ qualified: true, status: 'Sent Whatsapp', startDate, endDate }),
    getLeadsCountByDates({ qualified: true, destination: 'Others', startDate, endDate }),
    getLeadsCountByDates({ qualified: true, destination: 'UK', startDate, endDate }),
    leadsService.getTop5ByContries({ startDate, endDate, qualified: true }),
    leadsService.getTop5ByDegree({ startDate, endDate, qualified: true }),
    getLeadsCountByDates({ qualified: true, startDate, endDate }),
    getLeadsCountByDates({ qualified: false, startDate, endDate }),
  ]);

  res.status(200).send({
    studentsUlearnCount,
    studentsUapplyCount,
    studentsAppliedCount,
    studentsClosedCount,
    studentsNewCount,
    studentsWaCount,
    studentsOthersCount,
    studentsUkCount,
    top5ByCountry,
    top5ByDegree,
    qualifiedLeads,
    unqualifiedLeads,
  });
});

module.exports = {
  createLead,
  getLeads,
  getLead,
  updateLead,
  deleteLead,
  searchLeads,
  getLeadsByMonths,
  getTop5ByContry,
  getTop5ByDegrees,
  getDashboardData,
};
