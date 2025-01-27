const httpStatus = require('http-status');
const QRCode = require('qrcode');
const { News } = require('../models');
const ApiError = require('../utils/ApiError');

/**
 * Create a news item.
 * @param {Object} newsBody
 * @returns {Promise<News>}
 */
const createNews = async (newsBody) => {
  return await News.create(newsBody);
};

/**
 * Query all news items.
 * @returns {Promise<Array<News>>}
 */
const queryNews = async () => {
  return await News.find();
};

/**
 * Get news item by ID.
 * @param {ObjectId} id
 * @returns {Promise<News>}
 */
const getNewsById = async (id) => {
  const news = await News.findById(id);
  if (!news) {
    throw new ApiError(httpStatus.NOT_FOUND, 'News not found');
  }
  return news;
};

/**
 * Update news item by ID.
 * @param {ObjectId} id
 * @param {Object} updateBody
 * @returns {Promise<News>}
 */
const updateNewsById = async (id, updateBody) => {
  const news = await getNewsById(id);
  Object.assign(news, updateBody);
  await news.save();
  return news;
};

/**
 * Delete news item by ID.
 * @param {ObjectId} id
 * @returns {Promise<News>}
 */
const deleteNewsById = async (id) => {
  const news = await getNewsById(id);
  await news.remove();
  return news;
};

const generateQRCode = async (url) => {
  try {
    const qrCodeImage = await QRCode.toDataURL(url); // Generates QR code as base64
    return qrCodeImage;
  } catch (error) {
    throw new Error('Failed to generate QR code');
  }
};

/**
 * Update the QR code's URL by generating a new QR code with the updated URL
 * @param {String} currentQrCodeUrl - The existing QR code's URL
 * @param {String} newUrl - The new URL to encode in the QR code
 * @returns {Promise<String>} - Updated base64 encoded QR code image
 */
const updateQRCodeUrl = async (currentQrCodeUrl, newUrl) => {
  try {
    // Regenerate the QR code with the new URL
    const newQrCodeImage = await generateQRCode(newUrl);
    return newQrCodeImage; // Return updated QR code (base64)
  } catch (error) {
    throw new Error('Failed to update QR code');
  }
};

module.exports = {
  createNews,
  queryNews,
  generateQRCode,
  updateQRCodeUrl,
  getNewsById,
  updateNewsById,
  deleteNewsById,
};
