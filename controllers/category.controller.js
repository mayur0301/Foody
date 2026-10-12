const mongoose = require('mongoose')
const Category = require('../models/Category')
const Dish = require('../models/Dish')
const AppError = require('../utils/AppError')
const { ROLES } = require('../utils/constants')
const getPagination = require('../utils/pagination')
// const catchAsync = require('../utils/catchAsync')

// CREATE
exports.createCategory = async (req, res, next) => {
  try {
    if (!req.body.name) {
      return next(new AppError('Category name is required', 400))
    }
    const name = req.body.name.toLowerCase()
    const hotelId = req.user.role === ROLES.SUPER_ADMIN ? req.body.hotelId : req.user.hotel

    if (!hotelId || !mongoose.Types.ObjectId.isValid(hotelId)) {
      return next(new AppError('A valid Hotel ID is required', 400))
    }

    const existing = await Category.findOne({ name, hotel: hotelId })
    if (existing) {
      return next(new AppError('Category already exists in this hotel', 400))
    }

    // Accept optional StockManagement flag (defaults to false via schema)
    const stockManagement = req.body.stockManagement === true

    const category = await Category.create({
      name,
      hotel: hotelId,
      StockManagement: stockManagement
    })

    res.status(201).json({
      success: true,
      data: category
    })
  } catch (error) {
    next(new AppError(error.message, 500))
  }
}

// READ ALL (Hotel Context - Admin/Staff/Customer)
exports.getCategories = async (req, res, next) => {
  try {
    const filter = {}
    if (req.user.role !== ROLES.SUPER_ADMIN) {
      filter.hotel = req.user.hotel
    } else if (req.query.hotelId) {
      filter.hotel = req.query.hotelId
    }

    if (req.query.search) {
      filter.name = { $regex: req.query.search, $options: 'i' }
    }

    const totalCategories = await Category.countDocuments(filter)
    const { skip, limit, meta } = getPagination(req.query, totalCategories)

    const categories = await Category.find(filter)
      .populate('hotel')
      .sort({ name: 1 })
      .skip(skip)
      .limit(limit)

    res.status(200).json({
      success: true,
      pagination: meta,
      data: categories
    })
  } catch (error) {
    next(new AppError(error.message, 500))
  }
}

// GET ALL (Global - Super Admin)
exports.getAllCategories = async (req, res, next) => {
  try {
    const filter = {}
    if (req.query.search) {
      filter.name = { $regex: req.query.search, $options: 'i' }
    }

    const totalCategories = await Category.countDocuments(filter)
    const { skip, limit, meta } = getPagination(req.query, totalCategories)

    const categories = await Category.find(filter)
      .populate('hotel')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)

    res.status(200).json({
      success: true,
      pagination: meta,
      data: categories
    })
  } catch (error) {
    next(new AppError(error.message, 500))
  }
}

// GET BY HOTEL (Filtered - Super Admin or specific Hotel Admin)
exports.getCategoriesByHotel = async (req, res, next) => {
  try {
    const { hotelId } = req.params

    // Authorization: Super Admin or matching Hotel Admin
    if (req.user.role !== ROLES.SUPER_ADMIN && req.user.hotel.toString() !== hotelId) {
      return next(new AppError('Unauthorized access to this hotel data', 403))
    }

    const filter = { hotel: hotelId }
    if (req.query.search) {
      filter.name = { $regex: req.query.search, $options: 'i' }
    }

    const totalCategories = await Category.countDocuments(filter)
    const { skip, limit, meta } = getPagination(req.query, totalCategories)

    const categories = await Category.find(filter)
      .populate('hotel')
      .sort({ name: 1 })
      .skip(skip)
      .limit(limit)

    res.status(200).json({
      success: true,
      pagination: meta,
      data: categories
    })
  } catch (error) {
    next(new AppError(error.message, 500))
  }
}

// UPDATE
exports.updateCategory = async (req, res, next) => {
  try {
    const { id } = req.params;

    // 0. Validate ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: `Invalid Category ID structure: ${id}`
      });
    }

    if (!req.body.name) {
      return res.status(400).json({
        success: false,
        message: 'Category name is required'
      });
    }

    const name = req.body.name.toLowerCase();

    // 1. Find the category
    const category = await Category.findById(id);
    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    // 2. Authorization check
    if (req.user.role !== ROLES.SUPER_ADMIN && category.hotel.toString() !== req.user.hotel.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update this category'
      });
    }

    // 3. Update fields
    category.name = name;

    // 4. Update StockManagement flag if provided
    if (req.body.stockManagement !== undefined) {
      category.StockManagement = req.body.stockManagement === true;
    }

    await category.save();

    res.status(200).json({
      success: true,
      data: category
    });
  } catch (error) {
    next(new AppError(error.message, 500));
  }
};

// DELETE
exports.deleteCategory = async (req, res, next) => {
  try {
    const { id } = req.params

    // 0. Validate ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: `Invalid Category ID format: ${id}`
      });
    }

    const category = await Category.findById(id)
    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    // Authorization check
    if (req.user.role !== ROLES.SUPER_ADMIN && category.hotel.toString() !== req.user.hotel.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete this category'
      });
    }

    // 🔒 SAFETY CHECK: Prevent deletion if category has dishes
    const dishExists = await Dish.exists({ category: id });

    if (dishExists) {
      const dishCount = await Dish.countDocuments({ category: id });
      return res.status(400).json({
        success: false,
        message: `Deletion failed. This category is currently linked to ${dishCount} dishes. Please remove or reassign the dishes first.`
      });
    }

    await category.deleteOne()

    res.status(200).json({
      success: true,
      message: 'Category deleted successfully'
    })
  } catch (error) {
    next(new AppError(error.message, 500))
  }
}
