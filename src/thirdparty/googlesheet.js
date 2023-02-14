const { GoogleSpreadsheet } = require('google-spreadsheet');
const config = require('../config/config');

const addRow = async (id, row) => {
  const doc = new GoogleSpreadsheet(id);
  await doc.useServiceAccountAuth(config.service);
  await doc.loadInfo();
  const sheet = doc.sheetsByIndex[0];
  const booking = await sheet.addRow(row);
  return booking;
};

module.exports = {
  addRow,
};
// https://ulearn-staging-api-dot-digital-vim-270607.appspot.com/v1/payments/redirect/confirm?paymentId=100202024565809171&Id=100202024565809171
