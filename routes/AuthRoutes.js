const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/role');

router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/staff-login', authController.staffLogin);
router.post('/logout', authenticate, authController.logout);

module.exports = router;