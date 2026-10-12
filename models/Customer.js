const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  phone: {
    type: String,
    required: true,
    trim: true
  },
  hotel: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Hotel',
    required: true,
    index: true
  },
  lastVisit: {
    type: Date,
    default: Date.now
  },
  totalOrders: {
    type: Number,
    default: 0
  },
  totalSpent: {
    type: Number,
    default: 0
  }
}, { timestamps: true });

// Ensure unique phone number PER hotel (a user can be a customer at different hotels)
customerSchema.index({ phone: 1, hotel: 1 }, { unique: true });

module.exports = mongoose.model('Customer', customerSchema);
