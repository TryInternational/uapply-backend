// Ported from ulearn-backend (moment -> luxon: moment is not a dependency here)
const httpStatus = require('http-status');
const { pick } = require('lodash');
const { default: axios } = require('axios');
const { DateTime } = require('luxon');
const catchAsync = require('../utils/catchAsync');
const { MajorService, ulearnStudentService } = require('../services');
const { googlesheet } = require('../thirdparty');
const config = require('../config/config');
const ApiError = require('../utils/ApiError');
const { convertASTToUTC } = require('../utils/Common');

// Helper function to determine if a major is qualified based on nationality and destination
const isQualifiedMajor = (major) => {
  const qualifiedNationalities = [
    'United States of America',
    'Australia',
    'Oman',
    'France',
    'Spain',
    'United Kingdom',
    'Qatar',
    'Kuwait',
    'Saudi Arabia',
    'United Arab Emirates',
    'Germany',
    'Bahrain',
  ];

  // Check if nationality matches (handle both string and object formats)
  let nationalityMatch = false;
  if (typeof major.nationality === 'string') {
    nationalityMatch = qualifiedNationalities.includes(major.nationality);
  } else if (major.nationality && major.nationality.english_name) {
    nationalityMatch = qualifiedNationalities.includes(major.nationality.english_name);
  }

  // Check if destination is UK (handle both string and object formats)
  let destinationMatch = false;
  if (typeof major.destination === 'string') {
    destinationMatch = major.destination === 'UK' || major.destination === 'بريطانيا';
  } else if (major.destination && major.destination.en_name) {
    destinationMatch = major.destination.en_name === 'UK';
  }

  // If no destination field exists, use nationality only
  if (!major.destination) {
    return nationalityMatch;
  }

  return nationalityMatch && destinationMatch;
};

