/* eslint-disable no-plusplus */
const { Application } = require('../models');

// Function to find an application by ID
async function findApplicationById(id) {
  try {
    const application = await Application.findById(id);
    return application;
  } catch (err) {
    throw new Error(`Failed to find application with ID ${id}: ${err.message}`);
  }
}

async function getApplications() {
  try {
    const applications = await Application.find({});
    return applications;
  } catch (error) {
    throw new Error(`Failed to find applications`);
  }
}

// Function to create a new application
async function createApplication(applicationData) {
  try {
    const application = await Application.create(applicationData);
    return application;
  } catch (err) {
    throw new Error(`Failed to create application: ${err.message}`);
  }
}
const getApplicationByStudentId = async (studentId) => {
  return Application.find({ studentId });
};
// Function to update an application by ID
async function updateApplicationById(id, updateData) {
  try {
    const application = await Application.findByIdAndUpdate(id, updateData, { new: true });
    return application;
  } catch (err) {
    throw new Error(`Failed to update application with ID ${id}: ${err.message}`);
  }
}

async function deleteApplication(applicationId) {
  try {
    const deletedApplication = await Application.findByIdAndDelete(applicationId);
    return deletedApplication;
  } catch (error) {
    throw new Error(`Failed to delete application with ID ${applicationId}`);
  }
}

const getApplicationsCountByPhase = async (startDate, endDate) => {
  try {
    // Get all unique phases
    const allPhases = await Application.distinct('portalApplicationStatus.applicationPhases.status');
    const matchStage = {
      $match: {
        'portalApplicationStatus.applicationPhases.isPrevious': true,
      },
    };

    if (startDate && endDate) {
      matchStage.$match.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }
    const result = await Application.aggregate([
      matchStage,
      { $unwind: '$portalApplicationStatus.applicationPhases' },
      { $match: { 'portalApplicationStatus.applicationPhases.isPrevious': true } },
      {
        $group: {
          _id: '$portalApplicationStatus.applicationPhases.status',
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ]);

    // Convert the result into a dictionary for easy lookup
    const counts = result.reduce((acc, { _id, count }) => {
      acc[_id] = count;
      return acc;
    }, {});

    // Ensure all phases are included with count of 0 if not present in the result
    const output = allPhases.map((phase) => ({
      status: phase,
      count: counts[phase] || 0,
    }));

    return output;
  } catch (error) {
    throw new Error(`Error fetching current application counts by phase: ${error.message}`);
  }
};

const getTopUniversitiesByApplications = async (startDate, endDate, limit = 10) => {
  try {
    const matchStage = {};

    if (startDate && endDate) {
      matchStage.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }
    const universities = await Application.aggregate([
      { $match: matchStage },

      { $group: { _id: '$institute', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: limit },

      {
        $project: {
          name: '$institute.name',
          count: 1,
        },
      },
    ]);

    return universities;
  } catch (error) {
    throw new Error(`Error fetching current application counts by phase: ${error.message}`);
  }
};
const getTopEnrolledUniversities = async (startDate, endDate) => {
  const matchStage = {
    'portalApplicationStatus.applicationPhases.closedStatus': true,
    'portalApplicationStatus.applicationPhases.isPrevious': true,
  };

  if (startDate && endDate) {
    matchStage.createdAt = {
      $gte: new Date(startDate),
      $lte: new Date(endDate),
    };
  }

  const pipeline = [
    // Step 1: Unwind the applicationPhases array
    {
      $unwind: '$portalApplicationStatus.applicationPhases',
    },
    // Step 2: Match documents where the phase meets the criteria
    { $match: matchStage },
    // Step 3: Group by university name and count the matches
    {
      $group: {
        _id: '$institute', // Group by the university name
        count: { $sum: 1 }, // Count the number of documents
      },
    },
    // Step 4: Sort the results by count in descending order
    {
      $sort: { count: -1 },
    },
  ];

  try {
    const results = await Application.aggregate(pipeline).exec();

    // Transform results to the desired output format
    return results.map((result) => ({
      institute: result._id,
      count: result.count,
    }));
  } catch (error) {
    throw new Error(`Error fetching top enrolled universities: ${error.message}`);
  }
};

const getEnrolledApplicationsCountByMonth = async () => {
  const currentYear = new Date().getFullYear();

  const monthlySums = await Application.aggregate([
    {
      $unwind: '$portalApplicationStatus.applicationPhases',
    },
    {
      $match: {
        'portalApplicationStatus.applicationPhases.closedStatus': true,
        createdAt: {
          $gte: new Date(currentYear, 0, 1),
          $lte: new Date(currentYear, 11, 31),
        },
      },
    },
    {
      $addFields: {
        month: { $month: '$createdAt' }, // Extract month from createdDate
        year: { $year: '$createdAt' }, // Extract year from createdDate
      },
    },
    {
      $group: {
        _id: { month: '$month' },
        count: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        month: '$_id.month',
        count: 1,
      },
    },
    {
      $sort: { month: 1 },
    },
  ]);

  // Generate an array of all possible months (1 to 12)
  const allMonths = Array.from({ length: 12 }, (_, i) => i + 1);

  // Create a map to store existing counts for quick lookup
  const countMap = new Map();
  monthlySums.forEach((item) => {
    countMap.set(item.month, item.count);
  });

  // Create an array to hold the final result
  const result = [];

  allMonths.forEach((month) => {
    const count = countMap.get(month) || 0;
    result.push({ year: currentYear, month, count });
  });

  return result;
};

const getApplicationsCountByMonth = async () => {
  const currentYear = new Date().getFullYear();

  const monthlySums = await Application.aggregate([
    {
      $match: {
        createdAt: {
          $gte: new Date(currentYear, 0, 1),
          $lte: new Date(currentYear, 11, 31),
        },
      },
    },
    {
      $addFields: {
        month: { $month: '$createdAt' }, // Extract month from createdDate
        year: { $year: '$createdAt' }, // Extract year from createdDate
      },
    },
    {
      $group: {
        _id: { month: '$month' },
        bookingCount: { $sum: 1 }, // Count the number of documents (applications)
      },
    },
    {
      $project: {
        _id: 0,
        month: '$_id.month',
        bookingCount: 1,
      },
    },
    {
      $sort: { month: 1 },
    },
  ]);

  // Generate an array of all possible months (1 to 12)
  const allMonths = Array.from({ length: 12 }, (_, i) => i + 1);

  // Create a map to store existing sums and counts for quick lookup
  const sumMap = new Map();
  monthlySums.forEach((item) => {
    sumMap.set(item.month, { bookingCount: item.bookingCount });
  });

  // Create an array to hold the final result
  const result = [];

  allMonths.forEach((month) => {
    const { bookingCount = 0 } = sumMap.get(month) || {};
    result.push({ year: currentYear, month, bookingCount });
  });

  return result;
};

// Export the functions for use in other files
module.exports = {
  findApplicationById,
  createApplication,
  updateApplicationById,
  getApplications,
  deleteApplication,
  getApplicationByStudentId,
  getApplicationsCountByPhase,
  getTopUniversitiesByApplications,
  getTopEnrolledUniversities,
  getApplicationsCountByMonth,
  getEnrolledApplicationsCountByMonth,
};
