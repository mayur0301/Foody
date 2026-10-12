// routes/subscriptionRoutes.js
const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const allowRoles = require('../middleware/allowedRoles');
const { ROLES } = require('../utils/constants');
const {
   getMySubscription,
   createOrder,
   verifyPayment,
   cancelSubscription,
   rechargeSubscription,
   getTransactionHistory,
   getHotelSubscription,
   getAllSubscriptions,
} = require('../controllers/subscriptionController');

/* ═══════════════════════════════════════════
   HOTEL_ADMIN ROUTES — /api/subscription
   ═══════════════════════════════════════════ */

router.post('/verify-payment', verifyPayment);

// All hotel routes require authentication
router.use(authenticate);

router.post('/create-order', createOrder);

// Hotel Admin — manage own subscription
router.get('/', allowRoles(ROLES.HOTEL_ADMIN), getMySubscription);
router.post('/cancel', allowRoles(ROLES.HOTEL_ADMIN), cancelSubscription);
router.post('/recharge', allowRoles(ROLES.HOTEL_ADMIN), rechargeSubscription);
router.get('/transactions', allowRoles(ROLES.HOTEL_ADMIN), getTransactionHistory);

/* ═══════════════════════════════════════════
   SUPERADMIN ROUTES — /api/subscription/admin
   ═══════════════════════════════════════════ */

router.get('/admin/all', allowRoles(ROLES.SUPER_ADMIN), getAllSubscriptions);
router.get('/admin/:hotelId', allowRoles(ROLES.SUPER_ADMIN), getHotelSubscription);

module.exports = router;
