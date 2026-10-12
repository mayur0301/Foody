const express = require('express');
const router = express.Router();
const ProfileController = require('../controllers/ProfileController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/role');

router.get('/get', authenticate, ProfileController.getProfile);
router.put('/update', authenticate, ProfileController.updateProfile);
;

module.exports = router;