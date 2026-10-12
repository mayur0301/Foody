// models/Plan.js
const mongoose = require('mongoose');

const planSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    planType: {
      type: String,
      enum: ['trial', 'main'],
      required: true,
    },
    description: {
      type: String,
      default: '',
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: 'INR',
      enum: ['INR', 'USD'],
    },
    billingCycle: {
      type: String,
      enum: ['MONTHLY', 'YEARLY', 'QUARTERLY', 'HALF_YEARLY', 'NONE'], // NONE for trials
      required: true,
    },
    trialDays: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // Razorpay mapping (if still used)
    razorpayPlanId: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Plan', planSchema);

