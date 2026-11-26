/* eslint-disable no-param-reassign */

/**
 * A mongoose schema plugin which applies the following in the toJSON transform call:
 *  - removes __v, createdAt, updatedAt, and any path that has private: true
 *  - replaces _id with id
 */

const slug = require('mongoose-slug-generator');
const populate = require('mongoose-autopopulate');
const trackable = require('mongoose-trackable');

// Remove what is at `path` ("a" or "a.b.c") from `obj`. A private field inside
// a nested object used to be left in: only top-level names were deleted.
const deleteAtPath = (obj, path, index) => {
  if (!obj || typeof obj !== 'object') return;
  if (index === path.length - 1) {
    delete obj[path[index]];
    return;
  }
  deleteAtPath(obj[path[index]], path, index + 1);
};

const toJSON = (schema) => {
  let transform;
  if (schema.options.toJSON && schema.options.toJSON.transform) {
    transform = schema.options.toJSON.transform;
  }

  schema.options.toJSON = Object.assign(schema.options.toJSON || {}, {
    transform(doc, ret, options) {
      Object.keys(schema.paths).forEach((path) => {
        if (schema.paths[path].options && schema.paths[path].options.private) {
          deleteAtPath(ret, path.split('.'), 0);
        }
      });

      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      delete ret.createdAt;
      delete ret.updatedAt;
      if (transform) {
        return transform(doc, ret, options);
      }
    },
  });
};

const paginate = (schema) => {
  /**
   * @typedef {Object} QueryResult
   * @property {Document[]} results - Results found
   * @property {number} page - Current page
   * @property {number} limit - Maximum number of results per page
   * @property {number} totalPages - Total number of pages
   * @property {number} totalResults - Total number of documents
   */
  /**
   * Query for documents with pagination
   * @param {Object} [filter] - Mongo filter
   * @param {Object} [options] - Query options
   * @param {string} [options.sortBy] - Sort option in the format: sortField:(desc|asc). Several can be given, separated by commas
   * @param {number} [options.limit] - Maximum number of results per page (default = 10)
   * @param {number} [options.page] - Current page (default = 1)
   * @returns {Promise<QueryResult>}
   */
  schema.statics.paginate = async function (filter, options) {
    // "name:asc" or "role:desc,name:asc". Only the first of several was read,
    // and its direction was read wrongly when a second followed it.
    const sort = {};
    if (options.sortBy) {
      String(options.sortBy)
        .split(',')
        .forEach((criterion) => {
          const [field, direction] = criterion.split(':');
          if (field) sort[field.trim()] = direction === 'desc' ? -1 : 1;
        });
    }

    // A `populate` option is not honoured. Nearly every list route passes the
    // caller's ?populate= straight in, and the code that read it took the
    // first two LETTERS of the path as a path and a field list, so any request
    // that sent one was answered 500. Nothing in the back end or the CRM uses
    // it. Making it work would let a caller pull in the records a list refers
    // to (a lead's student, a document's application) on routes that were
    // never meant to hand those out, so it is ignored instead.

    const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
    const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
    const skip = (page - 1) * limit;
    if (options.webUrl) {
      filter = {
        ...filter,
        webUrl: { $regex: options.webUrl },
      };
    }
    const countPromise = this.countDocuments(filter).exec();
    const docsPromise = this.find(filter).sort(sort).skip(skip).limit(limit).exec();

    return Promise.all([countPromise, docsPromise]).then((values) => {
      const [totalResults, results] = values;

      const totalPages = Math.ceil(totalResults / limit);

      const result = {
        results,
        page,
        limit,
        totalPages,
        totalResults,
      };
      return Promise.resolve(result);
    });
  };
};

module.exports = {
  toJSON,
  paginate,
  slug,
  populate,
  trackable,
};
