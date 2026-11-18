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
/**
 * The wordmark every template shows on its purple band. Email clients need a
 * hosted URL (data URIs are stripped by Gmail), so the PNG lives in the CRM's
 * public folder and is served from wherever the CRM is; EMAIL_LOGO_URL
 * overrides that for an environment whose CRM is not reachable from the
 * internet (local dev, say).
 */
const LOGO_FILE = path.join(__dirname, '../assets/email/ulearn-logo-white.png');
const LOGO_OBJECT = 'branding/ulearn-logo-white.png';
let logoUrlPromise;
/**
 * Resolved once per process. EMAIL_LOGO_URL wins; otherwise the PNG shipped
 * with the backend is published to the storage bucket (same bucket as partner
 * logos, same public URL shape) so the address works from every environment
 * — a local backend's CRM is on localhost, which no mail client can fetch.
 * If storage is unreachable the CRM copy is the fallback.
 */
const emailLogoUrl = () => {
  if (process.env.EMAIL_LOGO_URL) return Promise.resolve(process.env.EMAIL_LOGO_URL);
  if (!logoUrlPromise) {
    logoUrlPromise = (async () => {
      try {
        // eslint-disable-next-line global-require
        const storage = require('../thirdparty/firebase');
        return await storage.uploadBuffer(fs.readFileSync(LOGO_FILE), LOGO_OBJECT, 'image/png');
      } catch (err) {
        logger.warn(`email logo: could not publish to storage (${err.message}); using the CRM copy`);
        return `${config.appUrls.backoffice}/email/ulearn-logo-white.png`;
      }
    })();
  }
  return logoUrlPromise;
};

