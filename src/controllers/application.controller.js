/* eslint-disable no-plusplus */
/* eslint-disable no-return-assign */
/* eslint-disable eqeqeq */
/* eslint-disable array-callback-return */
const httpStatus = require('http-status');
const { pick } = require('lodash');

const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');

const { applicationService } = require('../services');
// const { fatoorah } = require('../thirdparty');
// const { DateToString } = require('../utils/Common');
// const { PubSub } = require('@google-cloud/pubsub');
// const pubSubClient = new   PubSub();
function generateUniqueId() {
  const randomNumbers = Math.floor(Math.random() * 1000000000)
    .toString()
    .padStart(9, '0');
  const uniqueId = `A-${randomNumbers}`;
  return uniqueId;
}

const createApplication = catchAsync(async (req, res) => {
  const applicationId = await generateUniqueId();
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
    applicationId,
    portalApplicationStatus: { applicationPhases: stages },
    startDate,
  });

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

// const searchApplications = catchAsync(async (req, res) => {
//   // const filter = pick(req.query, ['name', 'status', 'stage']);
//   const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate']);
//   const results = await applicationService.searchCountry(req.params.text, options);
//   res.status(200).send(results);
// });

module.exports = {
  createApplication,
  getApplications,
  getApplication,
  deleteApplication,
  updateApplication,
  getApplicationByStudentId,
  //   searchApplications,
};
