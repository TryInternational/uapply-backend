/* eslint-disable no-nested-ternary */
const httpStatus = require('http-status');
const mongoose = require('mongoose');
const { DateTime } = require('luxon');
const axios = require('axios');
const { convertASTToUTC } = require('../utils/Common');
// const { text } = require('express');
const pick = require('../utils/pick');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { studentsService, userService, notificationsService } = require('../services');
const { Students } = require('../models');

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

const createStudent = catchAsync(async (req, res) => {
  const today = DateTime.now();
  const startOfToday = today.startOf('day');

  const todayFilter = {
    createdAt: {
      $gte: startOfToday.toJSDate(),
      $lt: today.endOf('day').toJSDate(),
    },
  };

  const studentCount = await Students.countDocuments(todayFilter);
  const body = { ...req.body, refrenceNo: `${today.toFormat('ddMMyy')}-000${studentCount + 1}` };
  const student = await studentsService.createStudent(body);

  const users = await userService.getUsers();
  const { assignedTo } = student;

  const updatedUsers = users
    .filter((user) => assignedTo.some((assignment) => assignment.user.equals(user._id)))
    .flatMap((user) => {
      const assignedRoles = assignedTo
        .filter((assignment) => assignment.user.equals(user._id))
        .map((assignment) => assignment.role);

      return assignedRoles.map((role) => ({
        ...user._doc,
        assignedAs: role,
      }));
    });

  const usersWithRoles = updatedUsers;

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

  await Promise.all(
    simplifiedUsers.map(async (user) => {
      sendSlackNotification(user.slackMemberId, {
        attachments: [
          {
            pretext: `*You have been assigned as ${user.assignedAs} for ${student.firstName || ''} ${
              student.middleName || ''
            } ${student.lastName || ''}*`,
            text: `\nRef. No - ${student.refrenceNo}.\nPhone No - ${student.phoneNo}.\nEmail - ${student.email}.`,
          },
        ],
      });
      const io = req.app.get('io');

      await notificationsService.createNotification(
        io,
        [user._id.toString()],
        `You have been assigned as ${user.assignedAs} for ${student.firstName || ''} ${student.middleName || ''} ${
          student.lastName || ''
        }`,
        'student',
        student.id,
        student.id,
        req.body.createdBy
      );
    })
  );
  res.status(httpStatus.CREATED).send(student);
});

const getStudents = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['name', 'role', 'qualified', 'degree', 'nationality', 'residence', 'status', 'stage']);

  if (req.query.ambassadorName) {
    filter.ambassadorName = req.query.ambassadorName;
  }
  if (req.query.assignedUserId) {
    try {
      const assignedUserId = mongoose.Types.ObjectId(req.query.assignedUserId);
      filter['assignedTo.user'] = assignedUserId;
    } catch (error) {
      return res.status(400).send({ message: 'Invalid assignedUserId format.' });
    }
  }

  const options = pick(req.query, ['sortBy', 'limit', 'page']);
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
  const existingStudent = await studentsService.getStudentById(req.params.studentId);

  if (!existingStudent) {
    return res.status(404).send({ message: 'Student not found' });
  }

  const student = await studentsService.updateStudentById(req.params.studentId, req.body);

  const { assignedTo: previousAssignedTo } = existingStudent;
  const { assignedTo: updatedAssignedTo } = student;

  const newAssignments = updatedAssignedTo.filter(
    (updatedAssignment) =>
      !previousAssignedTo.some(
        (prevAssignment) =>
          prevAssignment.user.toString() === updatedAssignment.user.toString() &&
          prevAssignment.role === updatedAssignment.role
      )
  );

  if (newAssignments.length === 0) {
    return res.send(student);
  }

  const users = await userService.getUsers();

  const newAssignedUsers = users
    .filter((user) => newAssignments.some((assignment) => assignment.user.equals(user._id)))
    .flatMap((user) => {
      const assignedRoles = newAssignments
        .filter((assignment) => assignment.user.equals(user._id))
        .map((assignment) => assignment.role);

      return assignedRoles.map((role) => ({
        ...user._doc,
        assignedAs: role,
      }));
    });

  const simplifiedUsers = newAssignedUsers.map((user) => ({
    _id: user._id,
    name: user.name,
    email: user.email,
    slackMemberId: user.slackMemberId,
    avatar: user.avatar,
    assignedAs: user.assignedAs,
  }));
  const io = req.app.get('io');
  await Promise.all(
    simplifiedUsers.map(async (user) => {
      sendSlackNotification(user.slackMemberId, {
        attachments: [
          {
            color: '#fd3e60',
            pretext: `*You have been assigned as ${user.assignedAs} for ${student.firstName || ''} ${
              student.middleName || ''
            } ${student.lastName || ''}*`,
            text: `\nRef. No - ${student.refrenceNo}.\nPhone No - ${student.phoneNo}.\nEmail - ${student.email}.`,
          },
        ],
      });
      await notificationsService.createNotification(
        io,
        [user._id.toString()],
        `You have been assigned as ${user.assignedAs} for ${student.firstName || ''} ${student.middleName || ''} ${
          student.lastName || ''
        }`,
        'student',
        student.id,
        student.id,
        student.createdBy
      );
    })
  );

  res.send(student);
});

