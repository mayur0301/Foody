const mongoose = require('mongoose')
const Dish = require('../models/Dish')
const Category = require('../models/Category')
const CategoryInventory = require('../models/CategoryInventory')
const Order = require('../models/orderItem')
const XLSX = require('xlsx')
const { ROLES } = require('../utils/constants')
const getPagination = require('../utils/pagination')

// CREATE
exports.createDish = async (req, res) => {
    try {
        const name = req.body.name.toLowerCase()
        const { price, category, isAvailable, type, hotelId } = req.body
        const hotel = req.user.role === ROLES.SUPER_ADMIN ? hotelId : req.user.hotel

        if (!hotel) {
            return res.status(400).json({ message: 'Hotel ID is required' })
        }

        if (!category || !mongoose.Types.ObjectId.isValid(category)) {
            return res.status(400).json({ message: 'A valid Category ID is required' })
        }

        const categoryExists = await Category.findOne({ _id: category, hotel })
        if (!categoryExists) {
            return res.status(404).json({ message: 'Category not found in your hotel' })
        }

        const dish = await Dish.create({
            name,
            price,
            category,
            isAvailable,
            type,
            hotel
        })

        // 🔥 increment dish count
        categoryExists.dishCount += 1
        await categoryExists.save()

        res.status(201).json(dish)
    } catch (error) {
        console.log(error.message);

        if (error.code === 11000) {
            return res.status(400).json({
                message: 'Dish already exists in this category'
            })
        }

        res.status(500).json({ message: 'Something went wrong' })
    }
}


// BULK UPLOAD FROM EXCEL
exports.bulkUploadDishes = async (req, res) => {
    try {
        const hotel = req.user.role === ROLES.SUPER_ADMIN ? req.body.hotelId : req.user.hotel

        if (!hotel) {
            return res.status(400).json({ success: false, message: 'Hotel ID is required' })
        }

        const { categoryId } = req.body
        if (!categoryId || !mongoose.Types.ObjectId.isValid(categoryId)) {
            return res.status(400).json({ success: false, message: 'A valid Category ID is required in form-data' })
        }

        // 1. Validate Category belongs to this hotel
        const category = await Category.findOne({ _id: categoryId, hotel })
        if (!category) {
            return res.status(404).json({ success: false, message: 'Category not found in this hotel' })
        }

        // Check if file is uploaded
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Please upload an Excel file' })
        }

        // Read the Excel file
        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' })
        const sheetName = workbook.SheetNames[0]
        const worksheet = workbook.Sheets[sheetName]

        // Convert to JSON
        const data = XLSX.utils.sheet_to_json(worksheet)

        if (!data || data.length === 0) {
            return res.status(400).json({ success: false, message: 'Excel file is empty' })
        }

        const results = {
            success: [],
            failed: [],
            skipped: []
        }

        let successCount = 0

        // Process each row
        for (let i = 0; i < data.length; i++) {
            const row = data[i]
            const rowNumber = i + 2 // Excel row number (accounting for header)

            try {
                // 2. Validate required fields
                if (!row.name || !row.price || !row.type) {
                    results.failed.push({
                        row: rowNumber,
                        data: row,
                        reason: 'Missing required fields (name, price, or type)'
                    })
                    continue
                }

                // 3. Validate type
                const dishType = row.type.toLowerCase().trim()
                if (dishType !== 'veg' && dishType !== 'non-veg') {
                    results.failed.push({
                        row: rowNumber,
                        data: row,
                        reason: `Invalid type "${row.type}". Must be "veg" or "non-veg"`
                    })
                    continue
                }

                // 4. Validate price
                const price = parseFloat(row.price)
                if (isNaN(price) || price < 0) {
                    results.failed.push({
                        row: rowNumber,
                        data: row,
                        reason: `Invalid price "${row.price}". Must be a positive number`
                    })
                    continue
                }

                // 5. Handle isAvailable
                let isAvailable = true
                if (row.isAvailable !== undefined && row.isAvailable !== null) {
                    const availableStr = String(row.isAvailable).toLowerCase().trim()
                    isAvailable = availableStr === 'true' || availableStr === 'yes' || availableStr === '1'
                }

                const dishName = row.name.toLowerCase().trim()

                // 6. Create dish
                const dish = await Dish.create({
                    name: dishName,
                    price: price,
                    category: categoryId,
                    isAvailable: isAvailable,
                    type: dishType,
                    hotel: hotel
                })

                successCount++

                results.success.push({
                    row: rowNumber,
                    dish: {
                        id: dish._id,
                        name: dish.name
                    }
                })

            } catch (error) {
                if (error.code === 11000) {
                    results.skipped.push({
                        row: rowNumber,
                        data: row,
                        reason: 'Dish already exists in this category'
                    })
                } else {
                    results.failed.push({
                        row: rowNumber,
                        data: row,
                        reason: error.message
                    })
                }
            }
        }

        // 7. Update category dish count
        if (successCount > 0) {
            category.dishCount += successCount
            await category.save()
        }

        res.status(200).json({
            success: true,
            message: 'Bulk upload completed',
            summary: {
                totalRows: data.length,
                success: results.success.length,
                failed: results.failed.length,
                skipped: results.skipped.length,
                category: category.name
            },
            results
        })

    } catch (error) {
        console.error('Bulk Upload Error:', error)
        res.status(500).json({ success: false, message: 'Internal Server Error' })
    }
}

