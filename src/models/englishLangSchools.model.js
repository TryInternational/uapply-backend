const mongoose = require('mongoose');
const { toJSON, paginate } = require('./plugins');

const englishLangSchoolsSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    logo_url: {
      type: String,
      required: true,
      trim: true,
    },
  },

  {
    timestamps: true,
  }
);

englishLangSchoolsSchema.plugin(toJSON);
englishLangSchoolsSchema.plugin(paginate);

const EnglishLangSchool = mongoose.model('EnglishLangSchool', englishLangSchoolsSchema);

module.exports = EnglishLangSchool;
