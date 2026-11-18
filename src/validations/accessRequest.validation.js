const Joi = require('joi');
const { objectId } = require('./custom.validation');
const { dealBody } = require('./agreement.validation');

/**
 * "Students placed each year" band.
 *
 * The app-wide xss-clean middleware HTML-escapes every "<" in a request body
 * before validation, so the "<25" band arrives as "&lt;25" and was refused —
 * nobody could send the form with "Under 25" chosen. Undo that one escape,
 * then check against the list. The form offers the first three; '100-500' and
 * '500+' are older bands some stored profiles still carry.
 */
const STUDENTS_PER_YEAR = Joi.string()
  .replace(/^&lt;/, '<')
  .valid('<25', '25-100', '100+', '100-500', '500+')
  // Said in the form's own words: the three bands it offers.
  .messages({ 'any.only': 'Choose how many students are placed each year: Under 25, 25–100, or 100 or more.' });

// Joi rejects unknown keys by default, so a body carrying `status`, `user`,
// `decision` or a role id is a 400 before it ever reaches the controller.
const submitAccessRequest = {
  body: Joi.object().keys({
    // A role NAME, never a role id. These two keys are the only values the
    // server will map to a role, and neither maps to an internal one.
    requestedRole: Joi.string().valid('subAgent', 'schoolCounselor').required(),
    name: Joi.string().trim().min(2).max(120).required(),
    // Arabic spellings are optional (staff can add them later for the agreement).
    nameAr: Joi.string().trim().max(120).allow('', null),
    // Shape only, no TLD list: Joi's bundled list lags behind real domains,
    // and a genuine address on a newer ending was being refused.
    email: Joi.string()
      .trim()
      .lowercase()
      .email({ tlds: { allow: false } })
      .max(254)
      .required(),
    phoneCode: Joi.string().trim().max(8).allow('', null),
    phone: Joi.string().trim().min(5).max(32).required(),
    organisation: Joi.string().trim().min(2).max(160).required(),
    organisationAr: Joi.string().trim().max(160).allow('', null),
    country: Joi.string().trim().max(80).allow('', null),
    city: Joi.string().trim().max(80).allow('', null),
    website: Joi.string().trim().max(200).allow('', null),
    note: Joi.string().trim().max(1000).allow('', null),

    title: Joi.string().trim().max(80).allow('', null),
    organisationDetails: Joi.object()
      .keys({
        legalName: Joi.string().trim().max(160).allow('', null),
        yearEstablished: Joi.number().integer().min(1900).max(2100).allow(null, ''),
        address: Joi.string().trim().max(240).allow('', null),
        staffCount: Joi.string().valid('1-5', '6-20', '21-50', '50+').allow('', null),
        studentsPerYear: STUDENTS_PER_YEAR.allow('', null),
        // No office — works online / from home. Lifts the address requirement.
        noOffice: Joi.boolean(),
        destinations: Joi.array().items(Joi.string().trim().max(60)).max(20),
        services: Joi.string().trim().max(400).allow('', null),
        socialMedia: Joi.string().trim().max(200).allow('', null),
      })
      // A sub-agent must tell us who they are as a company; a school counsellor
      // is vouched for by the school, so for them the block stays optional.
      .when('requestedRole', {
        is: 'subAgent',
        then: Joi.object({
          address: Joi.string()
            .trim()
            .min(3)
            .max(240)
            .when('noOffice', { is: true, then: Joi.optional().allow('', null), otherwise: Joi.required() }),
        }).required(),
      }),
    personInCharge: Joi.object()
      .keys({
        name: Joi.string().trim().max(120).allow('', null),
        nameAr: Joi.string().trim().max(120).allow('', null),
        title: Joi.string().trim().max(80).allow('', null),
        email: Joi.string()
          .trim()
          .lowercase()
          .email({ tlds: { allow: false } })
          .max(254)
          .allow('', null),
        phoneCode: Joi.string().trim().max(8).allow('', null),
        phone: Joi.string().trim().max(32).allow('', null),
        civilIdNumber: Joi.string().trim().max(40).allow('', null),
        sameAsApplicant: Joi.boolean(),
      })
      .when('requestedRole', {
        is: 'subAgent',
        then: Joi.object({ name: Joi.string().trim().min(2).max(120).required() }).required(),
      }),
    // The upload receipt returned by POST /access-requests/civil-id. Verified
    // server-side (HMAC + expiry) before anything is stored.
    civilIdUpload: Joi.string()
      .trim()
      .max(2000)
      .allow('', null)
      .when('requestedRole', { is: 'subAgent', then: Joi.required().disallow('', null) }),
    // Optional: the receipt from POST /access-requests/logo.
    logoUpload: Joi.string().trim().max(2000).allow('', null),
  }),
};

const civilIdLink = {
  params: Joi.object().keys({
    requestId: Joi.string().custom(objectId).required(),
  }),
};

const listAccessRequests = {
  query: Joi.object().keys({
    status: Joi.string().valid('Pending', 'Approved', 'Declined'),
    limit: Joi.number().integer().min(1).max(200),
  }),
};

const decideAccessRequest = {
  params: Joi.object().keys({
    // custom objectId, so a junk id is a 400 rather than a mongoose CastError
    // surfacing as a 500.
    requestId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    decision: Joi.string().valid('Approved', 'Declined').required(),
    // Required when declining; the controller enforces that, because Joi
    // cannot see the decision value from inside the reason rule cleanly here.
    reason: Joi.string().trim().max(1000).allow('', null),
    // Sub-agents: the deal. Approving sends the agreement; the account is
    // opened when it comes back signed. `skipAgreement` keeps the old path
    // (account + invite now) for a partner whose contract exists on paper.
    agreement: Joi.object().keys(dealBody),
    skipAgreement: Joi.boolean(),
  }),
};

const resendInvite = {
  params: Joi.object().keys({
    requestId: Joi.string().custom(objectId).required(),
  }),
};

module.exports = {
  STUDENTS_PER_YEAR,
  submitAccessRequest,
  listAccessRequests,
  decideAccessRequest,
  resendInvite,
  civilIdLink,
};
