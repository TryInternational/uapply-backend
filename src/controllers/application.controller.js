/* eslint-disable no-plusplus */
/* eslint-disable no-return-assign */
/* eslint-disable eqeqeq */
/* eslint-disable array-callback-return */
const httpStatus = require('http-status');
const axios = require('axios');

const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');

const { applicationService, studentsService, userService } = require('../services');

// const { fatoorah } = require('../thirdparty');
// const { DateToString } = require('../utils/Common');
// const { PubSub } = require('@google-cloud/pubsub');
// const pubSubClient = new   PubSub();

const SLACK_API_URL = 'https://slack.com/api/chat.postMessage';
const SLACK_TOKEN = process.env.SLACK_NOTIFICATION;

const sendSlackNotification = async (memberId, slackBody) => {
  try {
    const response = await axios.post(
      SLACK_API_URL,
      {
        channel: memberId,
        ...slackBody,
      },
      {
        headers: {
          Authorization: `Bearer ${SLACK_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
    if (response.data.ok) {
      console.log('Slack notification sent successfully.');
    } else {
      console.error('Error sending Slack notification:', response.data.error);
    }
  } catch (error) {
    console.error('Error sending Slack notification:', error.message);
  }
};
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

  const application = await applicationService.createApplication({
    ...req.body,
    portalApplicationStatus: { applicationPhases: stages },
    startDate,
  });
  const student = await studentsService.getStudentById(application.studentId);
  const { assignedTo } = student;

  const users = await userService.getUsers();

  const updatedUsers = users
    .filter((user) => assignedTo.some((assignment) => assignment.user.equals(user._id)))
    .flatMap((user) => {
      const assignedRoles = assignedTo
        .filter((assignment) => assignment.user.equals(user._id))
        .map((assignment) => assignment.role);

      return assignedRoles.map((role) => ({
        ...user._doc, // Destructure the actual document to avoid internal fields
        assignedAs: role,
      }));
    });

  const simplifiedUsers = updatedUsers.map((user) => {
    return {
      _id: user._id,
      name: user.name,
      email: user.email,
      slackMemberId: user.slackMemberId,
      avatar: user.avatar,
      assignedAs: user.assignedAs,
    };
  });

  // Deduplicate users by slackMemberId
  const deduplicatedUsers = Array.from(new Map(simplifiedUsers.map((user) => [user.slackMemberId, user])).values());

  const slackBody = {
    attachments: [
      {
        pretext: `*An application has been initiated by ${req.body.editor.name} for ${student.firstName || ''} ${
          student.middleName || ''
        } ${student.lastName || ''}*`,
        text: `\nApplication No - ${application.applicationId}.\nUniversity - ${application.institute.name}.\nDegree - ${application.courseLevel}.\nCourse - ${application.courseName}.\nIntake - ${application.intakeMonth} ${application.intakeYear}`,
        color: '#FFFF00',
      },
    ],
  };

  // Send notifications to deduplicated users
  // if (process.env.APP_ENV === 'production') {
  await Promise.all(deduplicatedUsers.map((user) => sendSlackNotification(user.slackMemberId, slackBody)));
  // }
  res.status(httpStatus.CREATED).send(application);
});

const getApplications = catchAsync(async (req, res) => {
  // await publishMessage();

  const result = await applicationService.getApplications(req.query);
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
  try {
    if (req.body.phaseChanged) {
      const stages = req.body.portalApplicationStatus.applicationPhases;
      const currentIndex = stages.findIndex(
        (stage) => stage.phaseState === 'AwaitingResponseStudent' || stage.status === 'Done'
      );
      const application = await applicationService.findApplicationById(req.params.applicationId);
      const student = await studentsService.getStudentById(application.studentId);
      const { assignedTo } = student;

      const users = await userService.getUsers();

      const updatedUsers = users
        .filter((user) => assignedTo.some((assignment) => assignment.user.equals(user._id)))
        .flatMap((user) => {
          const assignedRoles = assignedTo
            .filter((assignment) => assignment.user.equals(user._id))
            .map((assignment) => assignment.role);

          // Return a separate user object for each assigned role
          return assignedRoles.map((role) => ({
            ...user._doc, // Destructure the actual document to avoid the internal fields
            assignedAs: role,
          }));
        });

      const usersWithRoles = updatedUsers;
      const filledBy = users.filter((user) => application.managedBy == user._id)
        ? users.filter((user) => application.managedBy == user._id)
        : [{ name: '' }];

      const simplifiedUsers = usersWithRoles.map((user) => {
        return {
          _id: user._id,
          name: user.name,
          email: user.email,
          slackMemberId: user.slackMemberId,
          avatar: user.avatar,
          assignedAs: user.assignedAs,
        };
      });

      let slackBody = {};
      const accountManager = simplifiedUsers.filter((z) => z.assignedAs === 'account manager')[0];
      const sales = simplifiedUsers.filter((z) => z.assignedAs === 'sales')[0];
      const operations = simplifiedUsers.filter((z) => z.assignedAs === 'operations')[0];

      // Define conditions based on different application statuses
      if (stages[currentIndex].status === 'Submitted') {
        slackBody = {
          attachments: [
            {
              pretext: `*An application has been moved to Submitted by ${req.body.editor.name} for ${
                student.firstName || ''
              } ${student.middleName || ''} ${student.lastName || ''}*`,
              text: `\nApplication No - ${application.applicationId}.\nUniversity - ${
                application.institute.name
              }.\nDegree - ${application.courseLevel}.\nCourse - ${application.courseName}.\nIntake - ${
                application.intakeMonth
              } ${application.intakeYear}\nAccount Manager - ${accountManager ? accountManager.name : ''}\nSales - ${
                sales ? sales.name : ''
              }\nOperation - ${operations ? operations.name : ''}\nFilled out by - ${
                filledBy.length ? filledBy[0].name : ''
              }`,
              color: '#00FF00',
            },
          ],
        };
      } else if (stages[currentIndex].status === 'Conditional offer') {
        slackBody = {
          attachments: [
            {
              pretext: `*An application has been moved to Conditional offer by ${req.body.editor.name} for ${
                student.firstName || ''
              } ${student.middleName || ''} ${student.lastName || ''}*`,
              text: `\nApplication No - ${application.applicationId}.\nUniversity - ${
                application.institute.name
              }.\nDegree - ${application.courseLevel}.\nCourse - ${application.courseName}.\nIntake - ${
                application.intakeMonth
              } ${application.intakeYear}\nAccount Manager - ${accountManager ? accountManager.name : ''}\nSales - ${
                sales ? sales.name : ''
              }\nOperation - ${operations ? operations.name : ''}\nFilled out by - ${
                filledBy.length ? filledBy[0].name : ''
              }`,
              color: '#FFFF00',
            },
          ],
        };
      } else if (stages[currentIndex].status === 'Unconditional offer') {
        slackBody = {
          attachments: [
            {
              pretext: `*An application has been moved to UnConditional offer by ${req.body.editor.name} for ${
                student.firstName || ''
              } ${student.middleName || ''} ${student.lastName || ''}*`,
              text: `\nApplication No - ${application.applicationId}.\nUniversity - ${
                application.institute.name
              }.\nDegree - ${application.courseLevel}.\nCourse - ${application.courseName}.\nIntake - ${
                application.intakeMonth
              } ${application.intakeYear}\nAccount Manager - ${accountManager ? accountManager.name : ''}\nSales - ${
                sales ? sales.name : ''
              }\nOperation - ${operations ? operations.name : ''}\nFilled out by - ${
                filledBy.length ? filledBy[0].name : ''
              }`,
              color: '#FFFF00',
            },
          ],
        };
      } else if (stages[currentIndex].status === 'Confirmation') {
        slackBody = {
          attachments: [
            {
              pretext: `*An application has been moved to Confirmation by ${req.body.editor.name} for ${
                student.firstName || ''
              } ${student.middleName || ''} ${student.lastName || ''}*`,
              text: `\nApplication No - ${application.applicationId}.\nUniversity - ${
                application.institute.name
              }.\nDegree - ${application.courseLevel}.\nCourse - ${application.courseName}.\nIntake - ${
                application.intakeMonth
              } ${application.intakeYear}\nAccount Manager - ${accountManager ? accountManager.name : ''}\nSales - ${
                sales ? sales.name : ''
              }\nOperation - ${operations ? operations.name : ''}\nFilled out by - ${
                filledBy.length ? filledBy[0].name : ''
              }`,
              color: '#FFFF00',
            },
          ],
        };
      } else if (stages[currentIndex].status === 'FG/BS') {
        slackBody = {
          attachments: [
            {
              pretext: `*An application has been moved to FG/BS by ${req.body.editor.name} for ${student.firstName || ''} ${
                student.middleName || ''
              } ${student.lastName || ''}*`,
              text: `\nApplication No - ${application.applicationId}.\nUniversity - ${
                application.institute.name
              }.\nDegree - ${application.courseLevel}.\nCourse - ${application.courseName}.\nIntake - ${
                application.intakeMonth
              } ${application.intakeYear}\nAccount Manager - ${accountManager ? accountManager.name : ''}\nSales - ${
                sales ? sales.name : ''
              }\nOperation - ${operations ? operations.name : ''}\nFilled out by - ${
                filledBy.length ? filledBy[0].name : ''
              }`,
              color: '#FFFF00',
            },
          ],
        };
      } else if (stages[currentIndex].status === 'CAS Received') {
        slackBody = {
          attachments: [
            {
              pretext: `*An application has been moved to CAS Received by ${req.body.editor.name} for ${
                student.firstName || ''
              } ${student.middleName || ''} ${student.lastName || ''}*`,
              text: `\nApplication No - ${application.applicationId}.\nUniversity - ${
                application.institute.name
              }.\nDegree - ${application.courseLevel}.\nCourse - ${application.courseName}.\nIntake - ${
                application.intakeMonth
              } ${application.intakeYear}\nAccount Manager - ${accountManager ? accountManager.name : ''}\nSales - ${
                sales ? sales.name : ''
              }\nOperation - ${operations ? operations.name : ''}\nFilled out by - ${
                filledBy.length ? filledBy[0].name : ''
              }`,
              color: '#FFFF00',
            },
          ],
        };
      } else {
        slackBody = {
          attachments: [
            {
              pretext: `*An application has been moved to Done by ${req.body.editor.name} for ${student.firstName || ''} ${
                student.middleName || ''
              } ${student.lastName || ''}*`,
              text: `\nApplication No - ${application.applicationId}.\nUniversity - ${
                application.institute.name
              }.\nDegree - ${application.courseLevel}.\nCourse - ${application.courseName}.\nIntake - ${
                application.intakeMonth
              } ${application.intakeYear}\nAccount Manager - ${accountManager ? accountManager.name : ''}\nSales - ${
                sales ? sales.name : ''
              }\nOperation - ${operations ? operations.name : ''}\nFilled out by - ${
                filledBy.length ? filledBy[0].name : ''
              }`,
              color: '#FFFF00',
            },
          ],
        };
      }

      // Send the Slack notification if in production environment
      // if (process.env.APP_ENV === 'production') {
      await Promise.all(simplifiedUsers.map((user) => sendSlackNotification(user.slackMemberId, slackBody)));
      // }

      if (currentIndex !== -1) {
        // Update 'AwaitingResponseStudent' to 'Completed' and set isCurrent to false
        stages[currentIndex].phaseState = 'Completed';
        stages[currentIndex].isCurrent = false;
        stages[currentIndex].isPrevious = true;

        // Check if the next stage exists and update its phaseState to 'AwaitingResponseStudent' with isCurrent set to true
        if (currentIndex < stages.length - 1) {
          stages[currentIndex + 1].phaseState = 'AwaitingResponseStudent';
          stages[currentIndex + 1].isCurrent = true;
        }
        if (currentIndex >= 0) {
          stages[currentIndex - 1].isPrevious = false;
        }
      }
      const app = await applicationService.updateApplicationById(req.params.applicationId, {
        portalApplicationStatus: { applicationPhases: stages },
      });
      res.send(app);
      return;
    }
    const app = await applicationService.updateApplicationById(req.params.applicationId, req.body);
    res.send(app);
  } catch (error) {
    console.log(error);
  }
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
  const data = await applicationService.getApplicationsCountByMonth(req.query.intakeMonth, req.query.intakeYear);
  res.status(200).json(data);
});

const getEnrolledApplicationsCountByMonth = catchAsync(async (req, res) => {
  const data = await applicationService.getEnrolledApplicationsCountByMonth(req.query.intakeMonth, req.query.intakeYear);
  res.status(200).json(data);
});

const getDashboardData = catchAsync(async (req, res) => {
  try {
    // Replace with your actual aggregation logic
    const applicationsData = await applicationService.getDashboardData(
      req.query.intakeMonth,
      req.query.intakeYear,
      req.query.startDate,
      req.query.endDate
    );

    res.status(200).json({
      applicationsData,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
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
  getDashboardData,
  //   searchApplications,
};
