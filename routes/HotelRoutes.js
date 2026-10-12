const express = require('express');
const router = express.Router();
const {
    registerHotel,
    createHotel,
    getAllHotels,
    getHotelById,
    updateHotel,
    deleteHotel,
    getHotelDashboard,
    getSuperAdminDashboard,
    getCustomers,
    approveHotel,
    verifyRegistrationPayment
} = require('../controllers/HotelController');

const authenticate = require('../middleware/auth');
const allowRoles = require('../middleware/allowedRoles');
const { ROLES } = require('../utils/constants');

// Public Routes
router.post('/register', registerHotel); // Public hotel self-registration
router.post('/verify-payment', verifyRegistrationPayment); // New public verification route

// Super Admin & Hotel Admin access
router.post('/', authenticate, allowRoles(ROLES.SUPER_ADMIN), createHotel); // Only Super Admin can create hotel + admin
router.get('/super/dashboard', authenticate, allowRoles(ROLES.SUPER_ADMIN), getSuperAdminDashboard);
router.patch('/:id/approve', authenticate, allowRoles(ROLES.SUPER_ADMIN), approveHotel);
router.get('/', authenticate, allowRoles(ROLES.SUPER_ADMIN, ROLES.HOTEL_ADMIN), getAllHotels);
router.get('/customers', authenticate, allowRoles(ROLES.HOTEL_ADMIN, ROLES.STAFF), getCustomers);
router.delete('/:id', authenticate, allowRoles(ROLES.SUPER_ADMIN), deleteHotel);

// Open to authenticated users (admin can update)
router.get('/:id', authenticate, getHotelById);
router.get('/:id/dashboard', authenticate, allowRoles(ROLES.SUPER_ADMIN, ROLES.HOTEL_ADMIN), getHotelDashboard);
router.put('/:id', authenticate, allowRoles(ROLES.SUPER_ADMIN, ROLES.HOTEL_ADMIN), updateHotel);

module.exports = router;
