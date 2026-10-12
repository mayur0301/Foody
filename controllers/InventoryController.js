const mongoose = require('mongoose');
const CategoryInventory = require('../models/CategoryInventory');
const InventoryLog = require('../models/InventoryLog');
const Category = require('../models/Category');
const { ROLES } = require('../utils/constants');
const getPagination = require('../utils/pagination');

/* ═══════════════════════════════════════════
   ADD STOCK
   ═══════════════════════════════════════════ */

/**
 * @desc    Add stock to a category's inventory
 * @route   POST /api/inventory/add
 * @access  HOTEL_ADMIN, SUPER_ADMIN
 * @body    { categoryId, quantity }
 */
exports.addStock = async (req, res) => {
  try {
    const { categoryId, quantity } = req.body;
    const hotelId = req.user.role === ROLES.SUPER_ADMIN ? req.body.hotelId : req.user.hotel;

    if (!hotelId) {
      return res.status(400).json({ success: false, message: 'Hotel ID is required' });
    }

    if (!categoryId || !mongoose.Types.ObjectId.isValid(categoryId)) {
      return res.status(400).json({ success: false, message: 'Valid Category ID is required' });
    }

    if (!quantity || quantity < 1) {
      return res.status(400).json({ success: false, message: 'Quantity must be at least 1' });
    }

    // Validate category belongs to this hotel
    const category = await Category.findOne({ _id: categoryId, hotel: hotelId });
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found in your hotel' });
    }

    // Guard: Only allow stock operations on categories with StockManagement enabled
    if (!category.StockManagement) {
      return res.status(400).json({
        success: false,
        message: `Stock management is not enabled for category '${category.name}'. Please enable it first by updating the category.`
      });
    }

    // Atomic upsert: create if not exists, increment if exists
    const inventory = await CategoryInventory.findOneAndUpdate(
      { hotel: hotelId, category: categoryId },
      {
        $inc: { totalStock: quantity, totalAdded: quantity },
        $set: { lastUpdatedAt: new Date() }
      },
      { upsert: true, new: true }
    );

    // Log the addition
    await InventoryLog.create({
      hotel: hotelId,
      category: categoryId,
      type: 'ADD',
      quantity,
      notes: `Added ${quantity} plates to ${category.name}`
    });

    res.status(200).json({
      success: true,
      message: `${quantity} plates added to '${category.name}' inventory`,
      data: {
        categoryId: inventory.category,
        categoryName: category.name,
        totalStock: inventory.totalStock,
        totalAdded: inventory.totalAdded,
        totalConsumed: inventory.totalConsumed
      }
    });
  } catch (err) {
    console.error('addStock error:', err);
    res.status(500).json({ success: false, message: 'Failed to add stock' });
  }
};

/* ═══════════════════════════════════════════
   ADJUST STOCK (Manual Override)
   ═══════════════════════════════════════════ */

/**
 * @desc    Manually adjust (set) stock for a category (e.g., physical count correction)
 * @route   POST /api/inventory/adjust
 * @access  HOTEL_ADMIN, SUPER_ADMIN
 * @body    { categoryId, newStock }
 */
exports.adjustStock = async (req, res) => {
  try {
    const { categoryId, newStock } = req.body;
    const hotelId = req.user.role === ROLES.SUPER_ADMIN ? req.body.hotelId : req.user.hotel;

    if (!hotelId) {
      return res.status(400).json({ success: false, message: 'Hotel ID is required' });
    }

    if (!categoryId || !mongoose.Types.ObjectId.isValid(categoryId)) {
      return res.status(400).json({ success: false, message: 'Valid Category ID is required' });
    }

    if (newStock === undefined || newStock < 0) {
      return res.status(400).json({ success: false, message: 'newStock must be a non-negative number' });
    }

    const category = await Category.findOne({ _id: categoryId, hotel: hotelId });
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found in your hotel' });
    }

    // Guard: Only allow stock operations on categories with StockManagement enabled
    if (!category.StockManagement) {
      return res.status(400).json({
        success: false,
        message: `Stock management is not enabled for category '${category.name}'. Please enable it first by updating the category.`
      });
    }

    const current = await CategoryInventory.findOne({ hotel: hotelId, category: categoryId });
    const oldStock = current ? current.totalStock : 0;
    const difference = newStock - oldStock;

    const inventory = await CategoryInventory.findOneAndUpdate(
      { hotel: hotelId, category: categoryId },
      {
        $set: { totalStock: newStock, lastUpdatedAt: new Date() },
        // If adjusting up, track the addition
        ...(difference > 0 ? { $inc: { totalAdded: difference } } : {})
      },
      { upsert: true, new: true }
    );

    // Log the adjustment
    await InventoryLog.create({
      hotel: hotelId,
      category: categoryId,
      type: 'ADJUST',
      quantity: Math.abs(difference),
      notes: `Adjusted stock from ${oldStock} → ${newStock} (${difference >= 0 ? '+' : ''}${difference})`
    });

    res.status(200).json({
      success: true,
      message: `Stock for '${category.name}' adjusted to ${newStock}`,
      data: {
        categoryId: inventory.category,
        categoryName: category.name,
        previousStock: oldStock,
        newStock: inventory.totalStock,
        difference
      }
    });
  } catch (err) {
    console.error('adjustStock error:', err);
    res.status(500).json({ success: false, message: 'Failed to adjust stock' });
  }
};

