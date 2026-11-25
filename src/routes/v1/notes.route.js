const express = require('express');
const notesController = require('../../controllers/notes.controller');

const { softAuth, scopeSubAgentToOwnStudent, resolveRecordStudent } = require('../../middlewares/subAgentScope');

const router = express.Router();

// A partner may reach these only for a student it owns; see
// scopeSubAgentToOwnStudent. For a request about one note by its id, the
// student that is checked is the one the note belongs to, not one the
// request names; see resolveRecordStudent. softAuth only identifies the
// caller, so behaviour for every other role is unchanged.
router.use(softAuth, resolveRecordStudent('Note', 'student'), scopeSubAgentToOwnStudent);

router.route('/').post(notesController.createNote).get(notesController.getNotes);

router.route('/:noteId').patch(notesController.updateNote).delete(notesController.deleteNote);

module.exports = router;
