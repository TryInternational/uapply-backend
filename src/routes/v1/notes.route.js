const express = require('express');
const notesController = require('../../controllers/notes.controller');

const { softAuth, scopeSubAgentToOwnStudent } = require('../../middlewares/subAgentScope');

const router = express.Router();

// A sub-agent may reach these only for a student it owns; see
// scopeSubAgentToOwnStudent. softAuth only identifies the caller, so behaviour
// for every other role is unchanged.
router.use(softAuth, scopeSubAgentToOwnStudent);

router.route('/').post(notesController.createNote).get(notesController.getNotes);

router.route('/:noteId').patch(notesController.updateNote).delete(notesController.deleteNote);

module.exports = router;
