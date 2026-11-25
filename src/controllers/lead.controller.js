/* eslint-disable no-nested-ternary */
const httpStatus = require('http-status');
const { default: axios } = require('axios');
const { DateTime } = require('luxon');

const pick = require('../utils/pick');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { Leads } = require('../models');
const { leadsService } = require('../services');
const config = require('../config/config');
const { convertASTToUTC } = require('../utils/Common');
const { actorOf } = require('../utils/actor');

// A residence filter may name one country or several spellings of it
// ("United Arab Emirates,UAE") — the Leads filter drawer sends the latter.
const residenceMatch = (v) => {
  const names = String(v)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  return names.length > 1 ? { $in: names } : names[0];
};

// What the form on the website may set: what a visitor tells us about
// themselves. POST /leads needs no token, so anything else in the request is
// left out of what is stored. A lead's status, who works it, when to follow it
// up, which student it became and whether it is qualified are decided here or
// by staff afterwards, and nothing reads a password on a lead.
const PUBLIC_LEAD_FIELDS = [
  'fullname',
  'email',
  'phoneNo',
  'city',
  'nationality',
  'residence',
  'destination',
  'degree',
  'subjects',
  'cgpa',
  'engLevel',
  'iltesScore',
  'previousSchool',
  'parentsIncome',
  'countriesTraveled',
  'selectedUniversity',
  'applications',
  'sponsored',
  'sponsoredBy',
  'webUrl',
  'source',
];

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

  const lead = await leadsService.createLead({ ...pick(req.body, PUBLIC_LEAD_FIELDS), qualified });
  const slackBody = {
    attachments: [
      {
        pretext: `*New qualified user ${lead.fullname}*`,
        text: `\nEmail - ${lead.email || 'N/A'}.\nPhone No - ${lead.phoneNo}.\nNationality - ${
          lead.nationality.english_name
        }.\nResidence - ${lead.residence.english_name || 'N/A'}.\nDegree- ${lead.degree.en_name}.\nMajor - ${
          lead.subjects || 'N/A'
        }.\nGPA - ${lead.cgpa || 'N/A'}.\nCountry travelled - ${
          lead.countriesTraveled.toString() || 'N/A'
        }.\nIncome above $30,000 - ${
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
  const filter = pick(req.query, [
    'fullname',
    'destination.en_name',
    'role',
    'qualified',
    'degree.en_name',
    'nationality.english_name',
    'residence.english_name',
    'status',
    'source',
    'createdAt',
  ]);

  if (req.query.nationality) {
    filter['nationality.english_name'] = req.query.nationality;
  }
  if (req.query.residence) {
    filter['residence.english_name'] = residenceMatch(req.query.residence);
  }
  if (req.query.degree) {
    filter['degree.en_name'] = req.query.degree;
  }
  if (req.query.degree && req.query.degree !== 'All') {
    filter['degree.en_name'] = req.query.degree;
  } else if (req.query.degree === 'All') {
    // Remove the degree filter if it was already added by pick()
    delete filter['degree.en_name'];
  }
  if (req.query.destination && req.query.destination.en_name) {
    filter['destination.en_name'] = req.query.destination.en_name;
  } else if (typeof req.query.destination === 'string' && req.query.destination) {
    filter['destination.en_name'] = req.query.destination;
  }
  const adSource = leadsService.adSourceFilter(req.query.adSource);
  if (adSource) Object.assign(filter, adSource);

  if (req.query.startDate && req.query.endDate) {
    filter.createdAt = {
      $gte: DateTime.fromJSDate(new Date(req.query.startDate), { zone: 'utc' })
        .startOf('day')
        .minus({ hours: 3 })
        .toJSDate(), // Start date filter
      $lte: DateTime.fromJSDate(new Date(req.query.endDate), { zone: 'utc' }).endOf('day').minus({ hours: 3 }).toJSDate(), // End date filter
    };
  }

  // countsByStatus=all,New,… → { counts } for the Leads status tabs in one
  // request ("all" = no status constraint); every other filter still applies.
  if (req.query.countsByStatus) {
    const keys = String(req.query.countsByStatus)
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 12);
    const base = { ...filter };
    delete base.status;
    if (req.query.webUrl) base.webUrl = { $regex: req.query.webUrl };
    const ns = await Promise.all(keys.map((k) => Leads.countDocuments(k === 'all' ? base : { ...base, status: k })));
    const counts = {};
    keys.forEach((k, i) => {
      counts[k] = ns[i];
    });
    return res.send({ counts });
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

const convertLead = catchAsync(async (req, res) => {
  const student = await leadsService.convertLeadToStudent(req.params.leadId, actorOf(req));
  res.status(httpStatus.CREATED).send(student);
});

// POST /leads/:leadId/assign { userId } — "Reassign counselor".
const assignLead = catchAsync(async (req, res) => {
  const lead = await leadsService.assignLead(req.params.leadId, req.body.userId);
  res.send(lead);
});

// POST /leads/:leadId/follow-up { dueDate, note? } — "Set follow-up".
const setLeadFollowUp = catchAsync(async (req, res) => {
  const lead = await leadsService.setLeadFollowUp(req.params.leadId, req.body, actorOf(req).id);
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
  const options = pick(req.query, [
    'sortBy',
    'limit',
    'page',
    'populate',
    'qualified',
    'status',
    { searchString: req.params.text },
  ]);
  // the filter drawer's choices apply to a search as well
  const q = req.query;
  const extra = {};
  if (q.degree && q.degree !== 'All') extra['degree.en_name'] = q.degree;
  if (typeof q.destination === 'string' && q.destination) extra['destination.en_name'] = q.destination;
  if (q.nationality) extra['nationality.english_name'] = q.nationality;
  if (q.residence) extra['residence.english_name'] = residenceMatch(q.residence);
  if (q.source) extra.source = q.source;
  if (q.startDate && q.endDate) {
    extra.createdAt = {
      $gte: DateTime.fromJSDate(new Date(q.startDate), { zone: 'utc' }).startOf('day').minus({ hours: 3 }).toJSDate(),
      $lte: DateTime.fromJSDate(new Date(q.endDate), { zone: 'utc' }).endOf('day').minus({ hours: 3 }).toJSDate(),
    };
  }
  const adSource = leadsService.adSourceFilter(q.adSource);
  const filters = [extra, ...(adSource ? [adSource] : [])].filter((f) => Object.keys(f).length);
  const results = await leadsService.searchLead(req.params.text, options, filters.length ? { $and: filters } : undefined);
  res.status(200).send(results);
});

// GET /leads/facets?qualified=&status= — options + counts for the filter drawer.
const getLeadFacets = catchAsync(async (req, res) => {
  res.send(await leadsService.leadFacets(pick(req.query, ['qualified', 'status'])));
});

const getLeadsCountByDates = async (filter) => {
  const startDate = DateTime.fromISO(new Date(filter.startDate).toISOString(), {
    zone: 'Asia/Riyadh',
  }).startOf('day');
  const endDate = DateTime.fromISO(new Date(filter.endDate).toISOString(), {
    zone: 'Asia/Riyadh',
  }).endOf('day');

  const sd = convertASTToUTC(startDate, true).toString();
  const ed = convertASTToUTC(endDate, true).toString();

  const formattedFilter = {
    ...filter,
    startDate: sd,
    endDate: ed,
  };

  const count = await leadsService.countLeads({
    $and: [
      { createdAt: { $gte: formattedFilter.startDate, $lte: formattedFilter.endDate } },
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
  convertLead,
  assignLead,
  setLeadFollowUp,
  deleteLead,
  searchLeads,
  getLeadFacets,
  getLeadsByMonths,
  getTop5ByContry,
  getTop5ByDegrees,
  getDashboardData,
};
