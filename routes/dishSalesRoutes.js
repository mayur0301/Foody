const express = require('express');
const router = express.Router();

const {
    getDishSales,
    getDishSalesByHotel
} = require('../controllers/dishSalesController');

const authenticate = require('../middleware/auth');
const allowRoles = require('../middleware/allowedRoles');
const requireFeature = require('../middleware/requireFeature');
const { ROLES, FEATURES } = require('../utils/constants');

// ── Hotel Admin / Staff — dish sales analytics (requires SALES_ANALYTICS feature) ──
router.get('/',
    authenticate,
    allowRoles(ROLES.HOTEL_ADMIN, ROLES.STAFF),
    requireFeature(FEATURES.SALES_ANALYTICS),
    getDishSales
);

// Super Admin — dish sales for a specific hotel (no feature check, admin override)
router.get('/hotel/:hotelId', authenticate, allowRoles(ROLES.SUPER_ADMIN), getDishSalesByHotel);

module.exports = router;
