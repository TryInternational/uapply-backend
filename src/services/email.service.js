const Handlebars = require('handlebars');
const fs = require('fs');
const path = require('path');
const config = require('../config/config');
const logger = require('../config/logger');
const { Resend } = require('resend');

// Initialize Resend
const resend = new Resend(config.email.resendApiKey || process.env.RESEND_API_KEY);

/**
 * Send an email
 * @param {string} to
 * @param {string} subject
 * @param {string} text
 * @returns {Promise}
 */
const sendEmail = async (to, subject, text, context, file, htmlString) => {
  try {
    const source = htmlString || fs.readFileSync(path.join(__dirname, `../templates/${file}.hbs`), 'utf8');
    const template = Handlebars.compile(source);
    const html = template(context);

    const { data, error } = await resend.emails.send({
      from: "noreply@ulearnabroad.com",
      to,
      subject,
      text,
      html,
    });

    if (error) {
      logger.error('Error sending email:', error);
      throw error;
    }

    logger.info('Email sent successfully:', data?.id);
    return data;
  } catch (error) {
    logger.error('Failed to send email:', error);
    throw error;
  }
};

/**
 * Send reset password email
 * @param {string} to
 * @param {string} token
 * @returns {Promise}
 */
const sendResetPasswordEmail = async (to, token, baseUrl) => {
  const subject = 'Reset password';
  // Was hardcoded to the back-office host, which is the wrong one for a
  // sub-agent -- and the invite email tells them to use this flow when their
  // link expires. `baseUrl` lets the caller pass the portal they belong to.
  const resetPasswordUrl = `${baseUrl || config.appUrls.backoffice}/reset-password?token=${token}`;

  const text = `Dear user,
To reset your password, click on this link: ${resetPasswordUrl}
If you did not request any password resets, then ignore this email.`;
  
  await sendEmail(to, subject, text, { resetPasswordUrl }, 'reset_password');
};

/**
 * Send verification email
 * @param {string} to
 * @param {string} token
 * @returns {Promise}
 */
const sendVerificationEmail = async (to, token) => {
  const subject = 'Email Verification';
  const verificationEmailUrl = `http://link-to-app/verify-email?token=${token}`;
  
  const text = `Dear user,
To verify your email, click on this link: ${verificationEmailUrl}
If you did not create an account, then ignore this email.`;
  
  await sendEmail(to, subject, text, { verificationEmailUrl }, 'verification_email');
};

/**
 * Send receipt email
 * @param {string} to
 * @param {object} context
 * @returns {Promise}
 */
const sendReceipt = async (to, context) => {
  const subject = 'ملخص الشراء';
  const text = `شكراً على ثقتك
  سعيدين بانضمامك لدورة اللغة`;
  
  await sendEmail(to, subject, text, context, 'receipt');
};

/**
 * Send IELTS event reminder email
 * @param {string} to
 * @param {object} eventDetails
 * @returns {Promise}
 */
