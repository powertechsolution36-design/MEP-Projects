const express = require('express');
const { getHealth } = require('../controllers/healthController');

const router = express.Router();
router.get('/', getHealth); // GET /api/v3/health — no auth required

module.exports = router;
