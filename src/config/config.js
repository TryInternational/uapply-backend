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
    SMTP_HOST: Joi.string().description('server that will send the emails'),
    SMTP_PORT: Joi.number().description('port to connect to the email server'),
    SMTP_USERNAME: Joi.string().description('username for email server'),
    SMTP_PASSWORD: Joi.string().description('password for email server'),
    EMAIL_FROM: Joi.string().description('the from field in the emails sent by the app'),
    SLACK_KEY: Joi.string().description('this is for slack'),
    SLACK_WEB_HOOK: Joi.string().description('Try slack web hook for uapply qualified users'),
    SLACK_WEB_HOOK_ULEARN: Joi.string().description('Ulearn slack web hook for uapply qualified users'),
    PIXEL_ACCESS_TOKEN: Joi.string().description('Uapply pixel access token'),
    PIXEL_ID: Joi.string().description('Uapply pixel id'),
    PIXEL_ID_ULEARNABROAD: Joi.string().description('Ulearn abroad pixel id'),
    PIXEL_ACCESS_TOKEN_ULEARNABROAD: Joi.string().description('Ulearn abroad pixel access token'),
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
  slack: {
    slackApiKey: envVars.SLACK_KEY,
    slackWebHook: envVars.SLACK_WEB_HOOK,
    slackWebHookUlearn: envVars.SLACK_WEB_HOOK_ULEARN,
  },
  pixel: {
    accessToken: envVars.PIXEL_ACCESS_TOKEN,
    pixelId: envVars.PIXEL_ID,
    pixelUlearnId: envVars.PIXEL_ID_ULEARNABROAD,
    ulearnAbroadPixelId: envVars.PIXEL_ACCESS_TOKEN_ULEARNABROAD,
  },
};
