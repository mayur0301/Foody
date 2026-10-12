/*
const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
  number: { type: String, required: true, trim: true },
  type: { type: String, required: true },
  price: { type: Number, required: true, min: 0 },
  status: { type: String, enum: ['available', 'booked', 'maintenance'], default: 'available' },
  hotel: { type: mongoose.Schema.Types.ObjectId, ref: 'Hotel', required: true }
}, { timestamps: true });

// Ensure room number is unique per hotel
roomSchema.index({ number: 1, hotel: 1 }, { unique: true });

module.exports = mongoose.model('Room', roomSchema);
*/