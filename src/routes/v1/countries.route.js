const express = require('express');

const countriesController = require('../../controllers/countries.controller');

const router = express.Router();

router.route('/').post(countriesController.createCountry);

router.route('/').get(countriesController.getCountries);

router.route('/search/:text').get(countriesController.searchCountries);

router.route('/:countryId').patch(countriesController.updateCountry).delete(countriesController.deleteCountry);

router.route('/:countryId').get(countriesController.getCountry);

module.exports = router;
