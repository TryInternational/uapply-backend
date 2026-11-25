const mongoose = require('mongoose');
const { Roles } = require('../../src/models');
const roleAccess = require('../../src/services/roleAccess.service');

// A user's role is a reference to a role document, and what a role may do
// comes from that document's roleRights.
// The admin role is made first so that its id sorts before the user role's,
// as the name "admin" used to sort before "user". The sort tests in
// tests/integration/user.test.js rely on that order.
const adminRole = {
  _id: mongoose.Types.ObjectId(),
  name: 'Admin',
  roleRights: [roleAccess.ADMIN_RIGHT],
};

const userRole = {
  _id: mongoose.Types.ObjectId(),
  name: 'Counsellor',
  roleRights: [],
};

/**
 * Puts the roles in the database. Safe to call more than once in a test.
 *
 * roleAccess keeps the roles it has read for five minutes, and every test
 * starts from an empty database, so the service is told to read them again.
 * Without that, an admin made in a test would not count as one.
 */
const insertRoles = async (roles = [userRole, adminRole]) => {
  await Roles.bulkWrite(
    roles.map((role) => ({
      updateOne: {
        filter: { _id: role._id },
        update: { $set: { name: role.name, roleRights: role.roleRights } },
        upsert: true,
      },
    }))
  );
  await roleAccess.refresh();
};

module.exports = {
  userRole,
  adminRole,
  insertRoles,
};
