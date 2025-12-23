const { GoogleSpreadsheet } = require('google-spreadsheet');
const logger = require('../config/logger');

class GoogleSheetsService {
  constructor() {
    this.sheetId = '1qpeDLLVH4izD0PbpEWLtTdJ5DtCgVke4YGfh3QA27DM';
    this.doc = new GoogleSpreadsheet(this.sheetId);
  }

  async initialize() {
    try {
      // Use service account credentials if available
      if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
        await this.doc.useServiceAccountAuth({
          client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
          private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        });
      } else {
        // Fallback to API key if service account is not configured
        if (process.env.GOOGLE_API_KEY) {
          this.doc.useApiKey(process.env.GOOGLE_API_KEY);
        } else {
          throw new Error('Google Sheets credentials not configured');
        }
      }

      await this.doc.loadInfo();
      logger.info('Google Sheets service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Google Sheets service:', error);
      throw error;
    }
  }

  async addIeltsRegistration(registrationData) {
    try {
      await this.initialize();
      
      // Get the first sheet (or create if doesn't exist)
      let sheet = this.doc.sheetsByIndex[0];
      if (!sheet) {
        sheet = await this.doc.addSheet({ 
          title: 'IELTS Registrations',
          headerValues: this.getHeaderRow()
        });
      }

      // Ensure headers are set
      await sheet.loadHeaderRow();
      if (!sheet.headerValues || sheet.headerValues.length === 0) {
        await sheet.setHeaderRow(this.getHeaderRow());
      }

      // Prepare row data
      const rowData = this.formatRegistrationData(registrationData);

      // Add the row
      const addedRow = await sheet.addRow(rowData);
      
      logger.info(`IELTS registration added to Google Sheets: ${registrationData.email}`);
      return addedRow;
    } catch (error) {
      logger.error('Failed to add IELTS registration to Google Sheets:', error);
      throw error;
    }
  }

  getHeaderRow() {
    return [
      'Timestamp',
      'Confirmation Code',
      'Name',
      'Email',
      'Phone Number',
      'Study Destination',
      'Previous IELTS',
      'English Level',
      'Age',
      'Nationality',
      'Field of Study',
      'Grade',
      'Scholarship',
      'Guests Count',
      'Guest Details',
      'Status'
    ];
  }

  formatRegistrationData(data) {
    // Format guests information
    let guestDetails = '';
    let guestCount = 0;
    
    if (data.guests && data.guests.length > 0) {
      guestCount = data.guests.length;
      guestDetails = data.guests.map(guest => 
        `${guest.name} (${guest.email}, ${guest.phone})`
      ).join('; ');
    }

    // Map enum values to Arabic/readable format
    const studyDestinationMap = {
      'britain': '🇬🇧 بريطانيا',
      'other': '🌎 غيرها'
    };

    const previousIeltsMap = {
      'yes': 'نعم',
      'no': 'لا'
    };

    const englishLevelMap = {
      'weak': 'ضعيف',
      'intermediate': 'متوسط',
      'excellent': 'ممتاز'
    };

    return {
      'Timestamp': new Date().toLocaleString('en-US', { timeZone: 'Asia/Riyadh' }),
      'Confirmation Code': data.confirmationCode,
      'Name': data.name,
      'Email': data.email,
      'Phone Number': data.phoneNumber,
      'Study Destination': studyDestinationMap[data.studyDestination] || data.studyDestination,
      'Previous IELTS': previousIeltsMap[data.previousIELTS] || data.previousIELTS,
      'English Level': englishLevelMap[data.englishLevel] || data.englishLevel,
      'Age': data.age,
      'Nationality': data.nationality,
      'Field of Study': data.fieldOfStudy,
      'Grade': data.grade,
      'Scholarship': data.scholarship,
      'Guests Count': guestCount,
      'Guest Details': guestDetails,
      'Status': data.status
    };
  }

  async updateRegistrationStatus(confirmationCode, newStatus) {
    try {
      await this.initialize();
      const sheet = this.doc.sheetsByIndex[0];
      
      if (!sheet) {
        throw new Error('Sheet not found');
      }

      await sheet.loadHeaderRow();
      const rows = await sheet.getRows();
      
      const targetRow = rows.find(row => row['Confirmation Code'] === confirmationCode);
      
      if (targetRow) {
        targetRow['Status'] = newStatus;
        await targetRow.save();
        logger.info(`Updated IELTS registration status in Google Sheets: ${confirmationCode} -> ${newStatus}`);
        return true;
      }
      
      return false;
    } catch (error) {
      logger.error('Failed to update registration status in Google Sheets:', error);
      throw error;
    }
  }
}

module.exports = new GoogleSheetsService();
