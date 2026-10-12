const mongoose = require('mongoose')

const categorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      lowercase: true
    },
    hotel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Hotel',
      required: true
    },
    dishCount: {
      type: Number,
      default: 0
    },
    StockManagement: {
      type: Boolean,
      default: false
    },
  },
  { timestamps: true }
)

// Ensure category name is unique per hotel
categorySchema.index({ name: 1, hotel: 1 }, { unique: true })

module.exports = mongoose.model('Category', categorySchema)
