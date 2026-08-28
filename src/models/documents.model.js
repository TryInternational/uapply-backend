const mongoose = require('mongoose');
const { toJSON, paginate } = require('./plugins');

const documentsSchema = mongoose.Schema(
  {
    subType: {
      type: String,
    },
    // Stable machine key for the document kind ('passport', 'transcript', ...).
    // documentType/subType hold the human label, which is what gets displayed
    // and therefore what changes when copy changes; without this key the
    // back-office could not tell a Passport row from a Transcript row after a
    // round-trip, because strict mode was dropping the field on write.
    docTypeKey: {
      type: String,
    },
    documentType: {
      type: String,
      required: true,
    },
    // Document lifecycle.
    //
    // 'Upload' / 'Not Uploaded' are the original two states and are kept so
    // existing rows keep validating. The back-office document panel models the
    // fuller lifecycle the POC specifies — a document can be asked for before
    // it exists, and once it arrives staff mark it checked or send it back —
    // so those four are accepted too. Writing any of them previously failed
    // enum validation and surfaced as a 500 on POST /v1/documents.
    docState: {
      type: String,
      enum: ['Upload', 'Not Uploaded', 'Requested', 'Received', 'Verified', 'Rejected'],
      default: 'Not Uploaded',
    },
    studentId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Students',
      autopopulate: true,
    },
    applicationId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Application',
      autopopulate: true,
    },
    tag: {
      type: Object,
    },
    blobInfo: {
      type: Array,
    },
  },
  {
    timestamps: true,
  }
);

// add plugin that converts mongoose to json
documentsSchema.plugin(toJSON);
documentsSchema.plugin(paginate);

// Performance index — documents are fetched per student on every profile open.
documentsSchema.index({ studentId: 1 });

/**
 * Check if password matches the user's password
 * @returns {Promise<boolean>}
 */

/**
 * @typedef Documents
 */
const Documents = mongoose.model('Documents', documentsSchema);

module.exports = Documents;
