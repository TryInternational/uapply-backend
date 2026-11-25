const mongoose = require('mongoose');
const setupTestDB = require('../utils/setupTestDB');
const roleAccess = require('../../src/services/roleAccess.service');
const { Roles } = require('../../src/models');
const { insertRoles, userRole, adminRole, subAgentRole, schoolCounselorRole } = require('../fixtures/role.fixture');
const { userOne, admin, subAgent, schoolCounselor, userWithNoRole } = require('../fixtures/user.fixture');

setupTestDB();

// What a role may do comes from the role document's roleRights, and which roles
// are the two kinds of outside partner comes from the settings. These tests pin
// both down for each kind of user the fixtures have.

describe('roleAccess', () => {
  beforeEach(async () => {
    await insertRoles();
  });

  describe('admin', () => {
    test('a role that carries the admin right makes its users admins', () => {
      expect(roleAccess.isAdmin(admin)).toBe(true);
    });

    test('an admin can do what a reviewer and a counsellor can', () => {
      expect(roleAccess.isReviewer(admin)).toBe(true);
      expect(roleAccess.canUseCounselorTools(admin)).toBe(true);
    });

    test.each([
      ['an ordinary member of staff', userOne],
      ['a sub-agent', subAgent],
      ['a school counsellor', schoolCounselor],
      ['a user with no role', userWithNoRole],
      ['nobody', undefined],
    ])('%s is not an admin', (name, user) => {
      expect(roleAccess.isAdmin(user)).toBe(false);
    });

    test('a role id that matches no role document gives no authority', () => {
      const stranger = { _id: mongoose.Types.ObjectId(), role: mongoose.Types.ObjectId() };
      expect(roleAccess.isAdmin(stranger)).toBe(false);
      expect(roleAccess.isReviewer(stranger)).toBe(false);
      expect(roleAccess.canUseCounselorTools(stranger)).toBe(false);
    });
  });

  describe('reviewer and counsellor tools', () => {
    test('each right is granted by the role that carries it, and by no other', async () => {
      const reviewerRole = { _id: mongoose.Types.ObjectId(), name: 'Reviewer', roleRights: [roleAccess.REVIEWER_RIGHT] };
      const toolsRole = { _id: mongoose.Types.ObjectId(), name: 'Tools', roleRights: [roleAccess.COUNSELOR_TOOLS_RIGHT] };
      await insertRoles([userRole, adminRole, reviewerRole, toolsRole]);
      const reviewer = { _id: mongoose.Types.ObjectId(), role: reviewerRole._id };
      const toolsUser = { _id: mongoose.Types.ObjectId(), role: toolsRole._id };

      expect(roleAccess.isReviewer(reviewer)).toBe(true);
      expect(roleAccess.isAdmin(reviewer)).toBe(false);
      expect(roleAccess.canUseCounselorTools(reviewer)).toBe(false);

      expect(roleAccess.canUseCounselorTools(toolsUser)).toBe(true);
      expect(roleAccess.isAdmin(toolsUser)).toBe(false);
      expect(roleAccess.isReviewer(toolsUser)).toBe(false);

      expect(roleAccess.isReviewer(userOne)).toBe(false);
      expect(roleAccess.canUseCounselorTools(userOne)).toBe(false);
    });
  });

  describe('outside partners', () => {
    test('a sub-agent is recognised by the role id in the settings', () => {
      expect(String(subAgentRole._id)).toBe(process.env.SUB_AGENT_ROLE_ID);
      expect(roleAccess.isSubAgent(subAgent)).toBe(true);
      expect(roleAccess.isSchoolCounselor(subAgent)).toBe(false);
    });

    test('a school counsellor is recognised by the role id in the settings', () => {
      expect(String(schoolCounselorRole._id)).toBe(process.env.SCHOOL_COUNSELOR_ROLE_ID);
      expect(roleAccess.isSchoolCounselor(schoolCounselor)).toBe(true);
      expect(roleAccess.isSubAgent(schoolCounselor)).toBe(false);
    });

    test('a partner is not staff, and has none of the staff rights', () => {
      [subAgent, schoolCounselor].forEach((partner) => {
        expect(roleAccess.isExternalPartner(partner)).toBe(true);
        expect(roleAccess.isStaff(partner)).toBe(false);
        expect(roleAccess.isAdmin(partner)).toBe(false);
        expect(roleAccess.isReviewer(partner)).toBe(false);
        expect(roleAccess.canUseCounselorTools(partner)).toBe(false);
      });
    });

    test('staff and admins are not partners', () => {
      [userOne, admin].forEach((user) => {
        expect(roleAccess.isExternalPartner(user)).toBe(false);
        expect(roleAccess.isStaff(user)).toBe(true);
      });
    });
  });

  describe('permissionsFor', () => {
    test('tells the client what each kind of user may do', () => {
      expect(roleAccess.permissionsFor(admin)).toMatchObject({
        isAdmin: true,
        isReviewer: true,
        isStaff: true,
        isSubAgent: false,
      });
      expect(roleAccess.permissionsFor(userOne)).toMatchObject({
        isAdmin: false,
        isReviewer: false,
        isStaff: true,
        isSubAgent: false,
      });
      expect(roleAccess.permissionsFor(subAgent)).toMatchObject({
        isAdmin: false,
        isStaff: false,
        isSubAgent: true,
        isSchoolCounselor: false,
      });
      expect(roleAccess.permissionsFor(schoolCounselor)).toMatchObject({
        isAdmin: false,
        isStaff: false,
        isSubAgent: false,
        isSchoolCounselor: true,
      });
    });

    test('a user with no role gets none of the rights a role grants, and is not staff', () => {
      expect(roleAccess.isStaff(userWithNoRole)).toBe(false);
      expect(roleAccess.permissionsFor(userWithNoRole)).toMatchObject({
        isStaff: false,
        isAdmin: false,
        isReviewer: false,
        canUseCounselorTools: false,
        isSubAgent: false,
        isSchoolCounselor: false,
      });
    });
  });

  describe('the role cache', () => {
    test('a change to a role is seen after the service reads the roles again', async () => {
      expect(roleAccess.isAdmin(userOne)).toBe(false);
      await Roles.updateOne({ _id: userRole._id }, { $set: { roleRights: [roleAccess.ADMIN_RIGHT] } });
      // Still the old answer: the service keeps what it read.
      expect(roleAccess.isAdmin(userOne)).toBe(false);
      await roleAccess.refresh();
      expect(roleAccess.isAdmin(userOne)).toBe(true);
    });
  });
});
