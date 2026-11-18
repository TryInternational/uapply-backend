const Joi = require('joi');
const { objectId } = require('./custom.validation');
const { submitAccessRequest, STUDENTS_PER_YEAR } = require('./accessRequest.validation');
const { dealBody } = require('./agreement.validation');

// The two directory pages, in the vocabulary the pages themselves use. The
// service maps these to a requestedRole; no caller ever names a role id.
const KIND = Joi.string().valid('subagent', 'counselor');

/**
 * A logo URL.
 *
 * Constrained to https so a stored value cannot be a `javascript:` or `data:`
 * URL that later renders inside the back office. Joi rejects unknown keys by
 * default, so a body carrying `role`, `password` or `organisation` here is a
 * 400 before the controller sees it -- this endpoint writes ONE field.
 */
const LOGO = Joi.string()
  .trim()
  .uri({ scheme: ['https'] })
  .max(1024);

/**
 * Two callers, one schema.
 *
 *   • The sub-agent drawer sends the PUBLIC request form's body verbatim
 *     (requestedRole, name, organisationDetails, personInCharge, the upload
 *     receipts) plus the deal. Re-using submitAccessRequest's body means the
 *     paperwork rules — address unless noOffice, person in charge, Civil ID —
 *     are enforced for a staff-added sub-agent exactly as for one who applied.
 *   • The school drawer sends the short form: `contact` and the basics, no
 *     requestedRole. With requestedRole absent the `.when('requestedRole')`
 *     rules do not fire, so the short form passes untouched.
 */
const createPartner = {
  body: submitAccessRequest.body
    .keys({
      kind: KIND.required(),
      // short form: the contact person (the full form sends `name`)
      contact: Joi.string().trim().min(2).max(120),
      // Instagram handle, without the @ (short form; the full form puts it in organisationDetails)
      socialMedia: Joi.string().trim().max(80).allow('', null),
      // a URL already uploaded from the browser (short form); the full form sends logoUpload
      organisationLogo: LOGO.allow('', null),
      // the deal, when the new sub-agent should receive the agreement now
      agreement: Joi.object().keys(dealBody),
      // open the portal without an agreement (contract exists on paper)
      skipAgreement: Joi.boolean(),
    })
    .fork(['requestedRole', 'name'], (schema) => schema.optional())
    .or('name', 'contact'),
};

const updatePartner = {
  params: Joi.object().keys({
    partnerId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      kind: KIND.required(),
      organisation: Joi.string().trim().min(2).max(160),
      contact: Joi.string().trim().min(2).max(120),
      // Shape only, no TLD list: this is a login that may already exist on an
      // unusual domain, and the drawer only sends it when it was changed.
      email: Joi.string()
        .trim()
        .lowercase()
        .email({ tlds: { allow: false } })
        .max(254),
      phoneCode: Joi.string().trim().max(8).allow('', null),
      phone: Joi.string().trim().max(32).allow('', null),
      city: Joi.string().trim().max(80).allow('', null),
      country: Joi.string().trim().max(80).allow('', null),
      website: Joi.string().trim().max(200).allow('', null),
      socialMedia: Joi.string().trim().max(80).allow('', null),
      address: Joi.string().trim().max(300).allow('', null),
      noOffice: Joi.boolean(),
      studentsPerYear: STUDENTS_PER_YEAR.allow('', null),
      destinations: Joi.array().items(Joi.string().trim().max(60)).max(12),
      organisationLogo: LOGO.allow('', null),
    })
    .min(2),
};

const removePartner = {
  params: Joi.object().keys({
    partnerId: Joi.string().custom(objectId).required(),
  }),
  query: Joi.object().keys({
    kind: KIND.required(),
  }),
};

const updateLogo = {
  params: Joi.object().keys({
    partnerId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    kind: KIND.required(),
    // Empty clears the logo and puts the monogram back.
    organisationLogo: LOGO.allow('', null).required(),
  }),
};

module.exports = { createPartner, updateLogo, updatePartner, removePartner };
