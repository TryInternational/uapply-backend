const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const { emailService } = require('../services');
const fs = require('fs');
const path = require('path');

/**
 * Send email with template
 */
const sendEmailTemplate = catchAsync(async (req, res) => {
  const { to, subject, templateName, context, text } = req.body;
  
  // Validate required fields
  if (!to || !subject || !templateName) {
    return res.status(httpStatus.BAD_REQUEST).send({
      message: 'Missing required fields: to, subject, templateName'
    });
  }

  try {
    await emailService.sendEmail(to, subject, text || '', context || {}, templateName);
    res.status(httpStatus.OK).send({
      message: 'Email sent successfully'
    });
  } catch (error) {
    res.status(httpStatus.INTERNAL_SERVER_ERROR).send({
      message: 'Failed to send email',
      error: error.message
    });
  }
});

/**
 * Send email with HTML string
 */
const sendEmailWithHTML = catchAsync(async (req, res) => {
  const { to, subject, htmlContent, context, text } = req.body;
  
  // Validate required fields
  if (!to || !subject || !htmlContent) {
    return res.status(httpStatus.BAD_REQUEST).send({
      message: 'Missing required fields: to, subject, htmlContent'
    });
  }

  try {
    await emailService.sendEmail(to, subject, text || '', context || {}, null, htmlContent);
    res.status(httpStatus.OK).send({
      message: 'Email sent successfully'
    });
  } catch (error) {
    res.status(httpStatus.INTERNAL_SERVER_ERROR).send({
      message: 'Failed to send email',
      error: error.message
    });
  }
});

/**
 * Get available email templates
 */
const getAvailableTemplates = catchAsync(async (req, res) => {
  try {
    const templatesDir = path.join(__dirname, '../templates');
    const files = fs.readdirSync(templatesDir);
    
    const templates = files
      .filter(file => file.endsWith('.hbs') || file.endsWith('.html'))
      .map(file => ({
        name: file.replace(/\.(hbs|html)$/, ''),
        filename: file,
        type: file.endsWith('.hbs') ? 'handlebars' : 'html'
      }));

    res.status(httpStatus.OK).send({
      templates
    });
  } catch (error) {
    res.status(httpStatus.INTERNAL_SERVER_ERROR).send({
      message: 'Failed to get templates',
      error: error.message
    });
  }
});

/**
 * Send IELTS event reminder email
 */
const sendIeltsReminder = catchAsync(async (req, res) => {
  const { to, eventDetails } = req.body;
  
  if (!to || !eventDetails) {
    return res.status(httpStatus.BAD_REQUEST).send({
      message: 'Missing required fields: to, eventDetails'
    });
  }

  try {
    const subject = 'تذكير بورشة الآيلتس اليوم';
    const text = 'تذكير بورشة الآيلتس اليوم';
    
    // Read the HTML template from the frontend project
    const templatePath = path.join(__dirname, '../../../uapply/email-templates/ielts-event-reminder.html');
    let htmlContent = '';
    
    try {
      htmlContent = fs.readFileSync(templatePath, 'utf8');
    } catch (fileError) {
      // Fallback to a simple HTML template if file not found
      htmlContent = `
        <!DOCTYPE html>
        <html lang="ar" dir="rtl">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>تذكير بورشة الآيلتس اليوم</title>
        </head>
        <body style="font-family: Arial, sans-serif; direction: rtl;">
            <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
                <h1>تذكير بورشة الآيلتس</h1>
                <p>مرحباً {{name}},</p>
                <p>نذكرك بورشة الآيلتس المجدولة اليوم في {{time}}.</p>
                <p>تفاصيل الورشة:</p>
                <ul>
                    <li>التاريخ: {{date}}</li>
                    <li>الوقت: {{time}}</li>
                    <li>المكان: {{location}}</li>
                </ul>
                <p>نتطلع لرؤيتك!</p>
            </div>
        </body>
        </html>
      `;
    }

    await emailService.sendEmail(to, subject, text, eventDetails, null, htmlContent);
    res.status(httpStatus.OK).send({
      message: 'IELTS reminder email sent successfully'
    });
  } catch (error) {
    res.status(httpStatus.INTERNAL_SERVER_ERROR).send({
      message: 'Failed to send IELTS reminder email',
      error: error.message
    });
  }
});

module.exports = {
  sendEmailTemplate,
  sendEmailWithHTML,
  getAvailableTemplates,
  sendIeltsReminder,
};
