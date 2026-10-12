// models/Subscription.js
const mongoose = require('mongoose');

const SUBSCRIPTION_STATUS = ['TRIALING', 'UPCOMING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED'];

const subscriptionSchema = new mongoose.Schema(
  {
    hotel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Hotel',
      required: true,
    },
    plan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Plan',
      required: true,
    },
    status: {
      type: String,
      enum: SUBSCRIPTION_STATUS,
      default: 'ACTIVE',
    },

    // ── Dates ──
    startDate: {
      type: Date,
      required: true,
      default: Date.now,
    },
    endDate: {
      type: Date,
      required: true,
    },
    trialEndDate: {
      type: Date,
      default: null,
    },
    cancelAtPeriodEnd: {
      type: Boolean,
      default: false,
    },

    // ── Razorpay Integration ──
    razorpaySubscriptionId: {
      type: String,
      default: null,
    },
    razorpayCustomerId: {
      type: String,
      default: null,
    },

    // ── Metadata ──
    cancelledAt: {
      type: Date,
      default: null,
    },
    cancelReason: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

// Ensure only ONE active subscription per hotel at any time
subscriptionSchema.index(
  { hotel: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['ACTIVE', 'TRIALING', 'UPCOMING'] } },
  }
);

module.exports = mongoose.model('Subscription', subscriptionSchema);
