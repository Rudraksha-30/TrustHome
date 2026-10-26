const router = require('express').Router();
const { protect, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/media.controller');

// The file itself is reached through a short-lived signed address (see media.controller.js), so no login header here.
router.get('/:id/file', ctrl.file);

router.delete('/:id', protect, authorize('customer', 'provider'), ctrl.remove);

module.exports = router;
