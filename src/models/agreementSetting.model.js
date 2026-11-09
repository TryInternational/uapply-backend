const mongoose = require('mongoose');
const { toJSON } = require('./plugins');

/**
 * Agreement settings — one document for the whole tenant (like slaSetting).
 *
 * Who signs for Ulearn (name in both languages, Civil ID, the signature image
 * on file), how the company is named on the paper, and the defaults a
 * reviewer starts from when setting a partner's deal. The signatory's
 * signature image is the one thing here that must never be public: it lives
 * in the bucket under a random path and is only ever composited into a PDF
 * by the server, or shown to an admin through a short-lived link.
 */
const agreementSettingSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'default', unique: true },

    company: {
      nameEn: { type: String, trim: true, default: 'Ulearn Education Consultancy Services Co.' },
      nameAr: { type: String, trim: true, default: 'شركة يوليرن لخدمات استشارات التعليم' },
      cityEn: { type: String, trim: true, default: 'Kuwait City' },
      cityAr: { type: String, trim: true, default: 'مدينة الكويت' },
    },

    signatory: {
      nameEn: { type: String, trim: true, default: 'Mohammed Bashir Al Rashidi' },
      nameAr: { type: String, trim: true, default: 'محمد بشير الرشيدي' },
      title: { type: String, trim: true, default: 'Authorised signatory' },
      civilId: { type: String, trim: true, default: '291080101241' },
      // Object path in the bucket; absent until the signatory draws/uploads it.
      signaturePath: { type: String, trim: true },
      signatureUpdatedAt: { type: Date },
      signatureUpdatedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User' },
      // The staff account allowed to apply this signature by hand. When unset,
      // any admin may countersign.
      user: { type: mongoose.SchemaTypes.ObjectId, ref: 'User' },
    },

    defaults: {
      commissionType: { type: String, enum: ['percentage', 'fixed'], default: 'percentage' },
      percentage: { type: Number, default: 15, min: 0, max: 100 },
      fixedAmount: { type: Number, default: 1000, min: 0 },
      currency: { type: String, trim: true, uppercase: true, default: 'GBP' },
      // Days the signing link stays valid.
      linkExpiryDays: { type: Number, default: 14, min: 1, max: 90 },
      autoCountersign: { type: Boolean, default: true },
      // Reminder emails to an unsigned partner, days after sending.
      reminderDays: { type: [Number], default: [3, 7] },
      // Reusable extra terms a reviewer can pick from.
      termLibrary: {
        type: [
          new mongoose.Schema(
            {
              en: { type: String, trim: true, required: true },
              ar: { type: String, trim: true },
            },
            { _id: false }
          ),
        ],
        default: [],
      },
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc, ret) {
        if (ret.signatory) {
          // eslint-disable-next-line no-param-reassign
          ret.signatory = { ...ret.signatory, hasSignature: Boolean(ret.signatory.signaturePath) };
          // eslint-disable-next-line no-param-reassign
          delete ret.signatory.signaturePath;
        }
      },
    },
  }
);

agreementSettingSchema.plugin(toJSON);

const AgreementSetting = mongoose.model('AgreementSetting', agreementSettingSchema);

module.exports = AgreementSetting;
