/*
const express = require('express');
const router = express.Router();

const {
  createRoom,
  getAllRooms,
  getRoomById,
  updateRoom,
  deleteRoom
} = require('../controllers/RoomController');

const authenticate = require('../middleware/auth');
const allowRoles = require('../middleware/allowedRoles');
const { ROLES } = require('../utils/constants');

// Public: anyone authenticated can see rooms
router.get('/', authenticate, getAllRooms);
router.get('/:id', authenticate, getRoomById);

// Restricted: admin + staff
router.post('/', authenticate, allowRoles(ROLES.HOTEL_ADMIN, ROLES.STAFF), createRoom);
router.put('/:id', authenticate, allowRoles(ROLES.HOTEL_ADMIN, ROLES.STAFF), updateRoom);
router.delete('/:id', authenticate, allowRoles(ROLES.HOTEL_ADMIN), deleteRoom);

module.exports = router;
*/