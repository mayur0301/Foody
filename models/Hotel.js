// models/Hotel.js
const mongoose = require('mongoose');

const hotelSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    address: String,
    city: String,
    country: String,
    phone: String,
    email: String,

    // The user who "owns" / administers this hotel
    admin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },

    // Optional: list of staff members (can be derived via query instead)
    // staff: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]

    status: {
      type: String,
      enum: ['pending', 'active', 'suspended'],
      default: 'pending'
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Hotel', hotelSchema);