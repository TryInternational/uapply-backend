/* eslint-disable no-nested-ternary */
const httpStatus = require('http-status');
const mongoose = require('mongoose');

const moment = require('moment');
const axios = require('axios');
const { text } = require('express');
const pick = require('../utils/pick');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { studentsService, userService } = require('../services');
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
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const todayFilter = {
    createdAt: {
      $gte: startOfToday,
      $lt: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1),
    },
  };

  const studentCount = await Students.countDocuments(todayFilter);
  const body = { ...req.body, refrenceNo: `${moment(new Date()).format('DDMMYY')}-000${studentCount + 1}` };
  const student = await studentsService.createStudent(body);

  const users = await userService.getUsers();
  const { assignedTo } = student;

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
    simplifiedUsers.map((user) =>
      sendSlackNotification(user.slackMemberId, {
        attachments: [
          {
            pretext: `*You have been assigned as ${user.assignedAs} for ${student.firstName || ''} ${
              student.middleName || ''
            } ${student.lastName || ''}*`,
            text: `\nRef. No - ${student.refrenceNo}.\nPhone No - ${student.phoneNo}.\nEmail - ${student.email}.`,
          },
        ],
      })
    )
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
  // Step 1: Fetch the existing student before updating
  const existingStudent = await studentsService.getStudentById(req.params.studentId);

  if (!existingStudent) {
    return res.status(404).send({ message: 'Student not found' });
  }

  // Step 2: Update the student and fetch the updated data
  const student = await studentsService.updateStudentById(req.params.studentId, req.body);

  // Step 3: Check if `assignedTo` was updated
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
    // No new assignments, skip notifications
    return res.send(student);
  }

  // Step 4: Fetch all users
  const users = await userService.getUsers();

  // Step 5: Extract users and roles from the new assignments
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

  // Step 6: Simplify user data for notifications
  const simplifiedUsers = newAssignedUsers.map((user) => ({
    _id: user._id,
    name: user.name,
    email: user.email,
    slackMemberId: user.slackMemberId,
    avatar: user.avatar,
    assignedAs: user.assignedAs,
  }));

  // Step 7: Send Slack notifications
  await Promise.all(
    simplifiedUsers.map((user) =>
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
      })
    )
  );

  // Step 8: Send the updated student response
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
            $gte: moment(req.query.startDate).utc().startOf('day').subtract(3, 'hours').toDate(),
            $lte: moment(req.query.endDate).utc().endOf('day').subtract(3, 'hours').toDate(),
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

  const dashboardData = await studentsService.getDashboardData({
    startDate: moment(req.query.startDate).utc().startOf('day').subtract(3, 'hours').toDate(),
    endDate: moment(req.query.endDate).utc().endOf('day').subtract(3, 'hours').toDate(),
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
