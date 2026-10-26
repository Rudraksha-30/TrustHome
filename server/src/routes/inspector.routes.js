const router = require('express').Router();
const { protect, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/inspector.controller');

// Read-only quality report for the quality inspector (an admin may read it too).
router.use(protect, authorize('inspector', 'admin'));
router.get('/report', ctrl.report);

module.exports = router;
