const express = require('express');
const authRoute = require('./auth.route');
const studentAuthRoute = require('./studentAuth.route');
const userRoute = require('./user.route');
const docsRoute = require('./docs.route');
const config = require('../../config/config');
const coursesRoute = require('./courses.route');
const universityRoute = require('./universities.route');
const universityDetailsRoute = require('./universityDetails.route');
const courseDetailsRoute = require('./coursedetails.route');
const subjectsRoute = require('./subjects.route');
const studentsRoute = require('./students.route');
const countriesRoute = require('./countries.route');
const rolesRoute = require('./role.route');
const documentsRoute = require('./documents.route');
const courseLevelRoute = require('./courseLevel.route');
const applicationRoute = require('./application.route');
const sponsorStudentsRoute = require('./sponsorStudents.route');
const exibitionStudentRoute = require('./exibitionStudent.route');
const newsRoute = require('./news.route');
const commentsRoute = require('./comments.route');
const leadsRoute = require('./leads.route');
const schoolRoute = require('./school.routes');
const feesRoute = require('./fees.route');

const router = express.Router();

const defaultRoutes = [
  {
    path: '/auth',
    route: authRoute,
  },
  {
    path: '/exibitionStudent',
    route: exibitionStudentRoute,
  },
  {
    path: '/school',
    route: schoolRoute,
  },
  {
    path: '/comments',
    route: commentsRoute,
  },
  {
    path: '/studentAuth',
    route: studentAuthRoute,
  },
  {
    path: '/leads',
    route: leadsRoute,
  },
  {
    path: '/countries',
    route: countriesRoute,
  },
  {
    path: '/users',
    route: userRoute,
  },
  {
    path: '/courses',
    route: coursesRoute,
  },
  {
    path: '/universities',
    route: universityRoute,
  },
  {
    path: '/universityDetails',
    route: universityDetailsRoute,
  },
  {
    path: '/sponsorStudents',
    route: sponsorStudentsRoute,
  },
  {
    path: '/courseDetails',
    route: courseDetailsRoute,
  },
  {
    path: '/subjects',
    route: subjectsRoute,
  },
  {
    path: '/students',
    route: studentsRoute,
  },
  {
    path: '/news',
    route: newsRoute,
  },
  {
    path: '/documents',
    route: documentsRoute,
  },
  {
    path: '/courseLevels',
    route: courseLevelRoute,
  },
  {
    path: '/application',
    route: applicationRoute,
  },
  {
    path: '/roles',
    route: rolesRoute,
  },
  {
    path: '/docs',
    route: docsRoute,
  },
  {
    path: '/fees',
    route: feesRoute,
  },
];

const devRoutes = [
  // routes available only in development mode
  {
    path: '/docs',
    route: docsRoute,
  },
];

defaultRoutes.forEach((route) => {
  router.use(route.path, route.route);
});

/* istanbul ignore next */
if (config.env === 'development') {
  devRoutes.forEach((route) => {
    router.use(route.path, route.route);
  });
}

module.exports = router;