// READ ALL (Hotel Context - Admin/Staff/Customer)
exports.getDishes = async (req, res) => {
    try {
        const filter = {}
        if (req.user.role !== ROLES.SUPER_ADMIN) {
            filter.hotel = req.user.hotel
        } else if (req.query.hotelId) {
            filter.hotel = req.query.hotelId
        }

        /**
         * 📦 Out-of-Stock Filter
         * If `excludeOutOfStock=true` is passed, exclude dishes from categories with 0 stock.
         * This is opt-in to maintain backward compatibility.
         */
        if (req.query.excludeOutOfStock === 'true' && filter.hotel) {
            const outOfStockCategories = await CategoryInventory.find({
                hotel: filter.hotel,
                totalStock: { $lte: 0 }
            }).select('category').lean();

            const outOfStockCategoryIds = outOfStockCategories.map(inv => inv.category);

            if (outOfStockCategoryIds.length > 0) {
                filter.category = { $nin: outOfStockCategoryIds };
            }
        }

        const totalDishes = await Dish.countDocuments(filter)
        const { skip, limit, meta } = getPagination(req.query, totalDishes)

        const dishes = await Dish.find(filter)
            .populate('category')
            .sort({ name: 1 })
            .skip(skip)
            .limit(limit)

        res.json({
            success: true,
            pagination: meta,
            data: dishes
        })
    } catch (error) {
        res.status(500).json({ message: error.message })
    }
}

// GET ALL (Global - Super Admin)
exports.getAllDishes = async (req, res) => {
    try {
        const totalDishes = await Dish.countDocuments()
        const { skip, limit, meta } = getPagination(req.query, totalDishes)

        const dishes = await Dish.find()
            .populate('category')
            .populate('hotel')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)

        res.json({
            success: true,
            pagination: meta,
            data: dishes
        })
    } catch (error) {
        res.status(500).json({ message: error.message })
    }
}

