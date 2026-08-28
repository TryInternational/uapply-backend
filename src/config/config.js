const dotenv = require('dotenv');
const path = require('path');
const Joi = require('joi');

dotenv.config({ path: path.join(__dirname, `../../.env.${process.env.APP_ENV}`) });
// NOTE: this used to be `console.log('NODE_ENV:', process.env)`, which printed
// EVERY environment variable — Mongo URL, JWT secret, API keys, the Firebase
// private key — into the boot logs on every start. Removed; log the one thing
// that is actually useful and is not a secret.
console.log(`config: APP_ENV=${process.env.APP_ENV || '(unset)'} NODE_ENV=${process.env.NODE_ENV}`);
const envVarsSchema = Joi.object()
  .keys({
    NODE_ENV: Joi.string().valid('production', 'development', 'test').required(),
    PORT: Joi.number().default(3000),
    MONGODB_URL: Joi.string().required().description('Mongo DB url'),
    JWT_SECRET: Joi.string().required().description('JWT secret key'),
    // 24 hours. Was 30 minutes, which is the interval a partner portal's data
    // would silently stop loading over — see the softAuth comment in
    // middlewares/subAgentScope.js. Every env file now sets this explicitly;
    // the default matters because .env and .env.production omitted the key and
    // inherited it.
    JWT_ACCESS_EXPIRATION_MINUTES: Joi.number().default(1440).description('minutes after which access tokens expire'),
    JWT_REFRESH_EXPIRATION_DAYS: Joi.number().default(30).description('days after which refresh tokens expire'),
    JWT_RESET_PASSWORD_EXPIRATION_MINUTES: Joi.number()
      .default(10)
      .description('minutes after which reset password token expires'),
    JWT_VERIFY_EMAIL_EXPIRATION_MINUTES: Joi.number()
      .default(10)
      .description('minutes after which verify email token expires'),
    FATOORAH_KEY: Joi.string().description('this is for payment gateway'),
    FATOORAH_API: Joi.string().uri().description('this is for payment gateway'),
    HOST_URL: Joi.string().uri().description('this is for payment gateway'),
    WEBSITE_URL: Joi.string().uri().description('this is for the website'),
    SMTP_HOST: Joi.string().description('server that will send the emails'),
    SMTP_PORT: Joi.number().description('port to connect to the email server'),
    SMTP_USERNAME: Joi.string().description('username for email server'),
    SMTP_PASSWORD: Joi.string().description('password for email server'),
    EMAIL_FROM: Joi.string().description('the from field in the emails sent by the app'),
    SLACK_KEY: Joi.string().description('this is for slack'),
    SLACK_WEB_HOOK: Joi.string().description('Try slack web hook for uapply qualified users'),
    SLACK_WEB_HOOK_ULEARN: Joi.string().description('Ulearn slack web hook for uapply qualified users'),
    SLACK_NOTIFICATION: Joi.string().description('Uapply slack app token'),
    SLACK_ALERT: Joi.string().description('Uapply alert on new application'),
    OPENAI_API_KEY: Joi.string().description('API key for OpenAI'),
    ANTHROPIC_API_KEY: Joi.string().description('API key for Anthropic (preferred for IELTS writing scoring)'),
    IELTS_SCORING_MODEL: Joi.string().description('optional model override for IELTS writing scoring'),
    IELTS_REGISTRATION_GOOGLE_SHEET_ID: Joi.string().description('IELTS registration google sheet id'),
    MAJOR_GOOGLE_SHEET_ID: Joi.string().description('Major test google sheet id'),
    GOOGLE_CLIENT_ID: Joi.string().description('Google OAuth client id for ulearn student sign-in'),
    ULEARN_STUDENT_JWT_SECRET: Joi.string().description('JWT secret for ulearn student tokens (falls back to JWT_SECRET)'),
    ULEARN_STUDENT_JWT_EXPIRATION_DAYS: Joi.number().default(30).description('days ulearn student tokens stay valid'),
    ULEARN_BACKOFFICE_AUTH: Joi.boolean()
      .default(false)
      .description(
        'require a back-office JWT on the ulearn-students CRM endpoints. Off by default: every other list route in this service is open, the CRM never refreshes its token, and access tokens expire after 30 minutes.'
      ),
    ULEARN_GOOGLE_AUTH_ENABLED: Joi.boolean()
      .default(false)
      .description('rollback switch: re-enable the legacy Google sign-in endpoint for ulearn students'),
    APPLICATION_AUTH: Joi.boolean()
      .default(false)
      .description(
        'require a valid JWT on the pre-existing /application and /students routes. Off by default because those routes have never been authenticated, the CRM does not refresh its token, and access tokens expire after 30 minutes -- turning this on without checking every caller would 401 the whole back office. The sub-agent routes are gated unconditionally regardless of this flag.'
      ),
    SCHOOL_COUNSELOR_ROLE_ID: Joi.string()
      .allow('')
      .default('')
      .description(
        'ObjectId of the School Counselor role used when an access request for that role is approved. Deliberately has NO default: 6996eb7e0433eb6a6238d1c4 is the id that historically meant BOTH school counsellor and sub-agent, and none of the external-partner scoping fires for it, so defaulting to it would let one approval click hand an unvetted outsider a staff-shaped token. Run subAgentRole.migration.js, which mints a dedicated role, and set this explicitly.'
      ),
    TRUST_PROXY_HOPS: Joi.number()
      .default(1)
      .description(
        'how many reverse proxies sit in front of this app. Used verbatim by app.set("trust proxy"). Must NOT be a blanket true: trusting every hop means Express takes the left-most X-Forwarded-For entry, which the CALLER writes, so every rate limiter becomes spoofable. Verify the real number by logging req.ip beside req.headers["x-forwarded-for"] from a known client.'
      ),
    INVITE_EXPIRATION_HOURS: Joi.number()
      .default(48)
      .description(
        'how long an emailed set-password invite stays valid. Separate from JWT_RESET_PASSWORD_EXPIRATION_MINUTES (10) because an onboarding invite is read hours later, not seconds later.'
      ),
    BACKOFFICE_URL: Joi.string()
      .default('https://backoffice.uapplyabroad.com')
      .description('base URL of the staff CRM, used to build emailed links'),
    SUBAGENT_PORTAL_URL: Joi.string()
      .default('https://subagent.uapplyabroad.com')
      .description('base URL of the sub-agent portal, used to build emailed links'),
    SUB_AGENT_ROLE_ID: Joi.string()
      .allow('')
      .default('')
      .description(
        'ObjectId of the dedicated Sub Agent role, produced by src/migrations/subAgentRole.migration.js. Empty means no user is ever treated as a sub-agent, so the feature is inert rather than open.'
      ),
    // Phone sign-in verifies tokens issued by the FRONTEND's Firebase project,
    // which is NOT the same project as the FIREBASE_* service account used for
    // WhatsApp media storage. Kept separate so neither can break the other.
    ULEARN_FIREBASE_PROJECT_ID: Joi.string()
      .default('ulearn-abroad')
      .description('Firebase project that issues ulearn student phone-auth tokens'),
    ULEARN_FIREBASE_CLIENT_EMAIL: Joi.string()
      .allow('')
      .description('optional service-account email for that project; only needed to check token revocation'),
    ULEARN_FIREBASE_PRIVATE_KEY: Joi.string().allow('').description('optional service-account private key for that project'),
    WHATSAPP_PHONE_NUMBER_ID: Joi.string().allow('').description('WhatsApp Cloud API phone number id'),
    WHATSAPP_TOKEN: Joi.string().allow('').description('WhatsApp Cloud API access token'),
    WHATSAPP_WABA_ID: Joi.string().allow('').description('WhatsApp Business Account id (for message templates)'),
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: Joi.string()
      .allow('')
      .description('Token echoed back on the webhook GET verification challenge'),
    WHATSAPP_APP_SECRET: Joi.string().allow('').description('Meta app secret used to verify X-Hub-Signature-256'),
    WHATSAPP_API_VERSION: Joi.string().default('v21.0').description('Graph API version, e.g. v21.0'),
    WHATSAPP_MEDIA_BUCKET: Joi.string().allow('').description('Firebase/GCS bucket name for storing inbound WhatsApp media'),
  })
  .unknown();