const sendIeltsEventReminder = async (to, eventDetails) => {
  const subject = 'تذكير بورشة الآيلتس اليوم';
  const text = `مرحباً ${eventDetails.name || ''},
نذكرك بورشة الآيلتس المجدولة اليوم في ${eventDetails.time || ''}.
التاريخ: ${eventDetails.date || ''}
الوقت: ${eventDetails.time || ''}
المكان: ${eventDetails.location || ''}
نتطلع لرؤيتك!`;

  // Try to read the HTML template from the frontend project first
  let htmlContent = '';
  try {
    const frontendTemplatePath = path.join(__dirname, '../../../uapply/email-templates/ielts-event-reminder.html');
    htmlContent = fs.readFileSync(frontendTemplatePath, 'utf8');
  } catch (error) {
    // Fallback to backend template if frontend template not found
    try {
      const backendTemplatePath = path.join(__dirname, '../templates/ielts-event-reminder.html');
      htmlContent = fs.readFileSync(backendTemplatePath, 'utf8');
    } catch (backendError) {
      // Use a simple fallback template
      htmlContent = `
        <!DOCTYPE html>
        <html lang="ar" dir="rtl">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>تذكير بورشة الآيلتس اليوم</title>
            <style>
                body { font-family: 'Cairo', Arial, sans-serif; direction: rtl; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>تذكير بورشة الآيلتس</h1>
                <p>مرحباً {{name}},</p>
                <p>نذكرك بورشة الآيلتس المجدولة اليوم في {{time}}.</p>
                <p><strong>تفاصيل الورشة:</strong></p>
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
  }

  await sendEmail(to, subject, text, eventDetails, null, htmlContent);
};

// Test email function (optional)
const testResendConnection = async () => {
  try {
    const { data } = await resend.emails.send({
      from: config.email.from,
      to: 'test@example.com',
      subject: 'Test Connection',
      html: '<p>Resend is working!</p>',
    });
    
    if (data?.id) {
      logger.info('Resend connection test successful');
      return true;
    }
  } catch (error) {
    logger.warn('Resend connection test failed:', error.message);
    return false;
  }
};

/* istanbul ignore next */
if (config.env !== 'test') {
  testResendConnection();
}


// ---------------------------------------------------------------------------
// Partner onboarding (school counsellor / sub-agent access requests)
// ---------------------------------------------------------------------------

// User-facing label for each requestable role. Kept here so the emails and the
// portal say the same thing.
const ACCESS_ROLE_LABEL = {
  subAgent: 'Sub Agent',
  schoolCounselor: 'School Counselor',
};

/**
 * Acknowledge a request. Sent to the applicant immediately, before any review.
 * Says explicitly that no account exists yet, so a person who did not make the
 * request is not left wondering.
 */
const sendAccessRequestReceivedEmail = async (request) => {
  const roleLabel = ACCESS_ROLE_LABEL[request.requestedRole] || 'portal';
  await sendEmail(
    request.email,
    'We have your access request',
    `Thanks, ${request.name}. Your request for ${roleLabel} access is with the Ulearn team. We'll email you a link to set your password as soon as it's approved.`,
    {
      name: request.name,
      email: request.email,
      roleLabel,
      organisation: request.organisation,
    },
    'access_request_received'
  );
};

/**
 * The invite. `setPasswordUrl` carries a one-time reset-password token, so the
 * account this email refers to cannot be signed into until the recipient
 * follows it -- no credential is ever transmitted.
 */
const sendAccessApprovedEmail = async (request, { setPasswordUrl, portalUrl, expiryHours }) => {
  const roleLabel = ACCESS_ROLE_LABEL[request.requestedRole] || 'portal';
  await sendEmail(
    request.email,
    'Your Ulearn portal is ready',
    `Good news, ${request.name} - your ${roleLabel} access has been approved. Set your password here: ${setPasswordUrl}`,
    {
      name: request.name,
      email: request.email,
      roleLabel,
      setPasswordUrl,
      portalUrl,
      expiryHours,
    },
    'access_approved'
  );
};

const sendAccessDeclinedEmail = async (request, reason) => {
  const roleLabel = ACCESS_ROLE_LABEL[request.requestedRole] || 'portal';
  await sendEmail(
    request.email,
    'About your access request',
    `Thanks for your interest, ${request.name}. We're not able to open a ${roleLabel} portal for ${request.organisation} at the moment.${reason ? ` ${reason}` : ''}`,
    {
      name: request.name,
      email: request.email,
      roleLabel,
      organisation: request.organisation,
      reason,
    },
    'access_declined'
  );
};

module.exports = {
  ACCESS_ROLE_LABEL,
  sendAccessRequestReceivedEmail,
  sendAccessApprovedEmail,
  sendAccessDeclinedEmail,
  resend,
  sendEmail,
  sendResetPasswordEmail,
  sendVerificationEmail,
  sendReceipt,
  sendIeltsEventReminder,
  testResendConnection,
};