/* ═══════════════════════════════════════════
   GET INVENTORY STATS (Dashboard)
   ═══════════════════════════════════════════ */

/**
 * @desc    Get inventory stats for all categories in a hotel
 * @route   GET /api/inventory
 * @access  HOTEL_ADMIN, STAFF, SUPER_ADMIN
 */
exports.getInventoryStats = async (req, res) => {
  try {
    const hotelId = req.user.role === ROLES.SUPER_ADMIN
      ? (req.query.hotelId || null)
      : req.user.hotel;

    if (!hotelId) {
      return res.status(400).json({ success: false, message: 'Hotel ID is required' });
    }

    const filter = { hotel: hotelId };

    // 1. Count ALL categories for this hotel (even those without inventory records yet)
    const totalItems = await Category.countDocuments(filter);
    const { skip, limit, meta } = getPagination(req.query, totalItems);

    // 2. Fetch categories with pagination
    const categories = await Category.find(filter)
      .sort({ name: 1 }) // Primary sort by name
      .skip(skip)
      .limit(limit)
      .lean();

    // 3. For the current page of categories, find associated inventory
    const categoryIds = categories.map(cat => cat._id);
    const inventoryRecords = await CategoryInventory.find({
      hotel: hotelId,
      category: { $in: categoryIds }
    }).lean();

    // Map records for fast lookup
    const invMap = new Map();
    inventoryRecords.forEach(inv => invMap.set(inv.category.toString(), inv));

    // 4. Summary totals (Global - across ALL categories in the hotel)
    const summaryResult = await CategoryInventory.aggregate([
      { $match: { hotel: new mongoose.Types.ObjectId(hotelId) } },
      {
        $group: {
          _id: null,
          totalStock: { $sum: '$totalStock' },
          totalAdded: { $sum: '$totalAdded' },
          totalConsumed: { $sum: '$totalConsumed' }
        }
      }
    ]);

    const summary = summaryResult.length > 0
      ? { totalStock: summaryResult[0].totalStock, totalAdded: summaryResult[0].totalAdded, totalConsumed: summaryResult[0].totalConsumed }
      : { totalStock: 0, totalAdded: 0, totalConsumed: 0 };

    res.status(200).json({
      success: true,
      summary,
      pagination: meta,
      data: categories.map(cat => {
        const inv = invMap.get(cat._id.toString());
        return {
          categoryId: cat._id,
          categoryName: cat.name,
          dishCount: cat.dishCount,
          stockManagement: cat.StockManagement === true,
          totalStock: inv ? inv.totalStock : 0,
          totalAdded: inv ? inv.totalAdded : 0,
          totalConsumed: inv ? inv.totalConsumed : 0,
          lastUpdatedAt: inv ? inv.lastUpdatedAt : null
        };
      })
    });
  } catch (err) {
    console.error('getInventoryStats error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch inventory stats' });
  }
};

/* ═══════════════════════════════════════════
   GET INVENTORY LOGS (Audit Trail)
   ═══════════════════════════════════════════ */

/**
 * @desc    Get inventory change logs
 * @route   GET /api/inventory/logs
 * @access  HOTEL_ADMIN, SUPER_ADMIN
 * @query   categoryId (optional), type (optional)
 */
exports.getInventoryLogs = async (req, res) => {
  try {
    const hotelId = req.user.role === ROLES.SUPER_ADMIN
      ? (req.query.hotelId || null)
      : req.user.hotel;

    if (!hotelId) {
      return res.status(400).json({ success: false, message: 'Hotel ID is required' });
    }

    const filter = { hotel: hotelId };
    if (req.query.categoryId) filter.category = req.query.categoryId;
    if (req.query.type) filter.type = req.query.type;

    // Fetch only the 10 most recent logs
    const logs = await InventoryLog.find(filter)
      .populate('category', 'name')
      .populate('reference', 'customer.name grandTotal')
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    res.status(200).json({
      success: true,
      count: logs.length,
      data: logs
    });
  } catch (err) {
    console.error('getInventoryLogs error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch inventory logs' });
  }
};

/* ═══════════════════════════════════════════
   GET INVENTORY OVERVIEW (Stats + Logs Combined)
   ═══════════════════════════════════════════ */

/**
 * @desc    Get both inventory stats and logs in a single call to reduce network requests
 * @route   GET /api/inventory/overview
 * @access  HOTEL_ADMIN, STAFF, SUPER_ADMIN
 */