const { value: envVars, error } = envVarsSchema.prefs({ errors: { label: 'key' } }).validate(process.env);

if (error) {
  throw new Error(`Config validation error: ${error.message}`);
}

// Sub Agent and School Counselor must be DIFFERENT roles.
//
// They shared one ObjectId (6996eb7e0433eb6a6238d1c4) until the partner-role
// migration split them, and pointing both env vars back at one id would undo
// that silently: `isSubAgent` would match school counsellors, handing them the
// sub-agent portal and applying every sub-agent restriction to internal staff.
// Refusing to boot is the only way an operator finds out immediately rather
// than through a support ticket a week later.
if (
  envVars.SUB_AGENT_ROLE_ID &&
  envVars.SCHOOL_COUNSELOR_ROLE_ID &&
  String(envVars.SUB_AGENT_ROLE_ID) === String(envVars.SCHOOL_COUNSELOR_ROLE_ID)
) {
  throw new Error(
    `Config validation error: SUB_AGENT_ROLE_ID and SCHOOL_COUNSELOR_ROLE_ID are both ${envVars.SUB_AGENT_ROLE_ID}. ` +
      'These are different roles and need different ObjectIds -- run src/migrations/subAgentRole.migration.js --apply, ' +
      'which creates one of each, and use the two ids it prints.'
  );
}

