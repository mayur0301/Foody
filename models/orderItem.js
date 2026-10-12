const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  dish: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Dish',
    required: true
  },
  name: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1 },
  price: { type: Number, required: true, min: 0 },
  total: { type: Number, required: true }
}, { _id: false });

const orderSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  // 🔹 Customer snapshot
  customer: {
    name: { type: String, default: null },
    phone: { type: String, default: null }
  },

  /*
  booking: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking'
  },
  */

  // roomNumber: String,

  items: {
    type: [orderItemSchema],
    required: true
  },

  // 🔹 Amount breakdown
  subTotal: {
    type: Number,
    required: true,
    min: 0
  },

  gstTotal: {
    type: Number,
    required: true,
    min: 0
  },

  grandTotal: {
    type: Number,
    required: true,
    min: 0
  },

  notes: String,

  orderedAt: {
    type: Date,
    default: Date.now
  },

  hotel: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Hotel',
    required: true
  },
  channel: {
    type: String,
    enum: ['dine-in', 'takeaway', 'zomato', 'swiggy', 'other'],
    default: 'dine-in'
  },
  marginAmount: {
    type: Number,
    default: 0
  },
  isFree: {
    type: Boolean,
    default: false
  },
  status: {
    type: String,
    enum: ['pending', 'preparing', 'ready', 'delivered', 'cancelled', 'paid', 'billed'],
    default: 'pending'
  }

}, { timestamps: true });

module.exports = mongoose.model('Order', orderSchema);
