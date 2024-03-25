const dotenv = require('dotenv');
const path = require('path');
const Joi = require('joi');

dotenv.config({ path: path.join(__dirname, `../../.env.${process.env.APP_ENV}`) });

const envVarsSchema = Joi.object()
  .keys({
    NODE_ENV: Joi.string().valid('production', 'development', 'test').required(),
    PORT: Joi.number().default(3000),
    MONGODB_URL: Joi.string().required().description('Mongo DB url'),
    JWT_SECRET: Joi.string().required().description('JWT secret key'),
    JWT_ACCESS_EXPIRATION_MINUTES: Joi.number().default(30).description('minutes after which access tokens expire'),
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
  })
  .unknown();

const { value: envVars, error } = envVarsSchema.prefs({ errors: { label: 'key' } }).validate(process.env);

if (error) {
  throw new Error(`Config validation error: ${error.message}`);
}

module.exports = {
  env: envVars.NODE_ENV,
  port: envVars.PORT,
  mongoose: {
    url: envVars.MONGODB_URL + (envVars.NODE_ENV === 'test' ? '-test' : ''),
    options: {
      useCreateIndex: true,
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
  },
  slack: {
    slackApiKey: envVars.SLACK_KEY,
    slackWebHook: envVars.SLACK_WEB_HOOK,
    slackWebHookUlearn: envVars.SLACK_WEB_HOOK_ULEARN,
  },
};
