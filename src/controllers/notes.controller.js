const httpStatus = require('http-status');
const pick = require('../utils/pick');
const catchAsync = require('../utils/catchAsync');
const { notesService, activitiesService } = require('../services');
const { isSubAgent } = require('../middlewares/subAgentScope');

const createNote = catchAsync(async (req, res) => {
  // Same reasoning as createActivity: the ownership gate says WHICH student a
  // sub-agent may write against, not WHO the note may claim to be from.
  if (isSubAgent(req.user)) {
    req.body = {
      student: req.body.student || req.body.studentId,
      // The note content field is `body`, not `text` (see note.model.js).
      body: req.body.body,
      pinned: req.body.pinned,
      authorId: req.user.id,
      authorName: req.user.name,
    };
  }

  const note = await notesService.createNote(req.body);

  // Adding a note also writes an activity event (non-fatal).
  await activitiesService.logActivity({
    student: note.student,
    type: 'note',
    text: `${note.authorName || 'Someone'} added a note`,
    actorId: note.authorId,
    actorName: note.authorName,
    meta: { noteId: note.id },
  });

  res.status(httpStatus.CREATED).send(note);
});

// GET /notes?studentId=&limit=&page=  — pinned first, then newest first.
const getNotes = catchAsync(async (req, res) => {
  const { studentId, limit, page } = pick(req.query, ['studentId', 'limit', 'page']);
  const notes = await notesService.getNotesByStudentId(studentId, { limit, page });
  res.send(notes);
});

const updateNote = catchAsync(async (req, res) => {
  const note = await notesService.updateNoteById(req.params.noteId, req.body);
  res.send(note);
});

const deleteNote = catchAsync(async (req, res) => {
  await notesService.deleteNoteById(req.params.noteId);
  res.status(httpStatus.NO_CONTENT).send();
});

module.exports = {
  createNote,
  getNotes,
  updateNote,
  deleteNote,
};
