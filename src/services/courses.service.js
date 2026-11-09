const httpStatus = require('http-status');
const { Courses, Subjects } = require('../models');
const ApiError = require('../utils/ApiError');

/** Filter-drawer facets cache — see getCourseFacets. */
let facetCache = null;
const FACET_TTL = 10 * 60 * 1000;
const dropFacetCache = () => {
  facetCache = null;
};

/**
 * Create a booking
 * @param {Object} courseBody
 * @returns {Promise<Course>}
 */
const createCourse = async (courseBody) => {
  const course = await Courses.create(courseBody);
  dropFacetCache();
  return course;
};

/**
 * Query for bookings
 * @param {Object} _filter - Mongo filter
 * @param {Object} options - Query options
 * @param {string} [options.sortBy] - Sort option in the format: sortField:(desc|asc)
 * @param {number} [options.limit] - Maximum number of results per page (default = 10)
 * @param {number} [options.page] - Current page (default = 1)
 * @returns {Promise<QueryResult>}
 */
const queryCourses = async (filter, options) => {
  const courses = await Courses.paginate(filter, options);
  return courses;
};

/**
 * @param {ObjectId} id
 * @returns {Promise<User>}
 */
const getCourseById = async (id) => {
  return Courses.findById(id);
};
const getCourses = async () => {
  return Courses.find();
};

/**
 * Update booking by id
 * @param {ObjectId} id
 * @param {Object} updateBody
 * @returns {Promise<User>}
 */
const updateCourseById = async (id, updateBody) => {
  const course = await getCourseById(id);
  if (!course) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Courses not found');
  }
  Object.assign(course, updateBody);
  await course.save();
  dropFacetCache();
  return course;
};

/**
 * Delete booking by id
 * @param {ObjectId} courseId
 * @returns {Promise<User>}
 */
const deleteCourseById = async (courseId) => {
  const course = await getCourseById(courseId);
  if (!course) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Course not found');
  }
  await course.remove();
  dropFacetCache();
  return course;
};

/**
 * Delete booking by id
 * @param {ObjectId} courseId
 * @param {Object} commentBody
 * @returns {Promise<Comment>}
 */

// typed text is matched literally — "+965…" or "(" used to throw and fail the search
const literal = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const searchCourse = async (text, options) => {
  // eslint-disable-next-line security/detect-non-literal-regexp
  const regex = new RegExp(literal(text), 'i');
  const courses = await Courses.paginate({ name: regex }, options);
  return courses;
};

/**
 * Option lists + counts for the Courses filter drawer (universities, campuses,
 * intakes, majors, levels, durations, study modes) over the whole catalogue.
 * The catalogue changes rarely and the aggregation scans ~35k documents, so
 * the result is cached in memory for 10 minutes (and dropped on any write).
 */
const getCourseFacets = async () => {
  if (facetCache && Date.now() - facetCache.at < FACET_TTL) return facetCache.data;
  const unwindCount = (path) => [{ $unwind: `$${path}` }, { $group: { _id: `$${path}`, count: { $sum: 1 } } }];
  const [agg] = await Courses.aggregate([
    {
      $facet: {
        universities: [
          { $group: { _id: '$institutionSlug', name: { $first: '$institution' }, count: { $sum: 1 } } },
          { $sort: { name: 1 } },
        ],
        levels: [{ $group: { _id: '$courseLevel', count: { $sum: 1 } } }],
        cities: [{ $unwind: '$locations' }, { $group: { _id: '$locations.value', count: { $sum: 1 } } }],
        intakes: unwindCount('intakeMonths'),
        durations: unwindCount('courseDurationValues'),
        modes: unwindCount('attendanceTypes'),
        subjects: unwindCount('subjects'),
        total: [{ $count: 'n' }],
      },
    },
  ]).allowDiskUse(true);
  const clean = (rows) =>
    (rows || [])
      .filter((r) => r._id !== null && r._id !== undefined && r._id !== '')
      .map((r) => ({ value: r._id, count: r.count }));
  const subjectRows = clean(agg.subjects);
  const names = await Subjects.find({ slug: { $in: subjectRows.map((r) => r.value) } }, { slug: 1, name: 1 }).lean();
  const nameOf = Object.fromEntries(names.map((n) => [n.slug, n.name]));
  const data = {
    total: (agg.total[0] || {}).n || 0,
    universities: (agg.universities || [])
      .filter((r) => r._id)
      .map((r) => ({ value: r._id, label: r.name || r._id, count: r.count })),
    levels: clean(agg.levels).sort((a, b) => b.count - a.count),
    cities: clean(agg.cities).sort((a, b) => String(a.value).localeCompare(String(b.value))),
    intakes: clean(agg.intakes),
    durations: clean(agg.durations).sort((a, b) => a.value - b.value),
    modes: clean(agg.modes).sort((a, b) => b.count - a.count),
    subjects: subjectRows
      .map((r) => ({ ...r, label: nameOf[r.value] || r.value }))
      .sort((a, b) => String(a.label).localeCompare(String(b.label))),
  };
  facetCache = { at: Date.now(), data };
  return data;
};

/** Distinct universities in a filtered course set. */
const countUniversities = async (filter) => (await Courses.distinct('institutionSlug', filter)).filter(Boolean).length;

module.exports = {
  countUniversities,
  getCourseFacets,
  createCourse,
  queryCourses,
  getCourseById,
  updateCourseById,
  deleteCourseById,
  getCourses,
  searchCourse,
};