const saveMajorTest = catchAsync(async (req, res) => {
  // Check qualification logic similar to leads
  const checkQualified =
    req.body.data.nationality === 'United States of America' ||
    req.body.data.nationality === 'Australia' ||
    req.body.data.nationality === 'Oman' ||
    req.body.data.nationality === 'France' ||
    req.body.data.nationality === 'Spain' ||
    req.body.data.nationality === 'United Kingdom' ||
    req.body.data.nationality === 'Qatar' ||
    req.body.data.nationality === 'Kuwait' ||
    req.body.data.nationality === 'Saudi Arabia' ||
    req.body.data.nationality === 'United Arab Emirates' ||
    req.body.data.nationality === 'Germany' ||
    req.body.data.nationality === 'Bahrain';

  const qualified = checkQualified && req.body.data.destination === 'UK';

  const majorData = {
    ...req.body.data,
    ansSelected: req.body.data.selectedAns,
    qualified,
    isQualified: qualified,
    fullname: req.body.data.name,
    status: 'New',
    stage: 'Prospect',
  };

  // Link the attempt to the signed-in ulearn student (optional auth middleware);
  // anonymous submissions leave studentId null and work exactly as before.
  if (req.ulearnStudent) {
    majorData.studentId = req.ulearnStudent.id;
  }

  const major = await MajorService.createMajor(majorData);

  if (req.ulearnStudent) {
    // fire-and-forget summary cache update — never blocks or fails the response
    ulearnStudentService.recordAttempt(req.ulearnStudent._id, 'major', major);
  }

  const majors = req.body.data.majors.reduce(function (prevVal, currVal, idx) {
    return idx === 0 ? currVal : `${prevVal}, ${currVal}`;
  }, '');

  const payload = {
    'Date&Time': DateTime.fromJSDate(new Date(req.body.createdAt || Date.now()))
      .setZone('Asia/Kuwait')
      .toFormat("MMM dd yyyy 'at' hh:mm a"),
    Name: req.body.data.name,
    Email: req.body.data.email,
    DOB: DateTime.fromJSDate(new Date(req.body.data.dob)).setZone('Asia/Kuwait').toFormat('MMM dd yyyy'),
    'Country Code': req.body.data.countryCode,
    'Phone Number': req.body.data.phoneNo,
    Nationality: req.body.data.nationality,
    Destination: req.body.data.destination,
    Timetaken: req.body.data.timeTaken,
    Q1: req.body.data.selectedAns[0],
    Q2: req.body.data.selectedAns[1],
    Q3: req.body.data.selectedAns[2],
    Q4: req.body.data.selectedAns[3],
    Q5: req.body.data.selectedAns[4],
    Q6: req.body.data.selectedAns[5],
    Q7: req.body.data.selectedAns[6],
    Q8: req.body.data.selectedAns[7],
    Q9: req.body.data.selectedAns[8],
    Q10: req.body.data.selectedAns[9],
    Q11: req.body.data.selectedAns[10],
    Q12: req.body.data.selectedAns[11],
    Q13: req.body.data.selectedAns[12],
    Q14: req.body.data.selectedAns[13],
    Q15: req.body.data.selectedAns[14],
    Q16: req.body.data.selectedAns[15],
    Q17: req.body.data.selectedAns[16],
    Q18: req.body.data.selectedAns[17],
    Q19: req.body.data.selectedAns[18],
    Q20: req.body.data.selectedAns[19],
    Q21: req.body.data.selectedAns[20],
    Q22: req.body.data.selectedAns[21],
    Q23: req.body.data.selectedAns[22],
    Q24: req.body.data.selectedAns[23],
    Q25: req.body.data.selectedAns[24],
    Q26: req.body.data.selectedAns[25],
    Q27: req.body.data.selectedAns[26],
    Q28: req.body.data.selectedAns[27],
    Q29: req.body.data.selectedAns[28],
    Q30: req.body.data.selectedAns[29],
    Majors: majors,
    source: req.body.data.source,
    campaign: req.body.data.campaign,
    medium: req.body.data.medium,
    content: req.body.data.content,
    Qualified: qualified ? 'Yes' : 'No',
  };

  // Try to save to Google Sheets, but continue even if it fails
  try {
    await googlesheet.addRow(config.googlesheet.major, payload);
  } catch (error) {
    // Check if it's a 403 permission error
    if (error.message && error.message.includes('403') && error.message.includes('permission')) {
      console.warn('Google Sheets permission error. Skipping spreadsheet update. Error:', error.message);
      // Log to a more persistent storage if needed
      // await logErrorToDatabase('google_sheets_permission_error', {
      //   error: error.message,
      //   majorId: major._id,
      //   timestamp: new Date()
      // });
    } else if (error.message && error.message.includes('timeout')) {
      console.warn('Google Sheets timeout. Operation took too long.');
    } else {
      console.error('Unexpected Google Sheets error:', error.message);
    }

    // Don't throw the error - allow the request to complete successfully
    // The major has already been saved to the database
  }

  res.status(httpStatus.CREATED).send(major);
});