// GET BY HOTEL (Filtered - Super Admin or relevant Hotel Admin)
exports.getDishesByHotel = async (req, res) => {
    try {
        const { hotelId } = req.params

        // Authorization: Super Admin or matching Hotel Admin
        if (req.user.role !== ROLES.SUPER_ADMIN && req.user.hotel.toString() !== hotelId) {
            return res.status(403).json({ message: 'Unauthorized access to this hotel data' })
        }

        const totalDishes = await Dish.countDocuments({ hotel: hotelId })
        const { skip, limit, meta } = getPagination(req.query, totalDishes)

        const dishes = await Dish.find({ hotel: hotelId })
            .populate('category')
            .sort({ name: 1 })
            .skip(skip)
            .limit(limit)

        res.json({
            success: true,
            pagination: meta,
            data: dishes
        })
    } catch (error) {
        res.status(500).json({ message: error.message })
    }
}


// UPDATE
// exports.updateDish = async (req, res) => {
//     try {
//         const { id } = req.params;

//         const dish = await Dish.findById(id);
//         if (!dish) {
//             return res.status(404).json({ message: 'Dish not found' });
//         }

//         // Authorization check
//         if (req.user.role !== ROLES.SUPER_ADMIN && dish.hotel.toString() !== req.user.hotel.toString()) {
//             return res.status(403).json({ message: 'You do not have permission to update this dish' });
//         }

//         // Update fields if provided
//         if (req.body.name) {
//             dish.name = req.body.name.toLowerCase();
//         }

//         if (req.body.price !== undefined) {
//             dish.price = req.body.price;
//         }

//         if (req.body.isAvailable !== undefined) {
//             dish.isAvailable = req.body.isAvailable;
//         }

//         if (req.body.category && req.body.category.toString() !== dish.category.toString()) {
//             if (!mongoose.Types.ObjectId.isValid(req.body.category)) {
//                 return res.status(400).json({ message: 'Invalid Category ID format' });
//             }

//             const hotelId = req.user.role === ROLES.SUPER_ADMIN ? (req.body.hotelId || dish.hotel) : req.user.hotel
//             const newCategory = await Category.findOne({ _id: req.body.category, hotel: hotelId });
//             if (!newCategory) {
//                 return res.status(404).json({ message: 'Category not found in this hotel' });
//             }

//             // Update Dish Counts
//             // 1. Decrement old category
//             await Category.findByIdAndUpdate(dish.category, { $inc: { dishCount: -1 } });
//             // 2. Increment new category
//             newCategory.dishCount += 1;
//             await newCategory.save();

//             dish.category = req.body.category;
//         }

//         await dish.save();

//         return res.json({
//             success: true,
//             message: 'Dish updated successfully',
//             data: dish
//         });

//     } catch (error) {
//         console.error('Update dish error:', error);

//         // Duplicate key error (unique index)
//         if (error.code === 11000) {
//             return res.status(400).json({
//                 message: 'Dish with same name already exists in this category'
//             });
//         }

//         return res.status(500).json({
//             message: 'Something went wrong',
//             error: error.message
//         });
//     }
// };
exports.updateDish = async (req, res) => {
    try {
        const { id } = req.params;

        const dish = await Dish.findById(id);
        if (!dish) {
            return res.status(404).json({ message: 'Dish not found' });
        }

        // Authorization check
        if (
            req.user.role !== ROLES.SUPER_ADMIN &&
            dish.hotel.toString() !== req.user.hotel.toString()
        ) {
            return res.status(403).json({
                message: 'You do not have permission to update this dish'
            });
        }

        // Update name
        if (req.body.name) {
            dish.name = req.body.name.toLowerCase();
        }

        // Update price
        if (req.body.price !== undefined) {
            dish.price = req.body.price;
        }

        // ✅ Update type (NEW)
        if (req.body.type !== undefined) {
            const allowedTypes = ['veg', 'non-veg'];

            if (!allowedTypes.includes(req.body.type)) {
                return res.status(400).json({
                    message: 'Invalid dish type. Allowed values: veg, non-veg'
                });
            }

            dish.type = req.body.type;
        }

        // Update availability
        if (req.body.isAvailable !== undefined) {
            dish.isAvailable = req.body.isAvailable;
        }

        // Update category
        if (
            req.body.category &&
            req.body.category.toString() !== dish.category.toString()
        ) {
            if (!mongoose.Types.ObjectId.isValid(req.body.category)) {
                return res.status(400).json({
                    message: 'Invalid Category ID format'
                });
            }

            const hotelId =
                req.user.role === ROLES.SUPER_ADMIN
                    ? (req.body.hotelId || dish.hotel)
                    : req.user.hotel;

            const newCategory = await Category.findOne({
                _id: req.body.category,
                hotel: hotelId
            });

            if (!newCategory) {
                return res.status(404).json({
                    message: 'Category not found in this hotel'
                });
            }

            // Update Dish Counts
            await Category.findByIdAndUpdate(dish.category, {
                $inc: { dishCount: -1 }
            });

            newCategory.dishCount += 1;
            await newCategory.save();

            dish.category = req.body.category;
        }

        await dish.save();

        return res.json({
            success: true,
            message: 'Dish updated successfully',
            data: dish
        });

    } catch (error) {
        console.error('Update dish error:', error);

        if (error.code === 11000) {
            return res.status(400).json({
                message: 'Dish with same name already exists in this category'
            });
        }

        return res.status(500).json({
            message: 'Something went wrong',
            error: error.message
        });
    }
};

