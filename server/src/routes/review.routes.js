const router = require('express').Router();
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { protect, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/review.controller');

router.use(protect, authorize('customer'));

router.post(
  '/',
  [
    body('bookingId').isMongoId().withMessage('bookingId must be a valid id'),
    body('rating').isInt({ min: 1, max: 5 }).withMessage('rating must be a whole number from 1 to 5').toInt(),
    body('comment').optional().isString().isLength({ max: 500 }),
  ],
  validate,
  ctrl.createReview
);

// Point 1: edit or remove your own review
router.patch(
  '/:id',
  [
    body('rating').optional().isInt({ min: 1, max: 5 }).withMessage('rating must be a whole number from 1 to 5').toInt(),
    body('comment').optional().isString().isLength({ max: 500 }),
  ],
  validate,
  ctrl.updateReview
);
router.delete('/:id', ctrl.deleteReview);

module.exports = router;
