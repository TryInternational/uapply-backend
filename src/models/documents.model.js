const mongoose = require('mongoose');
const { toJSON, paginate } = require('./plugins');

const documentsSchema = mongoose.Schema(
  {
    subType: {
      type: String,
    },
    documentType: {
      type: String,
      required: true,
    },
    docState: {
      type: String,
      enum: ['Upload', 'Not Upoaded'],
      default: 'Not Upoaded',
    },
    studentId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Students',
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

/**
 * Check if password matches the user's password
 * @returns {Promise<boolean>}
 */

/**
 * @typedef Documents
 */
const Documents = mongoose.model('Documents', documentsSchema);

module.exports = Documents;
