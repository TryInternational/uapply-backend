const Joi = require('joi');
const { objectId } = require('./custom.validation');

const commission = Joi.object().keys({
  type: Joi.string().valid('percentage', 'fixed').required(),
  value: Joi.number().positive().required(),
  currency: Joi.string()
    .trim()
    .uppercase()
    .length(3)
    .when('type', { is: 'fixed', then: Joi.required(), otherwise: Joi.optional().allow('', null) }),
});

const extraTerms = Joi.array()
  .items(
    Joi.object().keys({
      en: Joi.string().trim().max(600).required(),
      ar: Joi.string().trim().max(600).allow('', null),
    })
  )
  .max(20);

/** The deal a reviewer sets when approving a sub-agent. Shared with decideAccessRequest. */
const dealBody = {
  commission: commission.required(),
  extraTerms,
  autoCountersign: Joi.boolean(),
};

const createAgreement = {
  body: Joi.object().keys({
    accessRequestId: Joi.string().custom(objectId).required(),
    ...dealBody,
    // Send straight away (the normal case) or leave as a draft.
    send: Joi.boolean(),
  }),
};

const previewAgreement = {
  body: Joi.object().keys({
    accessRequestId: Joi.string().custom(objectId).required(),
    ...dealBody,
  }),
};

const idParam = {
  params: Joi.object().keys({ agreementId: Joi.string().custom(objectId).required() }),
};

const listAgreements = {
  query: Joi.object().keys({
    status: Joi.string().valid(
      'All',
      'Open',
      'Draft',
      'Sent',
      'Viewed',
      'AgentSigned',
      'Completed',
      'Declined',
      'Voided',
      'Expired'
    ),
    limit: Joi.number().integer().min(1).max(500),
  }),
};

const voidAgreement = {
  ...idParam,
  body: Joi.object().keys({ reason: Joi.string().trim().max(1000).allow('', null) }),
};

const tokenParam = {
  params: Joi.object().keys({ token: Joi.string().trim().min(20).max(200).required() }),
};

const signAgreement = {
  ...tokenParam,
  body: Joi.object().keys({
    // data:image/png;base64,… — the service re-checks it is a real PNG.
    signature: Joi.string().max(1500000).required(),
    method: Joi.string().valid('drawn', 'typed', 'uploaded').required(),
    typedName: Joi.string().trim().max(120).allow('', null),
    consent: Joi.boolean().valid(true).required(),
  }),
};

const declineAgreement = {
  ...tokenParam,
  body: Joi.object().keys({ reason: Joi.string().trim().max(1000).allow('', null) }),
};

const updateSettings = {
  body: Joi.object().keys({
    company: Joi.object().keys({
      nameEn: Joi.string().trim().max(160),
      nameAr: Joi.string().trim().max(160).allow(''),
      cityEn: Joi.string().trim().max(80),
      cityAr: Joi.string().trim().max(80).allow(''),
    }),
    signatory: Joi.object().keys({
      nameEn: Joi.string().trim().max(120),
      nameAr: Joi.string().trim().max(120).allow(''),
      title: Joi.string().trim().max(80).allow(''),
      civilId: Joi.string().trim().max(40).allow(''),
      user: Joi.string().custom(objectId).allow('', null),
      // Read-only fields the settings GET returns; a form that sends the
      // object back whole is tolerated — they are dropped, never written.
      hasSignature: Joi.any().strip(),
      signaturePath: Joi.any().strip(),
      signatureUpdatedAt: Joi.any().strip(),
      signatureUpdatedBy: Joi.any().strip(),
    }),
    defaults: Joi.object().keys({
      commissionType: Joi.string().valid('percentage', 'fixed'),
      percentage: Joi.number().min(0).max(100),
      fixedAmount: Joi.number().min(0),
      currency: Joi.string().trim().uppercase().length(3),
      linkExpiryDays: Joi.number().integer().min(1).max(90),
      autoCountersign: Joi.boolean(),
      reminderDays: Joi.array().items(Joi.number().integer().min(1).max(90)).max(5),
      termLibrary: extraTerms,
    }),
  }),
};

const setSignature = {
  body: Joi.object().keys({ signature: Joi.string().max(1500000).required() }),
};

module.exports = {
  createAgreement,
  previewAgreement,
  idParam,
  listAgreements,
  voidAgreement,
  tokenParam,
  signAgreement,
  declineAgreement,
  updateSettings,
  setSignature,
  dealBody,
};
