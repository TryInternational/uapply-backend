const httpStatus = require('http-status');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { newsService } = require('../services');

const createNews = catchAsync(async (req, res) => {
  const role = await newsService.createNews(req.body);
  res.status(httpStatus.CREATED).send(role);
});

const getNews = catchAsync(async (req, res) => {
  const result = await newsService.queryNews();
  res.send(result);
});

const getNewsById = catchAsync(async (req, res) => {
  const news = await newsService.getNewsById(req.params.id);
  if (!news) {
    throw new ApiError(httpStatus.NOT_FOUND, 'news not found');
  }
  res.send(news);
});

const updateNews = catchAsync(async (req, res) => {
  const news = await newsService.updateNewsById(req.params.id, req.body);
  res.send(news);
});

const deleteNews = catchAsync(async (req, res) => {
  await newsService.deleteNewsById(req.params.id);
  res.status(httpStatus.NO_CONTENT).send();
});

module.exports = {
  createNews,
  getNews,
  getNewsById,
  updateNews,
  deleteNews,
};
