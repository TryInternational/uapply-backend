const Joi = require('joi');
const { objectId } = require('./custom.validation');

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

const createPartner = {
  body: Joi.object().keys({
    kind: KIND.required(),
    // The organisation is the headline on the card; the contact is the person
    // who gets the account and the invite.
    organisation: Joi.string().trim().min(2).max(160).required(),
    contact: Joi.string().trim().min(2).max(120).required(),
    email: Joi.string().trim().lowercase().email().max(254).required(),
    phoneCode: Joi.string().trim().max(8).allow('', null),
    phone: Joi.string().trim().min(5).max(32).required(),
    city: Joi.string().trim().max(80).allow('', null),
    country: Joi.string().trim().max(80).allow('', null),
    website: Joi.string().trim().max(200).allow('', null),
    note: Joi.string().trim().max(1000).allow('', null),
    organisationLogo: LOGO.allow('', null),
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

module.exports = { createPartner, updateLogo };
