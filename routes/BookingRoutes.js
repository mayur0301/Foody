/*
const express = require('express');
const router = express.Router();

const {
  createBooking,
  getMyBookings,
  getBookingById,
  updateBookingStatus,
  cancelBooking,
  getAllBookings
} = require('../controllers/BookingsController');

const authenticate = require('../middleware/auth');
const allowRoles = require('../middleware/allowedRoles');
const { ROLES } = require('../utils/constants');

router.post('/', authenticate, createBooking);
router.get('/', authenticate, getMyBookings);
router.get('/all', authenticate, allowRoles(ROLES.HOTEL_ADMIN, ROLES.STAFF, ROLES.SUPER_ADMIN), getAllBookings);
router.get('/:id', authenticate, getBookingById);

// Staff/Admin can update status (confirm, etc.)
router.patch('/:id/status', authenticate, allowRoles(ROLES.HOTEL_ADMIN, ROLES.STAFF), updateBookingStatus);

// Only the booker or admin/staff can cancel
router.delete('/:id', authenticate, allowRoles(ROLES.HOTEL_ADMIN, ROLES.STAFF), cancelBooking);

module.exports = router;
*/