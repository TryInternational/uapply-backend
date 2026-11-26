const mongoose = require('mongoose');
const setupTestDB = require('../../../utils/setupTestDB');
const { paginate } = require('../../../../src/models/plugins');

const projectSchema = mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
});

projectSchema.virtual('tasks', {
  ref: 'Task',
  localField: '_id',
  foreignField: 'project',
});

projectSchema.plugin(paginate);
const Project = mongoose.model('Project', projectSchema);

const taskSchema = mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  project: {
    type: mongoose.SchemaTypes.ObjectId,
    ref: 'Project',
    required: true,
  },
});

taskSchema.plugin(paginate);
const Task = mongoose.model('Task', taskSchema);

setupTestDB();

describe('paginate plugin', () => {
  describe('sortBy option', () => {
    const names = (pages) => pages.results.map((task) => task.name);
    let project;

    beforeEach(async () => {
      project = await Project.create({ name: 'Project One' });
      const other = await Project.create({ name: 'Project Two' });
      await Task.create([
        { name: 'b', project: other._id },
        { name: 'c', project: project._id },
        { name: 'a', project: project._id },
      ]);
    });

    test('should sort by one field, in the direction asked for', async () => {
      expect(names(await Task.paginate({}, { sortBy: 'name:asc' }))).toEqual(['a', 'b', 'c']);
      expect(names(await Task.paginate({}, { sortBy: 'name:desc' }))).toEqual(['c', 'b', 'a']);
      expect(names(await Task.paginate({}, { sortBy: 'name' }))).toEqual(['a', 'b', 'c']);
    });

    test('should sort by several fields, each in its own direction', async () => {
      const byProjectThenName = await Task.paginate({}, { sortBy: 'project:asc,name:desc' });
      const byProjectDescThenName = await Task.paginate({}, { sortBy: 'project:desc,name:asc' });

      expect(names(byProjectThenName)).toEqual(['c', 'a', 'b']);
      expect(names(byProjectDescThenName)).toEqual(['b', 'a', 'c']);
    });
  });

  // The template this API began from could pull in the records a list refers
  // to when asked with `populate`. Here that option is passed straight from
  // the caller on nearly every list route, so it is deliberately not honoured
  // (see src/models/plugins.js). It used to make the request fail.
  describe('populate option', () => {
    test('should be ignored: the documents come back as they are stored', async () => {
      const project = await Project.create({ name: 'Project One' });
      const task = await Task.create({ name: 'Task One', project: project._id });

      const taskPages = await Task.paginate({ _id: task._id }, { populate: 'project' });

      expect(taskPages.totalResults).toBe(1);
      expect(taskPages.results[0].project).toEqual(project._id);
      expect(taskPages.results[0].project).not.toHaveProperty('name');
    });

    test('should be ignored for a path that does not exist as well', async () => {
      const project = await Project.create({ name: 'Project One' });

      const projectPages = await Project.paginate({ _id: project._id }, { populate: 'tasks.project,nothing:name' });

      expect(projectPages.results).toHaveLength(1);
      expect(projectPages.results[0].name).toBe('Project One');
    });
  });
});
