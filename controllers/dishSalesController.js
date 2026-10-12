const DishSales = require('../models/DishSales');
const mongoose = require('mongoose');
const { ROLES } = require('../utils/constants');
const getPagination = require('../utils/pagination');

// @desc    Get Dish Sales for current hotel (Admin / Staff)
// @route   GET /api/dish-sales
// @access  Private (Hotel Admin / Staff)
exports.getDishSales = async (req, res) => {
    try {
        const hotelId = req.user.hotel;

        if (!hotelId) {
            return res.status(400).json({
                success: false,
                message: 'No hotel linked to your account'
            });
        }

        const totalItems = await DishSales.countDocuments({ hotel: hotelId });
        const { skip, limit, meta } = getPagination(req.query, totalItems);

        const sales = await DishSales.find({ hotel: hotelId })
            .sort({ totalQuantitySold: -1 })
            .skip(skip)
            .limit(limit)
            .populate('dish', 'name price type category isAvailable')
            .lean();

        res.status(200).json({
            success: true,
            pagination: meta,
            data: sales
        });

    } catch (err) {
        console.error('Get Dish Sales Error:', err);
        res.status(500).json({
            success: false,
            message: 'Internal Server Error'
        });
    }
};

// @desc    Get Dish Sales by Hotel ID (Super Admin)
// @route   GET /api/dish-sales/hotel/:hotelId
// @access  Private (Super Admin Only)
exports.getDishSalesByHotel = async (req, res) => {
    try {
        const { hotelId } = req.params;

        if (!hotelId || !mongoose.Types.ObjectId.isValid(hotelId)) {
            return res.status(400).json({
                success: false,
                message: 'Valid Hotel ID is required'
            });
        }

        const totalItems = await DishSales.countDocuments({ hotel: hotelId });
        const { skip, limit, meta } = getPagination(req.query, totalItems);

        const sales = await DishSales.find({ hotel: hotelId })
            .sort({ totalQuantitySold: -1 })
            .skip(skip)
            .limit(limit)
            .populate('dish', 'name price type category isAvailable')
            .lean();

        res.status(200).json({
            success: true,
            hotel: hotelId,
            pagination: meta,
            data: sales
        });

    } catch (err) {
        console.error('Get Dish Sales By Hotel Error:', err);
        res.status(500).json({
            success: false,
            message: 'Internal Server Error'
        });
    }
};
