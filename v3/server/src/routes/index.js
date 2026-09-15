const express = require('express');
const router = express.Router();

router.use('/health', require('./health'));
router.use('/me', require('./me'));

module.exports = router;
