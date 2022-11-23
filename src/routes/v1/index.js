const express = require('express');
const authRoute = require('./auth.route');
const userRoute = require('./user.route');
const docsRoute = require('./docs.route');
const config = require('../../config/config');
const coursesRoute = require('./courses.route');
const universityRoute = require('./universities.route');
const universityDetailsRoute = require('./universityDetails.route');
const courseDetailsRoute = require('./coursedetails.route');
const subjectsRoute = require('./subjects.route');

const router = express.Router();

const defaultRoutes = [
  {
    path: '/auth',
    route: authRoute,
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
    path: '/courseDetails',
    route: courseDetailsRoute,
  },
  {
    path: '/subjects',
    route: subjectsRoute,
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