// DELETE (hard delete)
// exports.deleteDish = async (req, res) => {
//     const { id } = req.params

//     const dish = await Dish.findById(id)
//     if (!dish) {
//         return res.status(404).json({ message: 'Dish not found' })
//     }

//     const category = await Category.findById(dish.category)

//     await dish.deleteOne()

//     // 🔥 decrement dish count
//     if (category && category.dishCount > 0) {
//         category.dishCount -= 1
//         await category.save()
//     }

//     res.json({ message: 'Dish deleted' })
// }
exports.deleteDish = async (req, res) => {
    const { id } = req.params

    const dish = await Dish.findById(id)
    if (!dish) {
        return res.status(404).json({ message: 'Dish not found' })
    }

    // Authorization check
    if (req.user.role !== ROLES.SUPER_ADMIN && dish.hotel.toString() !== req.user.hotel.toString()) {
        return res.status(403).json({ message: 'You do not have permission to delete this dish' });
    }

    // 🔒 SAFETY CHECK

    // 1. Check for Active Orders (Blocker)
    const activeOrderExists = await Order.exists({
        'items.dish': id,
        status: { $in: ['pending', 'preparing', 'ready'] }
    });

    if (activeOrderExists) {
        return res.status(400).json({
            success: false,
            message: 'Dish is used in active orders and cannot be deleted. Please complete or cancel those orders first.'
        });
    }

    // 2. Check for Order History (Data Integrity)
    const historicOrderExists = await Order.exists({
        'items.dish': id
    });

    if (historicOrderExists) {
        return res.status(400).json({
            success: false,
            message: 'Dish has order history and cannot be deleted to preserve records. Please mark it as "Unavailable" instead.'
        });
    }

    // update category dishCount
    await Category.findByIdAndUpdate(dish.category, { $inc: { dishCount: -1 } });

    await dish.deleteOne()

    res.json({
        success: true,
        message: 'Dish deleted successfully'
    })
}


exports.getDishesByCategory = async (req, res) => {
    const { categoryId } = req.params

    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
        return res.status(400).json({ success: false, message: 'Invalid Category ID format' });
    }

    const filter = { category: categoryId }

    if (req.user.role !== ROLES.SUPER_ADMIN) {
        filter.hotel = req.user.hotel
    } else if (req.query.hotelId) {
        filter.hotel = req.query.hotelId
    }

    const totalDishes = await Dish.countDocuments(filter)
    const { skip, limit, meta } = getPagination(req.query, totalDishes)

    const dishes = await Dish.find(filter)
        .populate('category', 'name')
        .skip(skip)
        .limit(limit)

    res.json({
        success: true,
        pagination: meta,
        data: dishes
    })
}
