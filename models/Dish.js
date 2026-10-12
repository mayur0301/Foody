const mongoose = require('mongoose')

const dishSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      lowercase: true
    },
    price: {
      type: Number,
      required: true,
      min: 0
    },
    type: {
      type: String,
      enum: ['veg', 'non-veg'],
      required: true
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: true
    },
    isAvailable: {
      type: Boolean,
      default: true
    },
    hotel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Hotel',
      required: true
    }
  },
  { timestamps: true }
)

// prevent duplicate dish names inside same category of a specific hotel
dishSchema.index({ name: 1, category: 1, hotel: 1 }, { unique: true })

module.exports = mongoose.model('Dish', dishSchema)