const deleteStudent = catchAsync(async (req, res) => {
  await studentsService.deleteStudentById(req.params.studentId);
  res.status(httpStatus.NO_CONTENT).send();
});

const getStudentsByMonths = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate']);

  const startDate = DateTime.fromISO(new Date(req.query.startDate).toISOString(), {
    zone: 'Asia/Riyadh',
  }).startOf('day');
  const endDate = DateTime.fromISO(new Date(req.query.endDate).toISOString(), {
    zone: 'Asia/Riyadh',
  }).endOf('day');

  const sd = convertASTToUTC(startDate, true).toString();
  const ed = convertASTToUTC(endDate, true).toString();

  const result = await studentsService.queryStudents(
    {
      $and: [
        {
          createdAt: {
            $gte: sd,
            $lte: ed,
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
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate', 'stage']);
  const results = await studentsService.searchStudent(req.params.text, options);
  res.status(200).send(results);
});

const getTopStudentsByNationality = catchAsync(async (req, res) => {
  try {
    const topNationalities = await studentsService.getTopNationalities({
      ...req.query,
    });
    res.send(topNationalities);
  } catch (error) {
    res.status(httpStatus.INTERNAL_SERVER_ERROR).send(error.message);
  }
});

const getStudentCountByAssignedRole = async (req, res) => {
  try {
    const data = await studentsService.getCountByAssignedRole({
      ...req.query,
    });
    res.status(200).send(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getDashboardStudentData = catchAsync(async (req, res) => {
  const filterOptions = {
    filter: pick(req.query, ['name', 'role', 'qualified', 'degree', 'nationality', 'residence', 'status', 'stage']),
    options: pick(req.query, ['sortBy', 'limit', 'page']),
  };

  const startDate = DateTime.fromISO(new Date(req.query.startDate).toISOString(), {
    zone: 'Asia/Riyadh',
  }).startOf('day');
  const endDate = DateTime.fromISO(new Date(req.query.endDate).toISOString(), {
    zone: 'Asia/Riyadh',
  }).endOf('day');

  const sd = convertASTToUTC(startDate, true).toString();
  const ed = convertASTToUTC(endDate, true).toString();

  const dashboardData = await studentsService.getDashboardData({
    startDate: sd,
    endDate: ed,
    filterOptions,
  });
  res.send(dashboardData);
});

module.exports = {
  createStudent,
  getStudents,
  getStudent,
  updateStudent,
  deleteStudent,
  getTopStudentsByNationality,
  searchStudents,
  getStudentsByMonths,
  getStudentCountByAssignedRole,
  getDashboardStudentData,
};
