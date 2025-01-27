const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const { newsService } = require('../services');
const ApiError = require('../utils/ApiError');

/**
 * Create a news item.
 */
const createNews = catchAsync(async (req, res) => {
  const news = await newsService.createNews(req.body);
  res.status(httpStatus.CREATED).send({ message: 'News created successfully', news });
});

/**
 * Get all news items.
 */
const getNews = catchAsync(async (req, res) => {
  const newsList = await newsService.queryNews();
  res.status(httpStatus.OK).send({ news: newsList });
});

/**
 * Get a news item by ID.
 */
const getNewsById = catchAsync(async (req, res) => {
  const news = await newsService.getNewsById(req.params.id);
  res.status(httpStatus.OK).send({ news });
});

/**
 * Update a news item by ID.
 */
const updateNews = catchAsync(async (req, res) => {
  const news = await newsService.updateNewsById(req.params.id, req.body);
  res.status(httpStatus.OK).send({ message: 'News updated successfully', news });
});

/**
 * Delete a news item by ID.
 */
const deleteNews = catchAsync(async (req, res) => {
  await newsService.deleteNewsById(req.params.id);
  res.status(httpStatus.NO_CONTENT).send();
});

/**
 * Generate a QR code.
 */
const generateQRCode = catchAsync(async (req, res) => {
  const { url } = req.body; // The URL to encode in the QR code
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  const qrCodeImage = await newsService.generateQRCode(url);
  res.status(httpStatus.OK).json({
    message: 'QR Code generated successfully',
    qrCodeImage, // Base64 QR code
  });
});

/**
 * Update the existing QR Code URL
 */
const updateQRCodeUrl = catchAsync(async (req, res) => {
  const { currentQrCodeUrl, newUrl } = req.body; // Old and new URL
  if (!currentQrCodeUrl || !newUrl) {
    return res.status(400).json({ error: 'Both current and new URLs are required' });
  }

  const updatedQrCode = await newsService.updateQRCodeUrl(currentQrCodeUrl, newUrl);
  res.status(httpStatus.OK).json({
    message: 'QR Code URL updated successfully',
    qrCodeImage: updatedQrCode, // Updated base64 QR code
  });
});

module.exports = {
  createNews,
  getNews,
  getNewsById,
  updateNews,
  deleteNews,
  generateQRCode,
  updateQRCodeUrl,
};
