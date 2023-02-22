const httpStatus = require('http-status');
const { pick } = require('lodash');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { documentsService } = require('../services');

const createDocument = catchAsync(async (req, res) => {
  const document = await documentsService.createDocumetns(req.body);
  res.status(httpStatus.CREATED).send(document);
});

const getDocuments = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['name', 'slug']);
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate']);
  const result = await documentsService.queryDocumetns(filter, options);
  res.send(result);
});

const getDocument = catchAsync(async (req, res) => {
  const document = await documentsService.getDocumetnsById(req.params.documentId);
  if (!document) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Document not found');
  }
  res.send(document);
});
const getDocumentByStudentId = catchAsync(async (req, res) => {
  const document = await documentsService.getDocumetnByStudentId(req.params.studentId);
  if (!document) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Document not found');
  }
  res.send(document);
});

const updateDocument = catchAsync(async (req, res) => {
  const document = await documentsService.updateDocumetnsById(req.params.documentId, req.body);
  res.send(document);
});

const deleteDocument = catchAsync(async (req, res) => {
  await documentsService.deleteDocumetnById(req.params.documentId);
  res.status(httpStatus.NO_CONTENT).send();
});

module.exports = {
  createDocument,
  getDocuments,
  getDocument,
  updateDocument,
  deleteDocument,
  getDocumentByStudentId,
};
