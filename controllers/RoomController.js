/*
const Room = require('../models/Room');
const { ROLES } = require('../utils/constants');

exports.createRoom = async (req, res) => {
  try {
    const hotel = req.user.role === ROLES.SUPER_ADMIN ? req.body.hotel : req.user.hotel;
    if (!hotel) {
      return res.status(400).json({ message: 'Hotel ID is required' });
    }

    const roomData = { ...req.body, hotel };
    const room = new Room(roomData);
    await room.save();
    return res.status(201).json(room);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ message: 'Room number already exists in this hotel' });
    }
    return res.status(400).json({ message: err.message });
  }
};

exports.getAllRooms = async (req, res) => {
  try {
    const filter = {};
    if (req.user.role !== ROLES.SUPER_ADMIN) {
      filter.hotel = req.user.hotel;
    } else if (req.query.hotelId) {
      filter.hotel = req.query.hotelId;
    }

    const rooms = await Room.find(filter).sort({ number: 1 });
    return res.json(rooms);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

exports.getRoomById = async (req, res) => {
  try {
    const room = await Room.findById(req.params.id);
    if (!room) return res.status(404).json({ message: 'Room not found' });

    // Authorization check
    if (req.user.role !== ROLES.SUPER_ADMIN && room.hotel.toString() !== req.user.hotel.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }

    return res.json(room);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

exports.updateRoom = async (req, res) => {
  try {
    const { id } = req.params;
    const room = await Room.findById(id);
    if (!room) return res.status(404).json({ message: 'Room not found' });

    // Authorization check
    if (req.user.role !== ROLES.SUPER_ADMIN && room.hotel.toString() !== req.user.hotel.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const updatedRoom = await Room.findByIdAndUpdate(
      id,
      req.body,
      { new: true, runValidators: true }
    );

    return res.json(updatedRoom);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ message: 'Room number already exists in this hotel' });
    }
    return res.status(400).json({ message: err.message });
  }
};

exports.deleteRoom = async (req, res) => {
  try {
    const { id } = req.params;
    const room = await Room.findById(id);
    if (!room) return res.status(404).json({ message: 'Room not found' });

    // Authorization check
    if (req.user.role !== ROLES.SUPER_ADMIN && room.hotel.toString() !== req.user.hotel.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }

    await Room.findByIdAndDelete(id);
    return res.json({ message: 'Room deleted successfully' });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};
*/