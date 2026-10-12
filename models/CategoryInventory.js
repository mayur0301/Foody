const mongoose = require('mongoose');

const categoryInventorySchema = new mongoose.Schema(
  {
    hotel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Hotel',
      required: true
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: true
    },
    totalStock: {
      type: Number,
      default: 0,
      min: 0
    },
    totalAdded: {
      type: Number,
      default: 0,
      min: 0
    },
    totalConsumed: {
      type: Number,
      default: 0,
      min: 0
    },
    lastUpdatedAt: {
      type: Date,
      default: Date.now
    }
  },
  { timestamps: true }
);

// Ensure one inventory record per category per hotel
categoryInventorySchema.index({ hotel: 1, category: 1 }, { unique: true });

module.exports = mongoose.model('CategoryInventory', categoryInventorySchema);
