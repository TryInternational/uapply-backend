const { IeltsRegistration } = require('../models');
const googleSheetsService = require('./googleSheets.service');
const ApiError = require('../utils/ApiError');
const logger = require('../config/logger');

class IeltsRegistrationService {
  async createRegistration(registrationData) {
    try {
      // Check if email is already registered
      // const existingRegistration = await IeltsRegistration.isEmailRegistered(registrationData.email);
      // if (existingRegistration) {
      //   throw new ApiError(400, 'Email is already registered for IELTS');
      // }

      // Check if seats are available for the requested date/time
      if (registrationData.bookingDate && registrationData.registrationTime) {
        const availableSeats = await this.getAvailableSeats(registrationData.bookingDate, registrationData.registrationTime);
        if (availableSeats <= 0) {
          throw new ApiError(400, 'No seats available for the selected time slot');
        }
      }

      // Create the registration in MongoDB
      const registration = new IeltsRegistration(registrationData);
      await registration.save();

      logger.info(`IELTS registration created successfully: ${registration.email}`);
      return registration;
    } catch (error) {
      logger.error('Failed to create IELTS registration:', error);
      throw error;
    }
  }

  async getRegistrationByCode(confirmationCode) {
    const registration = await IeltsRegistration.findOne({ confirmationCode });
    if (!registration) {
      throw new ApiError(404, 'Registration not found');
    }
    return registration;
  }

  async getRegistrationByEmail(email) {
    const registration = await IeltsRegistration.findOne({
      email: email.toLowerCase(),
      status: { $ne: 'cancelled' },
    });
    if (!registration) {
      throw new ApiError(404, 'Registration not found');
    }
    return registration;
  }

  async getAllRegistrations(filters = {}, options = {}) {
    const query = {};

    // Apply filters
    if (filters.status) {
      query.status = filters.status;
    }

    if (filters.dateFrom || filters.dateTo) {
      query.registrationDate = {};
      if (filters.dateFrom) {
        query.registrationDate.$gte = new Date(filters.dateFrom);
      }
      if (filters.dateTo) {
        query.registrationDate.$lte = new Date(filters.dateTo);
      }
    }

    if (filters.syncStatus) {
      if (filters.syncStatus === 'synced') {
        query.syncedToSheets = true;
      } else if (filters.syncStatus === 'not_synced') {
        query.syncedToSheets = false;
      } else if (filters.syncStatus === 'error') {
        query.sheetsSyncError = { $exists: true, $ne: null };
      }
    }

    // Set default options
    const defaultOptions = {
      page: 1,
      limit: 50,
      sortBy: 'registrationDate',
      sortOrder: 'desc',
    };

    const queryOptions = { ...defaultOptions, ...options };
    const skip = (queryOptions.page - 1) * queryOptions.limit;
    const sort = { [queryOptions.sortBy]: queryOptions.sortOrder === 'desc' ? -1 : 1 };

    const registrations = await IeltsRegistration.find(query)
      .sort(sort)
      .skip(skip)
      .limit(parseInt(queryOptions.limit))
      .lean();

    const total = await IeltsRegistration.countDocuments(query);

    return {
      registrations,
      pagination: {
        page: parseInt(queryOptions.page),
        limit: parseInt(queryOptions.limit),
        total,
        pages: Math.ceil(total / queryOptions.limit),
      },
    };
  }

  async updateRegistrationStatus(id, status, notes = '') {
    const registration = await IeltsRegistration.findById(id);
    if (!registration) {
      throw new ApiError(404, 'Registration not found');
    }

    const oldStatus = registration.status;
    registration.status = status;

    if (notes) {
      registration.notes = notes;
    }

    await registration.save();

    // Update status in Google Sheets if it was previously synced
    if (registration.syncedToSheets) {
      try {
        await googleSheetsService.updateRegistrationStatus(registration.confirmationCode, status);
      } catch (error) {
        logger.error('Failed to update status in Google Sheets:', error);
        // Don't fail the operation, just log the error
      }
    }

    logger.info(`IELTS registration status updated: ${registration.email} (${oldStatus} -> ${status})`);
    return registration;
  }

  async retrySheetsSync(id) {
    const registration = await IeltsRegistration.findById(id);
    if (!registration) {
      throw new ApiError(404, 'Registration not found');
    }

    try {
      await googleSheetsService.addIeltsRegistration(registration.toObject());

      registration.syncedToSheets = true;
      registration.sheetsSyncDate = new Date();
      registration.sheetsSyncError = undefined;
      await registration.save();

      logger.info(`IELTS registration re-synced to Google Sheets: ${registration.email}`);
      return registration;
    } catch (error) {
      registration.sheetsSyncError = error.message;
      await registration.save();
      throw new ApiError(500, 'Failed to sync to Google Sheets: ' + error.message);
    }
  }

  async getAvailableSeats(date, time) {
    try {
      // Count existing registrations for the specific date and time
      const existingRegistrations = await IeltsRegistration.countDocuments({
        bookingDate: date,
        registrationTime: time,
        status: { $ne: 'cancelled' },
      });

      // Maximum seats is 100
      const maxSeats = 100;
      const availableSeats = Math.max(0, maxSeats - existingRegistrations);

      logger.info(`Available seats for ${date} ${time}: ${availableSeats}/${maxSeats}`);
      return availableSeats;
    } catch (error) {
      logger.error('Failed to get available seats:', error);
      throw error;
    }
  }

  async getRegistrationStats() {
    const stats = await IeltsRegistration.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          confirmed: { $sum: { $cond: [{ $eq: ['$status', 'confirmed'] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
          cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
          synced: { $sum: { $cond: ['$syncedToSheets', 1, 0] } },
          syncErrors: { $sum: { $cond: [{ $ne: ['$sheetsSyncError', null] }, 1, 0] } },
        },
      },
    ]);

    return (
      stats[0] || {
        total: 0,
        confirmed: 0,
        pending: 0,
        cancelled: 0,
        synced: 0,
        syncErrors: 0,
      }
    );
  }
}

module.exports = new IeltsRegistrationService();
