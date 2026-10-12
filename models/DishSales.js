const mongoose = require('mongoose');

const dishSalesSchema = new mongoose.Schema({
    dish: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Dish',
        required: true
    },
    hotel: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Hotel',
        required: true
    },
    totalQuantitySold: {
        type: Number,
        default: 0,
        min: 0
    }
}, { timestamps: true });

// One sales record per dish per hotel
dishSalesSchema.index({ dish: 1, hotel: 1 }, { unique: true });

module.exports = mongoose.model('DishSales', dishSalesSchema);
