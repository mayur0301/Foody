/*
const Booking = require('../models/Booking');
const Room = require('../models/Room');
const { ROLES } = require('../utils/constants');

exports.createBooking = async (req, res) => {
  try {
    const { room, checkIn, checkOut } = req.body;

    const roomDoc = await Room.findById(room);
    if (!roomDoc) return res.status(404).json({ message: 'Room not found' });
    if (roomDoc.status !== 'available') {
      return res.status(400).json({ message: 'Room is not available' });
    }

    const days = (new Date(checkOut) - new Date(checkIn)) / (1000 * 60 * 60 * 24);
    if (days <= 0) return res.status(400).json({ message: 'Invalid date range' });

    const totalPrice = days * roomDoc.price;

    const booking = new Booking({
      user: req.user.id,
      room,
      checkIn,
      checkOut,
      totalPrice,
      hotel: roomDoc.hotel, // ✅ Link to same hotel as the room
      status: 'pending'
    });

    await booking.save();

    return res.status(201).json(booking);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

exports.getMyBookings = async (req, res) => {
  try {
    const bookings = await Booking.find({ user: req.user.id })
      .populate('room', 'number type price')
      .sort({ createdAt: -1 });
    return res.json(bookings);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// @desc    Get all bookings (For Admins/Staff)
exports.getAllBookings = async (req, res) => {
  try {
    const filter = {};
    if (req.user.role !== ROLES.SUPER_ADMIN) {
      filter.hotel = req.user.hotel;
    } else if (req.query.hotelId) {
      filter.hotel = req.query.hotelId;
    }

    const bookings = await Booking.find(filter)
      .populate('room', 'number type')
      .populate('user', 'username phone')
      .sort({ createdAt: -1 });

    return res.json(bookings);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

exports.getBookingById = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id)
      .populate('room', 'number type price');

    if (!booking) return res.status(404).json({ message: 'Booking not found' });

    const isOwner = booking.user.toString() === req.user.id;
    const isSuperAdmin = req.user.role === ROLES.SUPER_ADMIN;
    const isHotelMember = (req.user.role === ROLES.HOTEL_ADMIN || req.user.role === ROLES.STAFF) &&
      booking.hotel.toString() === req.user.hotel.toString();

    if (!isOwner && !isSuperAdmin && !isHotelMember) {
      return res.status(403).json({ message: 'Not authorized to view this booking' });
    }

    return res.json(booking);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

exports.updateBookingStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!['pending', 'confirmed', 'cancelled'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ message: 'Booking not found' });

    // Authorization check
    const isSuperAdmin = req.user.role === ROLES.SUPER_ADMIN;
    const isHotelMember = (req.user.role === ROLES.HOTEL_ADMIN || req.user.role === ROLES.STAFF) &&
      booking.hotel.toString() === req.user.hotel.toString();

    if (!isSuperAdmin && !isHotelMember) {
      return res.status(403).json({ message: 'Access denied' });
    }

    booking.status = status;
    await booking.save();

    // If confirmed → mark room booked
    if (status === 'confirmed') {
      await Room.findByIdAndUpdate(booking.room, { status: 'booked' });
    }

    return res.json(booking);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

exports.cancelBooking = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ message: 'Booking not found' });

    const isOwner = booking.user.toString() === req.user.id;
    const isSuperAdmin = req.user.role === ROLES.SUPER_ADMIN;
    const isHotelMember = (req.user.role === ROLES.HOTEL_ADMIN || req.user.role === ROLES.STAFF) &&
      booking.hotel.toString() === req.user.hotel.toString();

    if (!isOwner && !isSuperAdmin && !isHotelMember) {
      return res.status(403).json({ message: 'Not authorized to cancel this booking' });
    }

    if (booking.status === 'cancelled') {
      return res.status(400).json({ message: 'Booking already cancelled' });
    }

    booking.status = 'cancelled';
    await booking.save();

    // Free up the room
    await Room.findByIdAndUpdate(booking.room, { status: 'available' });

    return res.json({ message: 'Booking cancelled successfully', booking });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};
*/
