const express = require('express');
const router = express.Router();
const {
    createStaff,
    getHotelStaff,
    deleteStaff,
    getAllStaff,
    getStaffByAdmin,
    updateStaff,
    getStaffDashboard,
    getStaffOrders,
    getStaffCategories,
    getStaffDishes,
    getStaffMegaProfile,
    getStaffMegaProfileById
} = require('../controllers/StaffController');

const authenticate = require('../middleware/auth');
const allowRoles = require('../middleware/allowedRoles');
const requireFeature = require('../middleware/requireFeature');
const checkLimit = require('../middleware/checkLimit');
const { ROLES, FEATURES } = require('../utils/constants');
const User = require('../models/User');

// Base authentication required for all routes
router.use(authenticate);

// Update route: Hotel Admin, Super Admin, and the STAFF themselves
router.put('/:id', allowRoles(ROLES.SUPER_ADMIN, ROLES.HOTEL_ADMIN, ROLES.STAFF), updateStaff);

// Staff Personal APIs: Restricted to STAFF
router.get('/dashboard', allowRoles(ROLES.STAFF), getStaffDashboard);
router.get('/orders', allowRoles(ROLES.STAFF), getStaffOrders);
router.get('/categories', allowRoles(ROLES.STAFF), getStaffCategories);
router.get('/dishes', allowRoles(ROLES.STAFF), getStaffDishes);
router.get('/mega-profile', allowRoles(ROLES.STAFF, ROLES.HOTEL_ADMIN, ROLES.SUPER_ADMIN), getStaffMegaProfile);

// ── Create Staff: Feature gated + limit checked ──
router.post('/',
    allowRoles(ROLES.SUPER_ADMIN, ROLES.HOTEL_ADMIN),
    requireFeature(FEATURES.STAFF_MANAGEMENT),
    checkLimit('maxStaff', (req) => User.countDocuments({ hotel: req.user.hotel, role: ROLES.STAFF })),
    createStaff
);

router.get('/all', allowRoles(ROLES.SUPER_ADMIN), getAllStaff);
router.get('/me', allowRoles(ROLES.SUPER_ADMIN, ROLES.HOTEL_ADMIN), getStaffByAdmin);
router.get('/hotel/:hotelId', allowRoles(ROLES.SUPER_ADMIN, ROLES.HOTEL_ADMIN), getHotelStaff);
router.delete('/:id', allowRoles(ROLES.SUPER_ADMIN, ROLES.HOTEL_ADMIN), deleteStaff);

router.get('/:id/mega-profile', allowRoles(ROLES.SUPER_ADMIN, ROLES.HOTEL_ADMIN, ROLES.STAFF), getStaffMegaProfileById);

module.exports = router;
