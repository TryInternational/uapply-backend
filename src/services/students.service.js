const httpStatus = require('http-status');
const { Students } = require('../models');
const ApiError = require('../utils/ApiError');

/**
 * Create a student
 * @param {Object} studentBody
 * @returns {Promise<Students>}
 */
const createStudent = async (studentBody) => {
  if (await Students.isEmailTaken(studentBody.email)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
  }
  return Students.create(studentBody);
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
const queryStudents = async (filter, options) => {
  const users = await Students.paginate(filter, options);
  return users;
};

/**
 * Get student by id
 * @param {ObjectId} id
 * @returns {Promise<Students>}
 */
const getStudentById = async (id) => {
  return Students.findById(id);
};

/**
 * Get student by email
 * @param {string} email
 * @returns {Promise<Students>}
 */
const getStudentByEmail = async (email) => {
  return Students.findOne({ email });
};

/**
 * Update student by id
 * @param {ObjectId} studentId
 * @param {Object} updateBody
 * @returns {Promise<Students>}
 */
const updateStudentById = async (studentId, updateBody) => {
  try {
    const student = await getStudentById(studentId);
    if (!student) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Students not found');
    }
    // if (updateBody.email && (await Students.isEmailTaken(updateBody.email, studentId))) {
    //   throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
    // }
    Object.assign(student, updateBody);
    await student.save();

    return student;
  } catch (error) {
    console.error('Error saving student:', error);
    // Handle the error appropriately
  }
};

/**
 * Delete student by id
 * @param {ObjectId} studentId
 * @returns {Promise<Students>}
 */
const deleteStudentById = async (studentId) => {
  const student = await getStudentById(studentId);
  if (!student) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Students not found');
  }
  await student.remove();
  return student;
};

const searchStudent = async (text, options) => {
  // eslint-disable-next-line security/detect-non-literal-regexp
  const regex = new RegExp(text, 'i');
  let students;
  if (options.stage) {
    students = await Students.paginate(
      {
        $and: [
          {
            stage: options.stage,
            $or: [
              { firstName: regex },
              { lastName: regex },
              { middleName: regex },
              { phoneNo: regex },
              { email: regex },
              { refrenceNo: regex },
            ],
          },
        ],
      },
      options
    );
  } else {
    students = await Students.paginate(
      {
        $or: [
          { firstName: regex },
          { lastName: regex },
          { middleName: regex },
          { phoneNo: regex },
          { email: regex },
          { refrenceNo: regex },
        ],
      },
      options
    );
  }

  return students;
};

const getTopNationalities = async ({ startDate, endDate }) => {
  let query = {};

  if (startDate && endDate) {
    query = {
      ...query,
      createdAt: {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      },
    };
  }
  const topNationalities = await Students.aggregate([
    {
      $match: { ...query, stage: 'Applied' },
    },
    {
      $group: {
        _id: '$nationality.english_name',
        countryCode: { $first: '$nationality.alpha2_code' },
        count: { $sum: 1 },
      },
    },
    {
      $sort: { count: -1 },
    },
    {
      $limit: 10, // Change this value to get more or fewer top nationalities
    },
  ]);

  return topNationalities;
};

const getCountByAssignedRole = async ({ startDate, endDate }) => {
  try {
    let query = {};

    if (startDate && endDate) {
      query = {
        ...query,
        createdAt: {
          $gte: new Date(startDate),
          $lte: new Date(endDate),
        },
      };
    }
    const appliedPipeline = [
      {
        $match: { ...query, stage: 'Applied' },
      },
      {
        $unwind: '$assignedTo',
      },
      {
        $group: {
          _id: {
            role: '$assignedTo.role',
            user: '$assignedTo.user',
          },
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          role: '$_id.role',
          count: '$count',
          user: '$_id.user',
        },
      },
    ];

    const enrolledPipeline = [
      {
        $match: { ...query, stage: 'Enrolled' },
      },
      {
        $unwind: '$assignedTo',
      },
      {
        $group: {
          _id: {
            role: '$assignedTo.role',
            user: '$assignedTo.user',
          },
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          role: '$_id.role',
          count: '$count',
          user: '$_id.user',
        },
      },
    ];

    const appliedResults = await Students.aggregate(appliedPipeline).exec();
    const enrolledResults = await Students.aggregate(enrolledPipeline).exec();

    const combinedResults = {};

    appliedResults.forEach((item) => {
      const key = `${item.role}-${item.user}`;
      combinedResults[key] = {
        appliedCount: item.count,
        enrolledCount: 0,
        tag: {},
        status: 'applied',
        role: item.role,
      };

      if (item.role === 'account manager') {
        combinedResults[key].tag.accountManager = item.user;
      } else if (item.role === 'sales') {
        combinedResults[key].tag.salesPerson = item.user;
      } else if (item.role === 'operations') {
        combinedResults[key].tag.operations = item.user;
      }
    });

    enrolledResults.forEach((item) => {
      const key = `${item.role}-${item.user}`;
      if (combinedResults[key]) {
        combinedResults[key].enrolledCount = item.count;
        combinedResults[key].status = 'enrolled';
      } else {
        combinedResults[key] = {
          appliedCount: 0,
          enrolledCount: item.count,
          tag: {},
          status: 'enrolled',
          role: item.role,
        };

        if (item.role === 'account manager') {
          combinedResults[key].tag.accountManager = item.user;
        } else if (item.role === 'sales') {
          combinedResults[key].tag.salesPerson = item.user;
        } else if (item.role === 'operations') {
          combinedResults[key].tag.operations = item.user;
        }
      }
    });

    const finalResults = Object.values(combinedResults);
    return finalResults;
  } catch (error) {
    throw new Error(`Error getting role counts: ${error.message}`);
  }
};

const getDashboardData = async ({ startDate, endDate, filterOptions }) => {
  try {
    const [topNationalities, studentCountByRole, students] = await Promise.all([
      getTopNationalities({ startDate, endDate }),
      getCountByAssignedRole({ startDate, endDate }),
      queryStudents(filterOptions.filter, filterOptions.options),
    ]);

    return {
      topNationalities,
      studentCountByRole,
      students,
    };
  } catch (error) {
    throw new Error(`Error fetching dashboard data: ${error.message}`);
  }
};

module.exports = {
  createStudent,
  queryStudents,
  getStudentById,
  getStudentByEmail,
  updateStudentById,
  getTopNationalities,
  deleteStudentById,
  searchStudent,
  getCountByAssignedRole,
  getDashboardData,
};