exports.getInventoryOverview = async (req, res) => {
  try {
    const hotelId = req.user.role === ROLES.SUPER_ADMIN
      ? (req.query.hotelId || null)
      : req.user.hotel;

    if (!hotelId) {
      return res.status(400).json({ success: false, message: 'Hotel ID is required' });
    }

    // Date Filter Logic
    const dateQuery = {};
    if (req.query.startDate && req.query.endDate) {
      dateQuery.$gte = new Date(req.query.startDate);
      dateQuery.$lte = new Date(req.query.endDate);
    }

    const filter = { hotel: hotelId };

    // ── Stats Pagination (using getPagination utility) ──
    const totalStatsItems = await Category.countDocuments(filter);
    const statsPagination = getPagination(
      { page: req.query.statsPage, limit: req.query.statsLimit },
      totalStatsItems
    );

    const categoriesPromise = Category.find(filter)
      .sort({ name: 1 })
      .skip(statsPagination.skip)
      .limit(statsPagination.limit)
      .lean();

    // Base current stock summary (always lifetime/current)
    const summaryPromise = CategoryInventory.aggregate([
      { $match: { hotel: new mongoose.Types.ObjectId(hotelId) } },
      {
        $group: {
          _id: null,
          totalStock: { $sum: '$totalStock' },
          totalAdded: { $sum: '$totalAdded' },
          totalConsumed: { $sum: '$totalConsumed' }
        }
      }
    ]);

    // ── Logs Pagination (using getPagination utility) ──
    const logsFilter = { hotel: hotelId };
    if (req.query.logsCategoryId) logsFilter.category = req.query.logsCategoryId;
    if (req.query.logsType) logsFilter.type = req.query.logsType;
    if (dateQuery.$gte) logsFilter.createdAt = dateQuery;

    const totalLogsItems = await InventoryLog.countDocuments(logsFilter);
    const logsPagination = getPagination(
      { page: req.query.logsPage, limit: req.query.logsLimit },
      totalLogsItems
    );

    const logsDataPromise = InventoryLog.find(logsFilter)
      .populate('category', 'name')
      .populate('reference', 'customer.name grandTotal')
      .sort({ createdAt: -1 })
      .skip(logsPagination.skip)
      .limit(logsPagination.limit)
      .lean();

    // Time-filtered Aggregation (if dates provided)
    let timeAggPromise = Promise.resolve([]);
    if (dateQuery.$gte) {
       timeAggPromise = InventoryLog.aggregate([
         { $match: { hotel: new mongoose.Types.ObjectId(hotelId), createdAt: dateQuery } },
         {
           $group: {
             _id: '$category',
             added: { $sum: { $cond: [ { $in: ['$type', ['ADD', 'RESTORE']] }, '$quantity', 0 ] } },
             consumed: { $sum: { $cond: [ { $in: ['$type', ['CONSUME', 'STOCK_OUT']] }, '$quantity', 0 ] } }
           }
         }
       ]);
    }

    // Execute all independent queries concurrently
    const [categories, summaryResult, logsData, timeAggResult] = await Promise.all([
        categoriesPromise,
        summaryPromise,
        logsDataPromise,
        timeAggPromise
    ]);

    // Map stats to categories
    const categoryIds = categories.map(cat => cat._id);
    const inventoryRecords = await CategoryInventory.find({
      hotel: hotelId,
      category: { $in: categoryIds }
    }).lean();

    const invMap = new Map();
    inventoryRecords.forEach(inv => invMap.set(inv.category.toString(), inv));

    const timeAggMap = new Map();
    if (dateQuery.$gte) {
       timeAggResult.forEach(agg => timeAggMap.set(agg._id.toString(), agg));
    }

    let summary = { totalStock: 0, totalAdded: 0, totalConsumed: 0 };
    if (summaryResult.length > 0) {
       summary.totalStock = summaryResult[0].totalStock;
       if (!dateQuery.$gte) {
           summary.totalAdded = summaryResult[0].totalAdded;
           summary.totalConsumed = summaryResult[0].totalConsumed;
       } else {
           summary.totalAdded = timeAggResult.reduce((sum, item) => sum + item.added, 0);
           summary.totalConsumed = timeAggResult.reduce((sum, item) => sum + item.consumed, 0);
       }
    }

    const statsDataArray = categories.map(cat => {
        const inv = invMap.get(cat._id.toString());
        
        let finalAdded = inv ? inv.totalAdded : 0;
        let finalConsumed = inv ? inv.totalConsumed : 0;

        if (dateQuery.$gte) {
            const timeAgg = timeAggMap.get(cat._id.toString());
            finalAdded = timeAgg ? timeAgg.added : 0;
            finalConsumed = timeAgg ? timeAgg.consumed : 0;
        }

        return {
          categoryId: cat._id,
          categoryName: cat.name,
          dishCount: cat.dishCount,
          stockManagement: cat.StockManagement === true,
          totalStock: inv ? inv.totalStock : 0,
          totalAdded: finalAdded,
          totalConsumed: finalConsumed,
          lastUpdatedAt: inv ? inv.lastUpdatedAt : null
        };
    });

    res.status(200).json({
      success: true,
      stats: {
          summary,
          pagination: statsPagination.meta,
          data: statsDataArray
      },
      logs: {
          pagination: logsPagination.meta,
          data: logsData
      }
    });

  } catch (err) {
    console.error('getInventoryOverview error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch inventory overview' });
  }
};

