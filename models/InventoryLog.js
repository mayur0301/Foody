const mongoose = require('mongoose');

const inventoryLogSchema = new mongoose.Schema(
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
    type: {
      type: String,
      enum: ['ADD', 'CONSUME', 'RESTORE', 'ADJUST', 'STOCK_OUT'],
      required: true
    },
    quantity: {
      type: Number,
      required: true,
      min: 0
    },
    reference: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      default: null
    },
    notes: {
      type: String,
      default: ''
    }
  },
  { timestamps: true }
);

// Index for quick lookups by hotel and category
inventoryLogSchema.index({ hotel: 1, category: 1, createdAt: -1 });

module.exports = mongoose.model('InventoryLog', inventoryLogSchema);