const sendEmail = async (to, subject, text, context, file, htmlString, options = {}) => {
  try {
    const source = htmlString || fs.readFileSync(path.join(__dirname, `../templates/${file}.hbs`), 'utf8');
    const template = Handlebars.compile(source);
    const html = template({ logoUrl: await emailLogoUrl(), ...(context || {}) });

    const payload = {
      from: "noreply@ulearnabroad.com",
      to,
      subject,
      text,
      html,
    };
    // Optional: cc / replyTo / attachments ([{ filename, content: Buffer }]).
    if (options.cc) payload.cc = options.cc;
    if (options.replyTo) payload.reply_to = options.replyTo;
    if (Array.isArray(options.attachments) && options.attachments.length) {
      payload.attachments = options.attachments.map((a) => ({
        filename: a.filename,
        content: Buffer.isBuffer(a.content) ? a.content.toString('base64') : a.content,
      }));
    }
    const { data, error } = await resend.emails.send(payload);

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
const sendResetPasswordEmail = async (to, token, baseUrl, portal) => {
  const subject = 'Choose a new Ulearn password';
  // Was hardcoded to the back-office host, which is the wrong one for a
  // sub-agent -- and the invite email tells them to use this flow when their
  // link expires. `baseUrl` lets the caller pass the portal they belong to;
  // `portal` tells the reset page which sign-in door to offer afterwards.
  const resetPasswordUrl = `${baseUrl || config.appUrls.backoffice}/reset-password?token=${token}${portal ? `&portal=${portal}` : ''}`;

  const expiresMinutes = config.jwt.resetPasswordExpirationMinutes;
  const text = `Someone asked to reset the password for the Ulearn account on ${to}.
Choose a new one here (the link works for ${expiresMinutes} minutes, once): ${resetPasswordUrl}
If you did not ask for this, ignore this email - your password stays as it is.`;
  
  await sendEmail(to, subject, text, { resetPasswordUrl, email: to, expiresMinutes }, 'reset_password');
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

// ---------------------------------------------------------------------------
// Sub-agent agreements
// ---------------------------------------------------------------------------

const fmtKw = (d) =>
  d ? new Date(d).toLocaleString('en-GB', { timeZone: 'Asia/Kuwait', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

/** The signing link, with the unsigned PDF attached for the partner's records. */
const sendAgreementSentEmail = async (agreement, { signUrl, expiresAt, pdf, resend: isResend }) => {
  // Returns the provider's answer ({ id }) so the agreement can keep it.
  return sendEmail(
    agreement.agent.email,
    `${isResend ? 'New link: ' : ''}Your Ulearn sub-agent agreement ${agreement.agreementNo} is ready to sign`,
    `Hello ${agreement.agent.nameEn} - your sub-agent agreement ${agreement.agreementNo} is ready. Review and sign it here: ${signUrl} (valid until ${fmtKw(expiresAt)}).`,
    {
      name: agreement.agent.nameEn,
      email: agreement.agent.email,
      agreementNo: agreement.agreementNo,
      signUrl,
      expiresAt: fmtKw(expiresAt),
      resend: Boolean(isResend),
    },
    'agreement_sent',
    null,
    {
      cc: agreement.agent.accountEmail && agreement.agent.accountEmail !== agreement.agent.email ? agreement.agent.accountEmail : undefined,
      attachments: pdf ? [{ filename: `${agreement.agreementNo}.pdf`, content: pdf }] : undefined,
    }
  );
};

const sendAgreementReminderEmail = async (agreement, { signUrl, expiresAt }) => {
  await sendEmail(
    agreement.agent.email,
    `Reminder: sign your Ulearn agreement ${agreement.agreementNo}`,
    `Hello ${agreement.agent.nameEn} - your sub-agent agreement ${agreement.agreementNo} is waiting for your signature: ${signUrl} (valid until ${fmtKw(expiresAt)}).`,
    {
      name: agreement.agent.nameEn,
      email: agreement.agent.email,
      agreementNo: agreement.agreementNo,
      signUrl,
      expiresAt: fmtKw(expiresAt),
    },
    'agreement_reminder'
  );
};

/**
 * Both signed: the partner gets the signed PDF (and is told the portal invite
 * follows); the Ulearn signatory / sender gets an internal copy for the file.
 */
const sendAgreementCompletedEmail = async (agreement, { pdf, inviteSent, settings }) => {
  const attachments = pdf ? [{ filename: `${agreement.agreementNo}-signed.pdf`, content: pdf }] : undefined;
  const base = {
    agreementNo: agreement.agreementNo,
    organisation: agreement.agent.organisationEn || agreement.agent.nameEn,
    agentName: agreement.agent.nameEn,
    agreementDate: agreement.agreementDate ? new Date(agreement.agreementDate).toLocaleDateString('en-GB', { timeZone: 'Asia/Kuwait' }) : '',
    agentSignedAt: fmtKw(agreement.agentSignedAt),
    companySignedAt: fmtKw(agreement.countersignedAt),
  };
  await sendEmail(
    agreement.agent.email,
    `Signed: Ulearn sub-agent agreement ${agreement.agreementNo}`,
    `Hello ${agreement.agent.nameEn} - agreement ${agreement.agreementNo} has been signed by both parties. The signed PDF is attached.${inviteSent ? ' Your portal invitation follows in a separate email.' : ''}`,
    { ...base, name: agreement.agent.nameEn, email: agreement.agent.email, accountEmail: agreement.agent.accountEmail || agreement.agent.email, inviteSent: Boolean(inviteSent), internal: false },
    'agreement_completed',
    null,
    {
      cc: agreement.agent.accountEmail && agreement.agent.accountEmail !== agreement.agent.email ? agreement.agent.accountEmail : undefined,
      attachments,
    }
  );
  // Internal copy: whoever sent it (falls back to the configured from-address owner).
  try {
    const { User } = require('../models'); // eslint-disable-line global-require
    const sender = agreement.createdBy ? await User.findById(agreement.createdBy).select('email name') : null;
    const internalTo = (sender && sender.email) || (settings && settings.signatory && settings.signatory.email) || config.email.from;
    if (internalTo) {
      await sendEmail(
        internalTo,
        `Signed by both parties: ${agreement.agreementNo} — ${agreement.agent.organisationEn || agreement.agent.nameEn}`,
        `Agreement ${agreement.agreementNo} is complete. Signed PDF attached.`,
        // The commission is on Ulearn's own copy only — the partner reads it in the contract PDF, never in an email.
        { ...base, commissionEn: agreement.commission.textEn, commissionAr: agreement.commission.textAr, name: (sender && sender.name) || 'team', email: internalTo, internal: true },
        'agreement_completed',
        null,
        { attachments }
      );
    }
  } catch (err) {
    logger.error(`agreement internal copy failed: ${err.message}`);
  }
};

module.exports = {
  ACCESS_ROLE_LABEL,
  sendAgreementSentEmail,
  sendAgreementReminderEmail,
  sendAgreementCompletedEmail,
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