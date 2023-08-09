const allRoles = {
  user: ['getUsers', 'manageUsers'],
  admin: ['getUsers', 'manageUsers'],
  counselor: ['getUsers', 'manageUsers'],
};

const roles = Object.keys(allRoles);
const roleRights = new Map(Object.entries(allRoles));

module.exports = {
  roles,
  roleRights,
};
