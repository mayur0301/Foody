// models/Usage.js
const mongoose = require('mongoose');

const usageSchema = new mongoose.Schema(
  {
    subscription: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subscription',
      required: true,
    },
    hotel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Hotel',
      required: true,
    },
    metric: {
      type: String,
      required: true,
      // e.g. 'ORDERS_PLACED', 'SMS_SENT'
    },
    count: {
      type: Number,
      default: 0,
    },
    resetDate: {
      type: Date,
      required: true,
    },
  },
  { timestamps: true }
);

// One usage record per metric per subscription
usageSchema.index({ subscription: 1, metric: 1 }, { unique: true });

module.exports = mongoose.model('Usage', usageSchema);