const getMajors = catchAsync(async (req, res) => {
  try {
    const filter = pick(req.query, ['destination', 'nationality', 'status', 'stage', 'qualified', 'source', 'role']);

    // Handle destination aliases
    if (filter.destination) {
      const destinationAliases = {
        UK: [
          'UK',
          'بريطانيا',
          'United Kingdom',
          'Britain',
          'Great Britain',
          'GB',
          'England',
          'Scotland',
          'Wales',
          'Northern Ireland',
        ],
        US: ['US', 'United States', 'USA', 'America', 'United States of America'],
        // Add more aliases as needed
      };

      const possibleValues = [];
      const queryDest = filter.destination;

      if (destinationAliases[queryDest]) {
        possibleValues.push(...destinationAliases[queryDest]);
      }

      Object.entries(destinationAliases).forEach(([key, aliases]) => {
        if (aliases.includes(queryDest)) {
          possibleValues.push(...aliases);
        }
      });

      if (possibleValues.length > 0) {
        filter.destination = { $in: possibleValues };
      }
    }

    // Date filtering
    if (req.query.startDate && req.query.endDate) {
      filter.createdAt = {
        $gte: DateTime.fromJSDate(new Date(req.query.startDate), { zone: 'utc' })
          .startOf('day')
          .minus({ hours: 3 })
          .toJSDate(),
        $lte: DateTime.fromJSDate(new Date(req.query.endDate), { zone: 'utc' }).endOf('day').minus({ hours: 3 }).toJSDate(),
      };
    }

    // Date filtering
    if (req.query.startDate && req.query.endDate) {
      filter.createdAt = {
        $gte: DateTime.fromJSDate(new Date(req.query.startDate), { zone: 'utc' })
          .startOf('day')
          .minus({ hours: 3 })
          .toJSDate(),
        $lte: DateTime.fromJSDate(new Date(req.query.endDate), { zone: 'utc' }).endOf('day').minus({ hours: 3 }).toJSDate(),
      };
    }

    const options = pick(req.query, ['limit', 'page', 'populate']);
    options.sortBy = 'createdAt:desc';

    const majors = await MajorService.getMajors(filter, options);

    // Add computed qualified field based on nationality/destination logic
    if (majors.results) {
      majors.results = majors.results.map((major) => ({
        ...major.toObject(),
        qualified: isQualifiedMajor(major),
        isQualified: isQualifiedMajor(major),
      }));
    }

    res.json(majors);
  } catch (err) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

const getMajor = catchAsync(async (req, res) => {
  const major = await MajorService.getMajorById(req.params.majorId);

  if (!major) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Major not found');
  }
  res.send(major);
});

const updateMajor = catchAsync(async (req, res) => {
  const major = await MajorService.updateMajorById(req.params.majorId, req.body);
  res.send(major);
});

const deleteMajor = catchAsync(async (req, res) => {
  await MajorService.deleteMajorById(req.params.majorId);
  res.status(httpStatus.NO_CONTENT).send();
});

const searchMajors = catchAsync(async (req, res) => {
  const options = pick({ ...req.query, sort: { _id: -1 } }, [
    'sortBy',
    'limit',
    'page',
    'populate',
    'qualified',
    { searchString: req.params.text },
  ]);
  const results = await MajorService.searchMajors(req.params.text, options);
  res.status(200).send(results);
});

// New dashboard functions for majors
const getTop5MajorsByCountry = catchAsync(async (req, res) => {
  const majors = await MajorService.getTop5ByCountries({
    ...req.query,
  });
  res.send(majors);
});

const getTop5MajorsByDegree = catchAsync(async (req, res) => {
  const majors = await MajorService.getTop5ByDegree({
    ...req.query,
  });
  res.send(majors);
});

const getMajorsByMonths = catchAsync(async (req, res) => {
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

  const result = await MajorService.queryMajors(queryFilters, options);
  res.send(result);
});

const getMajorsCountByDates = async (filter) => {
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

  const count = await MajorService.countMajors({
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

const getMajorDashboardData = catchAsync(async (req, res) => {
  const { startDate, endDate } = req.query;

  const [
    majorsUlearnCount,
    majorsUapplyCount,
    majorsAppliedCount,
    majorsClosedCount,
    majorsNewCount,
    majorsWaCount,
    majorsOthersCount,
    majorsUkCount,
    top5ByCountry,
    top5ByDegree,
    qualifiedMajors,
    unqualifiedMajors,
  ] = await Promise.all([
    getMajorsCountByDates({ qualified: true, source: 'ulearn', startDate, endDate }),
    getMajorsCountByDates({ qualified: true, source: 'uapply', startDate, endDate }),
    getMajorsCountByDates({ qualified: true, status: 'Applied', startDate, endDate }),
    getMajorsCountByDates({ qualified: true, status: 'Closed', startDate, endDate }),
    getMajorsCountByDates({ qualified: true, status: 'New', startDate, endDate }),
    getMajorsCountByDates({ qualified: true, status: 'Sent Whatsapp', startDate, endDate }),
    getMajorsCountByDates({ qualified: true, destination: 'Others', startDate, endDate }),
    getMajorsCountByDates({ qualified: true, destination: 'UK', startDate, endDate }),
    MajorService.getTop5ByCountries({ startDate, endDate, qualified: true }),
    MajorService.getTop5ByDegree({ startDate, endDate, qualified: true }),
    getMajorsCountByDates({ qualified: true, startDate, endDate }),
    getMajorsCountByDates({ qualified: false, startDate, endDate }),
  ]);

  res.status(200).send({
    majorsUlearnCount,
    majorsUapplyCount,
    majorsAppliedCount,
    majorsClosedCount,
    majorsNewCount,
    majorsWaCount,
    majorsOthersCount,
    majorsUkCount,
    top5ByCountry,
    top5ByDegree,
    qualifiedMajors,
    unqualifiedMajors,
  });
});

const updateAllMajorsQualified = catchAsync(async (req, res) => {
  try {
    const { Major } = require('../models');

    const result = await Major.updateMany(
      {}, // match all documents
      [
        {
          $set: {
            qualified: {
              $cond: {
                if: {
                  $and: [{ $ifNull: ['$destination', false] }, { $ifNull: ['$nationality', false] }],
                },
                then: {
                  $and: [
                    {
                      $in: [
                        '$destination',
                        [
                          'UK',
                          'بريطانيا',
                          'United Kingdom',
                          'Britain',
                          'Great Britain',
                          'GB',
                          'England',
                          'Scotland',
                          'Wales',
                          'Northern Ireland',
                        ],
                      ],
                    },
                    {
                      $in: [
                        '$nationality',
                        [
                          'United States of America',
                          'Australia',
                          'Oman',
                          'France',
                          'Spain',
                          'United Kingdom',
                          'Qatar',
                          'Kuwait',
                          'Saudi Arabia',
                          'United Arab Emirates',
                          'Germany',
                          'Bahrain',
                        ],
                      ],
                    },
                  ],
                },
                else: {
                  $or: [
                    {
                      $and: [
                        { $ifNull: ['$destination', false] },
                        {
                          $in: [
                            '$destination',
                            [
                              'UK',
                              'بريطانيا',
                              'United Kingdom',
                              'Britain',
                              'Great Britain',
                              'GB',
                              'England',
                              'Scotland',
                              'Wales',
                              'Northern Ireland',
                            ],
                          ],
                        },
                      ],
                    },
                    {
                      $and: [
                        { $ifNull: ['$nationality', false] },
                        {
                          $in: [
                            '$nationality',
                            [
                              'United States of America',
                              'Australia',
                              'Oman',
                              'France',
                              'Spain',
                              'United Kingdom',
                              'Qatar',
                              'Kuwait',
                              'Saudi Arabia',
                              'United Arab Emirates',
                              'Germany',
                              'Bahrain',
                            ],
                          ],
                        },
                      ],
                    },
                  ],
                },
              },
            },
          },
        },
      ]
    );

    res.status(200).json({
      success: true,
      message: 'Successfully updated qualified field for all majors',
      modifiedCount: result.modifiedCount,
      matchedCount: result.matchedCount,
    });
  } catch (error) {
    console.error('Error updating majors qualified field:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update qualified field',
      error: error.message,
    });
  }
});

module.exports = {
  saveMajorTest,
  getMajors,
  searchMajors,
  deleteMajor,
  getMajor,
  updateMajor,
  getTop5MajorsByCountry,
  getTop5MajorsByDegree,
  getMajorsByMonths,
  getMajorDashboardData,
  updateAllMajorsQualified,
};
