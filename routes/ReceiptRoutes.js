const express = require('express');
const router = express.Router();

const { generateReceiptPdf } = require('./../controllers/ReceiptController');

const authenticate = require('../middleware/auth');

router.get('/:bookingId', authenticate, generateReceiptPdf);

module.exports = router;