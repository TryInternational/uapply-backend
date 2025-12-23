const { DateTime } = require('luxon'); // Import luxon

const generatePassword = () => {
  const length = 8;
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let retVal = '';
  for (let i = 0, n = charset.length; i < length; i += 1) {
    retVal += charset.charAt(Math.floor(Math.random() * n));
  }
  return retVal;
};

const DateToString = ({ dateIsoString, format = 'MMM dd yyyy', timezone = 'Asia/Kuwait' }) => {
  const dateObject = DateTime.fromISO(dateIsoString, { zone: timezone });

  return dateObject.toFormat(format); // Use luxon for formatting
};
function convertASTToUTC(astDateTime, keepWallTime = false) {
  if (keepWallTime) {
    return astDateTime.setZone('UTC', { keepLocalTime: true });
  }
  return astDateTime.toUTC();
}

module.exports = {
  DateToString,
  generatePassword,
  convertASTToUTC,
};
