const httpStatus = require('http-status');
const pick = require('../utils/pick');
const catchAsync = require('../utils/catchAsync');
const { activitiesService } = require('../services');
const { isSubAgent } = require('../middlewares/subAgentScope');
const { isExternalPartner } = require('../middlewares/subAgentScope');

// Client-side log point for things the server can't observe — logged calls /
// emails / WhatsApp sends from QuickLogModal / TemplateModal.
const createActivity = catchAsync(async (req, res) => {
  // A sub-agent has already been scoped to a student it owns by the time it
  // gets here, but the body is still theirs to write -- without this they could
  // author a timeline entry attributed to a named counsellor. Actor identity is
  // taken from the session and the type is pinned to a note.
  if (isSubAgent(req.user)) {
    req.body = {
      student: req.body.student || req.body.studentId,
      type: 'note',
      text: req.body.text,
      actorId: req.user.id,
      actorName: req.user.name,
    };
  }

  const activity = await activitiesService.createActivity(req.body);
  res.status(httpStatus.CREATED).send(activity);
});

// GET /activities?studentId=&limit=&page=  — newest first, paginated.
/**
 * Activity types an EXTERNAL PARTNER may see. Filtered SERVER-SIDE — a
 * client-side filter would still ship the internal entries to the partner's
 * browser.
 *
 * What's excluded and why:
 *   - assignment: internal staffing ("updated assignments: Zainab (Sales)").
 *     Who at Ulearn holds which slot is not the school's business.
 *   - reminder / call / whatsapp / email / note: the team's own working notes
 *     and outreach log.
 *   - edit: profile-edit bookkeeping; the partner sees the result on the page.
 * What's included: stage (referral and application decisions, phase moves) and
 * doc (documents arriving) — the events that describe the student's journey.
 */
const PARTNER_VISIBLE_ACTIVITY_TYPES = ['stage', 'doc'];

const getActivities = catchAsync(async (req, res) => {
  const { studentId, limit, page } = pick(req.query, ['studentId', 'limit', 'page']);
  const activities = await activitiesService.getActivitiesByStudentId(studentId, {
    limit,
    page,
    types: isExternalPartner(req.user) ? PARTNER_VISIBLE_ACTIVITY_TYPES : undefined,
  });
  res.send(activities);
});

module.exports = {
  createActivity,
  getActivities,
};
