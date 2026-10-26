const router = require('express').Router();
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { protect, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/provider.controller');
const reviewCtrl = require('../controllers/review.controller');
const portfolioCtrl = require('../controllers/portfolio.controller');
const express = require('express');

// The list of service names is public: it is not provider data, and the home page and sign-up use it.
router.get('/meta/catalog', ctrl.getCatalog);

// Everything below needs a signed-in user. Signed-out visitors cannot see the provider list (point 12).
router.use(protect);

// Browsing is for customers (and staff). Providers do not browse their competitors (points 5 and 10).
router.get('/', authorize('customer', 'admin'), ctrl.listProviders);
router.get('/meta/filters', authorize('customer', 'admin'), ctrl.getFilters);

// Provider's own listing (FR-6, FR-7). Declared BEFORE '/:id' so "me" isn't read as an id.
router.get('/me/profile', authorize('provider'), ctrl.getMyProfile);
router.put(
  '/me/profile',
  authorize('provider'),
  [
    body('headline').optional().isString().isLength({ max: 120 }),
    body('description').optional().isString().isLength({ max: 1000 }),
    body('categories').optional().isArray({ max: 12 }).withMessage('categories must be a list'),
    body('categories.*').optional().isString(),
    body('serviceArea').optional().isString().isLength({ max: 80 }),
    body('priceMin').optional().isFloat({ min: 0 }),
    body('priceMax').optional().isFloat({ min: 0 }),
    body('slotMinutes').optional().isInt({ min: 30, max: 480 }).withMessage('Time per booking must be 30 minutes to 8 hours').toInt(),
    body('isActive').optional().isBoolean(),
  ],
  validate,
  ctrl.upsertMyProfile
);

router.get('/me/availability', authorize('provider'), ctrl.getMyAvailability);
router.patch(
  '/me/availability',
  authorize('provider'),
  [body('available').isBoolean().withMessage('available must be true or false').toBoolean()],
  validate,
  ctrl.setMyAvailability
);

// Portfolio ("previous work" photos). Declared before '/:id' so "me" is not read as an id.
router.post('/me/portfolio', authorize('provider'), express.raw({ type: 'image/*', limit: '6mb' }), portfolioCtrl.add);
router.patch(
  '/me/portfolio/:itemId',
  authorize('provider'),
  [body('caption').isString().isLength({ max: 120 }).withMessage('Caption can be up to 120 characters').trim()],
  validate,
  portfolioCtrl.updateCaption
);
router.delete('/me/portfolio/:itemId', authorize('provider'), portfolioCtrl.remove);

router.get('/:id', authorize('customer', 'provider', 'admin', 'inspector'), ctrl.getProvider);
router.get('/:profileId/portfolio', authorize('customer', 'provider', 'admin', 'inspector'), portfolioCtrl.list);
router.get('/:profileId/reviews', authorize('customer', 'provider', 'admin', 'inspector'), reviewCtrl.listForProvider);

module.exports = router;
