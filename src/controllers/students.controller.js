/* eslint-disable one-var */
/* eslint-disable no-bitwise */
/* eslint-disable no-var */
/* eslint-disable no-nested-ternary */
const httpStatus = require('http-status');
const { default: axios } = require('axios');
const bizSdk = require('facebook-nodejs-business-sdk');
const pick = require('../utils/pick');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { studentsService } = require('../services');
const config = require('../config/config');

const { EventRequest } = bizSdk;
const { UserData } = bizSdk;
const { ServerEvent } = bizSdk;

const { accessToken, ulearnAbroadAccessToken, pixelId, pixelUlearnId } = config.pixel;

const currentTimestamp = Math.floor(new Date() / 1000);

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = (Math.random() * 16) | 0,
      v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const createStudent = catchAsync(async (req, res) => {
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

  const student = await studentsService.createStudent({ qualified, ...req.body });
  const slackBody = {
    attachments: [
      {
        pretext: `*New qualified user ${student.fullname}*`,
        text: `\nEmail - ${student.email}.\nPhone No - ${student.phoneNo}.\nNationality - ${
          student.nationality.english_name
        }.\nResidence - ${student.residence.english_name}.\nDegree- ${student.degree.en_name}.\nMajor - ${
          student.subjects
        }.\nGPA - ${student.cgpa}.\nCountry travelled - ${
          student.countriesTraveled.toString() || 'N/A'
        }.\nIncome above $30,000 - ${
          student.parentsIncome === 'true' ? 'Yes' : student.parentsIncome === 'false' ? 'No' : 'N/A'
        }.\nSchool study in - ${student.previousSchool || 'N/A'}`,
        color: '#fd3e60',
      },
    ],
  };

  const Ulearnslack = {
    method: 'post',
    url: `https://hooks.slack.com/services/${config.slack.slackWebHookUlearn}`,
    data: JSON.stringify(slackBody),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  };
  if (process.env.APP_ENV === 'production' && qualified) {
    // await axios(Tryslack);
    await axios(Ulearnslack);
    const eventId = generateUUID();

    const userData = new UserData()
      .setEmails([student.email])
      .setPhones([student.phoneNo])
      .setClientIpAddress(req.connection.remoteAddress)
      .setCountry(student.nationality.alpha2_code)
      .setClientUserAgent(req.headers['user-agent']);

    const serverEvent = new ServerEvent()
      .setEventName('Qualified Lead')
      .setEventTime(currentTimestamp)
      .setEventId(eventId)
      .setUserData(userData)
      .setActionSource('website')
      .setEventSourceUrl(student.webUrl);

    const eventsData = [serverEvent];

    const eventRequest = new EventRequest(accessToken, pixelId).setEvents(eventsData);
    const eventRequestUlearn = new EventRequest(ulearnAbroadAccessToken, pixelUlearnId).setEvents(eventsData);

    if (student.source === 'ulearn') {
      try {
        await eventRequestUlearn.execute();
      } catch (error) {
        console.log(error);
      }
    } else {
      try {
        await eventRequest.execute();
      } catch (error) {
        console.log(error);
      }
    }
  }

  res.status(httpStatus.CREATED).send(student);
});

const getStudents = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['name', 'role', 'qualified', 'degree', 'nationality', 'residence', 'status']);
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'webUrl']);

  const result = await studentsService.queryStudents(filter, options);
  res.send(result);
});

const getStudent = catchAsync(async (req, res) => {
  const student = await studentsService.getStudentById(req.params.studentId);
  if (!student) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Student not found');
  }
  res.send(student);
});

const updateStudent = catchAsync(async (req, res) => {
  const student = await studentsService.updateStudentById(req.params.studentId, req.body);
  res.send(student);
});

const deleteStudent = catchAsync(async (req, res) => {
  await studentsService.deleteStudentById(req.params.studentId);
  res.status(httpStatus.NO_CONTENT).send();
});
const getStudentsByMonths = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate']);
  const result = await studentsService.queryStudents(
    {
      $and: [
        {
          createdAt: {
            $gte: req.query.startDate,
            $lte: req.query.endDate,
          },
        },
        { qualified: req.query.qualified },
      ],
    },
    options
  );
  res.send(result);
});
const searchStudents = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate', 'qualified', { searchString: req.params.text }]);
  const results = await studentsService.searchStudent(req.params.text, options);
  res.status(200).send(results);
});

module.exports = {
  createStudent,
  getStudents,
  getStudent,
  updateStudent,
  deleteStudent,
  searchStudents,
  getStudentsByMonths,
};
