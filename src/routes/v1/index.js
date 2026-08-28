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
const slaSettingRoute = require('./slaSetting.route');
const partnersRoute = require('./partners.route');
const leadsRoute = require('./leads.route');
const schoolRoute = require('./school.routes');
const feesRoute = require('./fees.route');
const bookingRoute = require('./booking.route');
const paymentRoute = require('./payment.route');
const appliedStudentRoute = require('./appliedStudent.route');
const quotesRoute = require('./quotes.route');
const englishLangSchoolRoute = require('./englishLangSchool.route');
const ambassadorsRoute = require('./ambassadors.route');
const notificationRoute = require('./notification.route');
const aptitudeTest = require('./aptitudeTest.route');
const eventSystemRouter = require('./eventSystem.route');
const ieltsRegistrationRouter = require('./ieltsRegistration.route');
const eventRoute = require('./event.route');
const registrationRoute = require('./registration.route');
const testQuestionsRoute = require('./testQuestions.routes');
const emailRoute = require('./email.route');
const ieltsTestRoute = require('./ieltsTest.route');
const whatsappRoute = require('./whatsapp.route');
const reminderRoute = require('./reminder.route');
const notesRoute = require('./notes.route');
const activitiesRoute = require('./activities.route');
const majorRoute = require('./major.route');
const ulearnStudentRoute = require('./ulearnStudent.route');
const accessRequestRoute = require('./accessRequest.route');

const { softAuth, denySubAgent } = require('../../middlewares/subAgentScope');

const router = express.Router();

/**
 * Mount-level deny for sub-agents.
 *
 * Scoping a sub-agent inside /application and /students is not enough on its
 * own: the CRM's back office is one flat API, and a partner holding a valid
 * token can hit any other router by URL. These are the routers that are
 * internal-only or that aggregate across every agent -- a sub-agent has no
 * business in any of them, so they are refused wholesale rather than scoped.
 *
 * router.use(path, mw) registered BEFORE the defaultRoutes loop runs first, so
 * this applies to every method and every sub-path underneath.
 *
 * /users is deliberately NOT here: the sub-agent portal reads the staff roster
 * for @mentions and PATCHes the agent's own profile. It is scoped in
 * user.route.js with scopeSubAgentUsers instead of denied wholesale.
 *
 * NOT yet closed, and tracked as follow-up: /documents, /comments, /notes,
 * /activities and /notifications are used by the sub-agent portal itself, so
 * they cannot simply be denied -- they need the same per-student ownership
 * check /students/:studentId now has. Until then a sub-agent can read those
 * resources for a student that is not theirs by passing the student id
 * directly.
 */
const STAFF_ONLY_PATHS = [
  '/leads',
  '/appliedStudent',
  '/fees',
  '/quotes',
  '/payments',
  '/bookings',
  '/roles',
  '/whatsapp',
  '/reminders',
  '/ambassadors',
  '/sponsorStudents',
  '/exibitionStudent',
  '/school',
  '/news',
  '/email',
  '/ulearn-students',
  '/ielts-registration',
  '/event-system',
  '/events',
  '/registrations',
  // Bulk exports, cross-student PII lookup by phone, and mass mutations.
  '/ielts-tests',
  '/aptitude-tests',
  '/testQuestions',
  '/majors',
];

STAFF_ONLY_PATHS.forEach((path) => {
  // softAuth, NOT legacyGate. denySubAgent only needs the caller IDENTIFIED,
  // and several of these mounts have deliberately public routes -- the Meta
  // WhatsApp webhook, the Fatoorah payment redirect, public lead capture, event
  // registration. Using legacyGate here would make APPLICATION_AUTH an
  // API-wide kill switch that 401s all of them the moment it is flipped on.
  router.use(path, softAuth, denySubAgent);
});

const defaultRoutes = [
  {
    path: '/auth',
    route: authRoute,
  },
  {
    path: '/ielts-tests',
    route: ieltsTestRoute,
  },
  {
    path: '/aptitude-tests',
    route: aptitudeTest,
  },
  {
    path: '/testQuestions',
    route: testQuestionsRoute,
  },
  {
    path: '/englishLangSchool',
    route: englishLangSchoolRoute,
  },
  {
    path: '/notifications',
    route: notificationRoute,
  },
  {
    path: '/ambassadors',
    route: ambassadorsRoute,
  },
  {
    path: '/exibitionStudent',
    route: exibitionStudentRoute,
  },
  { path: '/sla-settings', route: slaSettingRoute },
  { path: '/partners', route: partnersRoute },
  { path: '/bookings', route: bookingRoute },
  { path: '/quotes', route: quotesRoute },
  { path: '/payments', route: paymentRoute },
  {
    path: '/appliedStudent',
    route: appliedStudentRoute,
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
  {
    path: '/event-system',
    route: eventSystemRouter,
  },
  {
    path: '/events',
    route: eventRoute,
  },
  {
    path: '/registrations',
    route: registrationRoute,
  },
  {
    path: '/ielts-registration',
    route: ieltsRegistrationRouter,
  },
  {
    path: '/email',
    route: emailRoute,
  },
  {
    path: '/whatsapp',
    route: whatsappRoute,
  },
  {
    path: '/reminders',
    route: reminderRoute,
  },
  {
    path: '/notes',
    route: notesRoute,
  },
  {
    path: '/activities',
    route: activitiesRoute,
  },
  {
    // major test service (ported from ulearn-backend)
    path: '/majors',
    route: majorRoute,
  },
  {
    // ulearn test-taker identity: Google sign-in, unified history, progress
    path: '/ulearn-students',
    route: ulearnStudentRoute,
  },
  {
    // Partner onboarding: a public request form plus the reviewer queue that
    // turns an approved request into a portal account.
    path: '/access-requests',
    route: accessRequestRoute,
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
