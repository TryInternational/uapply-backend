const httpStatus = require('http-status');
const { Note } = require('../models');
const ApiError = require('../utils/ApiError');

const createNote = async (body) => Note.create(body);

const getNoteById = async (id) => Note.findById(id);

// Per-student notes: pinned first, then newest first. Paginated.
const getNotesByStudentId = async (studentId, { limit, page } = {}) => {
  const perPage = limit && parseInt(limit, 10) > 0 ? parseInt(limit, 10) : 20;
  const currentPage = page && parseInt(page, 10) > 0 ? parseInt(page, 10) : 1;
  const skip = (currentPage - 1) * perPage;

  const filter = { student: studentId };
  const [totalResults, results] = await Promise.all([
    Note.countDocuments(filter),
    Note.find(filter).sort({ pinned: -1, createdAt: -1 }).skip(skip).limit(perPage),
  ]);

  return {
    results,
    page: currentPage,
    limit: perPage,
    totalPages: Math.ceil(totalResults / perPage),
    totalResults,
  };
};

const updateNoteById = async (id, body) => {
  const note = await getNoteById(id);
  if (!note) throw new ApiError(httpStatus.NOT_FOUND, 'Note not found');
  // Only the mutable fields — author/student are fixed at creation.
  if (body.body !== undefined) note.body = body.body;
  if (body.pinned !== undefined) note.pinned = body.pinned;
  await note.save();
  return note;
};

const deleteNoteById = async (id) => {
  const note = await getNoteById(id);
  if (!note) throw new ApiError(httpStatus.NOT_FOUND, 'Note not found');
  await note.remove();
  return note;
};

module.exports = {
  createNote,
  getNoteById,
  getNotesByStudentId,
  updateNoteById,
  deleteNoteById,
};
