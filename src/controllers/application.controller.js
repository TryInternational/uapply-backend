/* eslint-disable no-plusplus */
/* eslint-disable no-return-assign */
/* eslint-disable eqeqeq */
/* eslint-disable array-callback-return */
const httpStatus = require('http-status');
const { pick } = require('lodash');
const axios = require('axios');

const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');

const { applicationService } = require('../services');
const config = require('../config/config');
// const { fatoorah } = require('../thirdparty');
// const { DateToString } = require('../utils/Common');
// const { PubSub } = require('@google-cloud/pubsub');
// const pubSubClient = new   PubSub();

const createApplication = catchAsync(async (req, res) => {
  const startDate = new Date();
  const stages = [
    {
      status: 'Initiated',
      phaseState: 'Completed',
      isCurrent: false,
      isPrevious: true,
      createdDate: '',
      subApplicationPhase: [],
      closedStatus: null,
      offerStatus: null,
    },
    {
      status: 'Submitted',
      phaseState: 'AwaitingResponseStudent',
      isCurrent: true,
      isPrevious: false,
      createdDate: '',
      subApplicationPhase: [],
      closedStatus: null,
      offerStatus: null,
    },
    {
      status: 'Conditional offer',
      phaseState: 'Upcoming',
      isCurrent: false,
      isPrevious: false,
      createdDate: '',
      subApplicationPhase: [],
      closedStatus: null,
      offerStatus: null,
    },
    {
      status: 'Unconditional offer',
      phaseState: 'Upcoming',
      isCurrent: false,
      isPrevious: false,
      createdDate: '',
      subApplicationPhase: [],
      closedStatus: null,
      offerStatus: null,
    },
    {
      status: 'Confirmation',
      phaseState: 'Upcoming',
      isCurrent: false,
      isPrevious: false,
      createdDate: '',
      subApplicationPhase: [],
      closedStatus: null,
      offerStatus: null,
    },
    {
      status: 'FG/BS',
      phaseState: 'Upcoming',
      isCurrent: false,
      isPrevious: false,
      createdDate: '',
      subApplicationPhase: [],
      closedStatus: null,
      offerStatus: null,
    },
    {
      status: 'CAS Received',
      phaseState: 'Upcoming',
      isCurrent: false,
      isPrevious: false,
      createdDate: '',
      subApplicationPhase: [],
      closedStatus: null,
      offerStatus: null,
    },
    {
      status: 'Done',
      phaseState: 'Upcoming',
      isCurrent: false,
      isPrevious: false,
      createdDate: '',
      subApplicationPhase: [],
      closedStatus: null,
      offerStatus: null,
    },
  ];
  //   const applicationPhases = [];

  //   stages.map((a) => applicationPhases.push({ status: a,phaseState: }));

  const application = await applicationService.createApplication({
    ...req.body,
    portalApplicationStatus: { applicationPhases: stages },
    startDate,
  });
  const slackBody = {
    attachments: [
      {
        pretext: `*New application for ${application.institute.name}*`,
        text: `\nApplication Id - ${application.applicationId}.\nCourse Level - ${application.courseLevel}.\nIntake Month - ${application.intakeMonth}.\nIntake Year - ${application.intakeYear}.\n`,
        color: '#fd3e60',
      },
    ],
  };
  const Ulearnslack = {
    method: 'post',
    url: `https://hooks.slack.com/services/${config.slack.slackApplicationAlert}`,
    data: JSON.stringify(slackBody),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  };
  if (process.env.APP_ENV === 'production') {
    await axios(Ulearnslack);
  }
  res.status(httpStatus.CREATED).send(application);
});

const getApplications = catchAsync(async (req, res) => {
  // await publishMessage();
  const filter = pick(req.query, ['name', 'code']);
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate']);
  const result = await applicationService.getApplications(filter, options);
  res.send(result);
});

const getApplication = catchAsync(async (req, res) => {
  const application = await applicationService.findApplicationById(req.params.applicationId);

  if (!application) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Application not found');
  }
  res.send(application);
});
const getApplicationByStudentId = catchAsync(async (req, res) => {
  const application = await applicationService.getApplicationByStudentId(req.params.studentId);

  if (!application) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Application not found');
  }
  res.send(application);
});

const updateApplication = catchAsync(async (req, res) => {
  const application = await applicationService.updateApplicationById(req.params.applicationId, req.body);

  res.send(application);
});

const deleteApplication = catchAsync(async (req, res) => {
  await applicationService.deleteApplication(req.params.applicationId);
  res.status(httpStatus.NO_CONTENT).send();
});
const getApplicationsByPhase = async (req, res) => {
  try {
    const data = await applicationService.getApplicationsCountByPhase(req.query.startDate, req.query.endDate);
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// const searchApplications = catchAsync(async (req, res) => {
//   // const filter = pick(req.query, ['name', 'status', 'stage']);
//   const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate']);
//   const results = await applicationService.searchCountry(req.params.text, options);
//   res.status(200).send(results);
// });

const getTopUniversities = async (req, res) => {
  try {
    const universities = await applicationService.getTopUniversitiesByApplications(req.query.startDate, req.query.endDate);
    res.send(universities);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

async function getEnrolledUniversities(req, res) {
  try {
    const application = await applicationService.getTopEnrolledUniversities(req.query.startDate, req.query.endDate);
    res.send(application);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

const getApplicationsCountByMonth = catchAsync(async (req, res) => {
  const data = await applicationService.getApplicationsCountByMonth();
  res.status(200).json(data);
});

const getEnrolledApplicationsCountByMonth = catchAsync(async (req, res) => {
  const data = await applicationService.getEnrolledApplicationsCountByMonth();
  res.status(200).json(data);
});

module.exports = {
  createApplication,
  getApplications,
  getApplication,
  deleteApplication,
  updateApplication,
  getApplicationByStudentId,
  getApplicationsByPhase,
  getTopUniversities,
  getEnrolledUniversities,
  getApplicationsCountByMonth,
  getEnrolledApplicationsCountByMonth,
  //   searchApplications,
};
