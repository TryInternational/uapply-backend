const jwt = require('jsonwebtoken');
const { EventUser } = require('../models');
const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/ApiError');

class EventAuthController {
  // POST /api/event-auth/login
  login = catchAsync(async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
      throw new ApiError(400, 'Please provide email and password');
    }

    const user = await EventUser.findOne({ email }).select('+password');

    if (!user || !(await user.comparePassword(password))) {
      throw new ApiError(401, 'Invalid email or password');
    }

    if (!user.isActive) {
      throw new ApiError(401, 'Account is deactivated');
    }

    const token = this.generateToken(user._id);

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          permissions: user.permissions
        }
      }
    });
  });

  // POST /api/event-auth/register (Admin only)
  register = catchAsync(async (req, res) => {
    const { name, email, password, role, permissions } = req.body;

    const existingUser = await EventUser.findOne({ email });
    if (existingUser) {
      throw new ApiError(400, 'User already exists with this email');
    }

    const user = await EventUser.create({
      name,
      email,
      password,
      role,
      permissions
    });

    const token = this.generateToken(user._id);

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: {
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          permissions: user.permissions
        }
      }
    });
  });

  // POST /api/event-auth/change-password
  changePassword = catchAsync(async (req, res) => {
    const { currentPassword, newPassword } = req.body;

    const user = await EventUser.findById(req.user.id).select('+password');

    if (!(await user.comparePassword(currentPassword))) {
      throw new ApiError(400, 'Current password is incorrect');
    }

    user.password = newPassword;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Password changed successfully'
    });
  });

  // GET /api/event-auth/me
  getProfile = catchAsync(async (req, res) => {
    const user = await EventUser.findById(req.user.id);

    res.status(200).json({
      success: true,
      data: { user }
    });
  });

  // GET /api/event-auth/users (Admin only)
  getUsers = catchAsync(async (req, res) => {
    const { page = 1, limit = 10, role, isActive } = req.query;

    const query = {};
    if (role) query.role = role;
    if (isActive !== undefined) query.isActive = isActive === 'true';

    const skip = (page - 1) * limit;

    const users = await EventUser.find(query)
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await EventUser.countDocuments(query);

    res.status(200).json({
      success: true,
      data: {
        users,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  });

  // PUT /api/event-auth/users/:id (Admin only)
  updateUser = catchAsync(async (req, res) => {
    const { name, email, role, permissions, isActive } = req.body;
    const userId = req.params.id;

    // Check if email is already taken by another user
    if (email) {
      const existingUser = await EventUser.findOne({ 
        email, 
        _id: { $ne: userId } 
      });
      if (existingUser) {
        throw new ApiError(400, 'Email already taken by another user');
      }
    }

    const updateData = {};
    if (name) updateData.name = name;
    if (email) updateData.email = email;
    if (role) updateData.role = role;
    if (permissions) updateData.permissions = permissions;
    if (isActive !== undefined) updateData.isActive = isActive;

    const user = await EventUser.findByIdAndUpdate(
      userId,
      updateData,
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
      throw new ApiError(404, 'User not found');
    }

    res.status(200).json({
      success: true,
      message: 'User updated successfully',
      data: { user }
    });
  });

  // DELETE /api/event-auth/users/:id (Admin only)
  deleteUser = catchAsync(async (req, res) => {
    const user = await EventUser.findById(req.params.id);

    if (!user) {
      throw new ApiError(404, 'User not found');
    }

    // Prevent admin from deleting themselves
    if (user._id.toString() === req.user.id.toString()) {
      throw new ApiError(400, 'Cannot delete your own account');
    }

    await EventUser.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: 'User deleted successfully'
    });
  });

  // Helper method to generate JWT token
  generateToken(userId) {
    return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d'
    });
  }
}

module.exports = new EventAuthController();
