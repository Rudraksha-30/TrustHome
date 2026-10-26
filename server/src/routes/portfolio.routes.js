const router = require('express').Router();
// The photo itself is reached through a short-lived signed address, so there is no login header here.
router.get('/:id/file', require('../controllers/portfolio.controller').file);
module.exports = router;