module.exports = {
  env: envVars.NODE_ENV,
  port: envVars.PORT,
  openai: {
    apiKey: envVars.OPENAI_API_KEY,
  },
  anthropic: {
    apiKey: envVars.ANTHROPIC_API_KEY,
  },
  ieltsScoring: {
    model: envVars.IELTS_SCORING_MODEL,
  },
  mongoose: {
    url: envVars.MONGODB_URL + (envVars.NODE_ENV === 'test' ? '-test' : ''),
    options: {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    },
  },
  jwt: {
    secret: envVars.JWT_SECRET,
    accessExpirationMinutes: envVars.JWT_ACCESS_EXPIRATION_MINUTES,
    refreshExpirationDays: envVars.JWT_REFRESH_EXPIRATION_DAYS,
    resetPasswordExpirationMinutes: envVars.JWT_RESET_PASSWORD_EXPIRATION_MINUTES,
    verifyEmailExpirationMinutes: envVars.JWT_VERIFY_EMAIL_EXPIRATION_MINUTES,
  },
  email: {
    smtp: {
      host: envVars.SMTP_HOST,
      port: envVars.SMTP_PORT,
      auth: {
        user: envVars.SMTP_USERNAME,
        pass: envVars.SMTP_PASSWORD,
      },
    },
    from: envVars.EMAIL_FROM,
  },
  service: {
    client_id: envVars.CLIENT_ID,
    client_email: envVars.CLIENT_EMAIL,
    private_key: envVars.PRIVATE_KEY.replace(/\\n/g, '\n'),
  },
  fatoorah: {
    key: envVars.FATOORAH_KEY,
    url: envVars.FATOORAH_API,
  },
  host: envVars.HOST_URL,
  website: envVars.WEBSITE_URL,
  firebase_service: {
    client_id: envVars.FIREBASE_CLIENT_ID,
    client_email: envVars.FIREBASE_CLIENT_EMAIL,
    private_key: envVars.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    type: envVars.FIREBASE_TYPE,
    project_id: envVars.FIREBASE_PROJECT_ID,
    private_key_id: envVars.FIREBASE_PRIVATE_KEY_ID,
    auth_uri: envVars.FIREBASE_AUTH_URI,
    token_uri: envVars.FIREBASE_TOKEN_URI,
    auth_provider_x509_cert_url: envVars.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
    client_x509_cert_url: envVars.FIREBASE_CLIENT_X509_CERT_URL,
  },
  googlesheet: {
    booking: envVars.BOOKING_GOOGLE_SHEET_ID,
    ieltsRegistration: envVars.IELTS_REGISTRATION_GOOGLE_SHEET_ID,
    major: envVars.MAJOR_GOOGLE_SHEET_ID,
  },
  google: {
    clientId: envVars.GOOGLE_CLIENT_ID,
  },
  ulearnStudents: {
    jwtSecret: envVars.ULEARN_STUDENT_JWT_SECRET || envVars.JWT_SECRET,
    jwtExpirationDays: envVars.ULEARN_STUDENT_JWT_EXPIRATION_DAYS,
    googleAuthEnabled: envVars.ULEARN_GOOGLE_AUTH_ENABLED === true,
    backOfficeAuth: envVars.ULEARN_BACKOFFICE_AUTH === true,
    firebase: {
      projectId: envVars.ULEARN_FIREBASE_PROJECT_ID,
      clientEmail: envVars.ULEARN_FIREBASE_CLIENT_EMAIL || '',
      privateKey: (envVars.ULEARN_FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    },
  },
  applications: {
    // See APPLICATION_AUTH above: the legacy gate, off by default.
    authEnabled: envVars.APPLICATION_AUTH === true,
    // Empty string until the migration has run and the env is set. Every
    // sub-agent predicate compares against this, so an unset value means
    // "nobody is a sub-agent" -- it fails closed on capability, not on access.
    subAgentRoleId: envVars.SUB_AGENT_ROLE_ID || '',
    // Approving an access request maps the requested role NAME to one of these
    // two ids server-side; a request body never carries a role id. Both are
    // empty until an operator sets them, and approval refuses rather than
    // guessing -- see SCHOOL_COUNSELOR_ROLE_ID above.
    schoolCounselorRoleId: envVars.SCHOOL_COUNSELOR_ROLE_ID || '',
    inviteExpirationHours: envVars.INVITE_EXPIRATION_HOURS,
  },
  trustProxyHops: envVars.TRUST_PROXY_HOPS,
  appUrls: {
    backoffice: String(envVars.BACKOFFICE_URL).replace(/\/+$/, ''),
    subAgentPortal: String(envVars.SUBAGENT_PORTAL_URL).replace(/\/+$/, ''),
  },
  slack: {
    slackApiKey: envVars.SLACK_KEY,
    slackWebHook: envVars.SLACK_WEB_HOOK,
    slackWebHookUlearn: envVars.SLACK_WEB_HOOK_ULEARN,
    slackNotification: envVars.SLACK_NOTIFICATION,
    slackApplicationAlert: envVars.SLACK_ALERT,
  },
  whatsapp: {
    phoneNumberId: envVars.WHATSAPP_PHONE_NUMBER_ID,
    token: envVars.WHATSAPP_TOKEN,
    wabaId: envVars.WHATSAPP_WABA_ID,
    webhookVerifyToken: envVars.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
    appSecret: envVars.WHATSAPP_APP_SECRET,
    apiVersion: envVars.WHATSAPP_API_VERSION,
    // Defaults to the firebase project's bucket when unset.
    mediaBucket: envVars.WHATSAPP_MEDIA_BUCKET || `${envVars.FIREBASE_PROJECT_ID}.appspot.com`,
  },
};
