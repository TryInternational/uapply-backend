/* eslint-disable security/detect-unsafe-regex */
const moment = require('moment');

const generatePassword = () => {
  const length = 8;
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let retVal = '';
  for (let i = 0, n = charset.length; i < length; i += 1) {
    retVal += charset.charAt(Math.floor(Math.random() * n));
  }
  return retVal;
};

const DateToString = ({ dateIsoString, format = 'MMM DD YYYY', timezone = 'Asia/Kuwait' }) => {
  const dateObject = new Date(dateIsoString);

  return moment(dateObject).tz(timezone).format(format);
};

module.exports = {
  DateToString,
  generatePassword,
};
