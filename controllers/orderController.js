const Order = require('../models/orderItem');
const Dish = require('../models/Dish');
const Category = require('../models/Category');
const User = require('../models/User');
const Customer = require('../models/Customer');
const DishSales = require('../models/DishSales');
const CategoryInventory = require('../models/CategoryInventory');
const InventoryLog = require('../models/InventoryLog');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { ROLES } = require('../utils/constants');
const getPagination = require('../utils/pagination');
const buildFilter = require('../utils/queryFilter');

/* ═══════════════════════════════════════════
   INVENTORY HELPERS
   ═══════════════════════════════════════════ */

/**
 * Deduct stock for a list of category quantities.
 * Uses atomic $gte to prevent negative stock.
 * Only deducts for categories with StockManagement: true.
 * Returns { success, failedCategory } and tracks deducted categories for rollback.
 */
async function deductInventoryStock(hotelId, categoryQuantities, orderId, channel = 'dine-in', isFree = false) {
  const deducted = []; // Track successful deductions for rollback

  // Filter to only stock-managed categories
  const managedCategories = categoryQuantities.filter(cq => cq.stockManaged);

  for (const { categoryId, categoryName, totalQty } of managedCategories) {
    const result = await CategoryInventory.findOneAndUpdate(
      {
        hotel: hotelId,
        category: categoryId,
        totalStock: { $gte: totalQty } // Atomic: only if enough stock
      },
      {
        $inc: { totalStock: -totalQty, totalConsumed: totalQty },
        $set: { lastUpdatedAt: new Date() }
      },
      { new: true }
    );

    if (!result) {
      // ROLLBACK: Restore all previously deducted categories in this request
      for (const prev of deducted) {
        await CategoryInventory.findOneAndUpdate(
          { hotel: hotelId, category: prev.categoryId },
          {
            $inc: { totalStock: prev.totalQty, totalConsumed: -prev.totalQty },
            $set: { lastUpdatedAt: new Date() }
          }
        );
      }
      return { success: false, failedCategory: categoryName || categoryId };
    }

    deducted.push({ categoryId, totalQty });

    // Log the consumption
    const logType = ['zomato', 'swiggy', 'other'].includes(channel) ? 'STOCK_OUT' : 'CONSUME';
    let logNotes = `Consumed ${totalQty} plates for order`;
    if (channel === 'zomato') logNotes = `Stock out (Zomato): Consumed ${totalQty} plates`;
    else if (channel === 'swiggy') logNotes = `Stock out (Swiggy): Consumed ${totalQty} plates`;
    else if (channel === 'other') {
      logNotes = `Stock out (Other${isFree ? ' - Free' : ''}): Consumed ${totalQty} plates`;
    }

    await InventoryLog.create({
      hotel: hotelId,
      category: categoryId,
      type: logType,
      quantity: totalQty,
      reference: orderId,
      notes: logNotes
    });
  }

  return { success: true };
}

/**
 * Restore stock for all items in a cancelled order.
 * Only restores for categories with StockManagement: true.
 */
async function restoreInventoryStock(hotelId, items, orderId) {
  // Group items by category
  const categoryMap = new Map();
  for (const item of items) {
    const dish = await Dish.findById(item.dish).select('category').lean();
    if (!dish) continue;
    const catId = dish.category.toString();
    categoryMap.set(catId, (categoryMap.get(catId) || 0) + item.quantity);
  }

  for (const [categoryId, totalQty] of categoryMap) {
    // Only restore stock for categories with StockManagement enabled
    const category = await Category.findById(categoryId).select('StockManagement').lean();
    if (!category || !category.StockManagement) continue;

    await CategoryInventory.findOneAndUpdate(
      { hotel: hotelId, category: categoryId },
      {
        $inc: { totalStock: totalQty, totalConsumed: -totalQty },
        $set: { lastUpdatedAt: new Date() }
      }
    );

    await InventoryLog.create({
      hotel: hotelId,
      category: categoryId,
      type: 'RESTORE',
      quantity: totalQty,
      reference: orderId,
      notes: `Restored ${totalQty} plates from cancelled order`
    });
  }
}

/**
 * Groups validated items by category and returns an array of
 * { categoryId, categoryName, totalQty, stockManaged }.
 * The stockManaged flag is read from the Category model.
 */
async function groupItemsByCategory(items, hotelId) {
  const categoryMap = new Map();

  for (const item of items) {
    const dish = await Dish.findById(item.dish).select('category').lean();
    if (!dish) continue;
    const catId = dish.category.toString();
    if (!categoryMap.has(catId)) {
      const cat = await Category.findById(catId).select('name StockManagement').lean();
      categoryMap.set(catId, {
        categoryId: catId,
        categoryName: cat?.name || catId,
        totalQty: 0,
        stockManaged: cat?.StockManagement === true
      });
    }
    categoryMap.get(catId).totalQty += item.quantity;
  }

  return Array.from(categoryMap.values());
}

// Create Order
exports.createOrder = async (req, res) => {
  try {
    // 🔑 Authorization: Only Staff and Hotel Admin can create orders
    if (req.user.role !== ROLES.HOTEL_ADMIN && req.user.role !== ROLES.STAFF) {
      return res.status(403).json({
        success: false,
        message: 'Only Hotel Admins and Staff can create orders'
      });
    }

    const {
      items,
      roomNumber,
      notes,
      customerName,
      customerPhone,
      gstPercent = 0,
      channel = 'dine-in',
      marginAmount = 0,
      isFree = false
    } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        message: 'At least one item is required'
      });
    }

    // 🔹 Validate channel & margin/free flags
    const allowedChannels = ['dine-in', 'takeaway', 'zomato', 'swiggy', 'other'];
    const finalChannel = allowedChannels.includes(channel) ? channel : 'dine-in';

    const finalMarginAmount = typeof marginAmount === 'number' ? marginAmount : Number(marginAmount) || 0;
    const finalIsFree = isFree === true || isFree === 'true';

    // Channel specific validations
    if (finalChannel !== 'zomato' && finalChannel !== 'swiggy') {
      if (finalMarginAmount !== 0) {
        return res.status(400).json({
          success: false,
          message: 'Margin amount is only allowed for zomato and swiggy channels'
        });
      }
    }
    if (finalChannel !== 'other') {
      if (finalIsFree) {
        return res.status(400).json({
          success: false,
          message: 'Free stock-out option is only allowed for the other channel'
        });
      }
    }

    /**
     * 🔹 Customer Handling & Identity Sync
     */
    const cleanPhone = customerPhone ? String(customerPhone).trim() : null;
    const cleanName = customerName ? String(customerName).trim() : null;
    const hotelId = req.user.hotel;

    if (!hotelId) {
      return res.status(400).json({ message: 'Hotel reference missing for user' });
    }

    const hasCustomerDetails = !!cleanPhone;

    if (hasCustomerDetails) {
      let customerUser = await User.findOne({ phone: cleanPhone });

      // if (customerUser && customerUser.role !== ROLES.CUSTOMER) {
      //   return res.status(400).json({
      //     success: false,
      //     message: `Phone number ${cleanPhone} is already registered as ${customerUser.role}. Please use a different number.`
      //   });
      // }

      const syncName = cleanName || 'Guest';

      if (!customerUser) {
        // 🔑 Set default password for new customer
        const hashedPassword = await bcrypt.hash('123456', 10);

        customerUser = new User({
          username: cleanPhone,
          phone: cleanPhone,
          password: hashedPassword,
          role: ROLES.CUSTOMER,
          profile: {
            name: syncName
          },
          hotel: hotelId
        });

        await customerUser.save();
      } else {
        // Ensure profile exists and sync details
        if (!customerUser.profile) customerUser.profile = {};

        let needsUpdate = false;
        if (cleanName && customerUser.profile.name !== cleanName) {
          customerUser.profile.name = cleanName;
          needsUpdate = true;
        }

        // Also ensure they are linked to this hotel if they weren't
        if (!customerUser.hotel) {
          customerUser.hotel = hotelId;
          needsUpdate = true;
        }

        if (needsUpdate) {
          await customerUser.save();
        }
      }
    }

    /**
     * 🔹 Items Processing
     */
    let subTotal = 0;
    const validatedItems = [];
    for (const item of items) {
      if (!item.dishId || !item.quantity) {
        throw new Error('Each item must have a dishId and quantity');
      }

      const hotel = req.user.hotel;
      const dish = await Dish.findOne({ _id: item.dishId, hotel });
      if (!dish) {
        throw new Error(`Dish with ID ${item.dishId} not found or does not belong to your hotel`);
      }

      const itemTotal = finalIsFree ? 0 : item.quantity * dish.price;
      subTotal += itemTotal;

      validatedItems.push({
        dish: dish._id,
        name: dish.name,
        quantity: item.quantity,
        price: dish.price,
        total: itemTotal
      });
    }

    /**
     * 🔹 Inventory Stock Deduction (Category-Level)
     * Only categories with StockManagement: true will be checked and deducted.
     * Categories without StockManagement pass through freely.
     */
    const categoryQuantities = await groupItemsByCategory(validatedItems, hotelId);
    const stockResult = await deductInventoryStock(hotelId, categoryQuantities, null, finalChannel, finalIsFree);
    if (!stockResult.success) {
      return res.status(400).json({
        success: false,
        message: `Insufficient stock in category '${stockResult.failedCategory}'. Order rejected.`
      });
    }

    const gstTotal = finalIsFree ? 0 : (subTotal * gstPercent) / 100;
    const grandTotal = finalIsFree ? 0 : (subTotal + gstTotal + finalMarginAmount);

    const order = new Order({
      user: req.user.id,
      roomNumber,
      customer: {
        name: cleanName,
        phone: cleanPhone
      },
      items: validatedItems,
      subTotal,
      gstTotal,
      grandTotal,
      notes,
      hotel: hotelId,
      channel: finalChannel,
      marginAmount: finalMarginAmount,
      isFree: finalIsFree,
      status: ['zomato', 'swiggy', 'other'].includes(finalChannel) ? (req.body.status || 'delivered') : 'pending'
    });

    await order.save();

    // Update inventory logs with the actual order reference
    await InventoryLog.updateMany(
      { hotel: hotelId, reference: null, type: { $in: ['CONSUME', 'STOCK_OUT'] }, createdAt: { $gte: new Date(Date.now() - 5000) } },
      { $set: { reference: order._id } }
    );

    // 📊 Record Dish Sales
    for (const item of validatedItems) {
      await DishSales.findOneAndUpdate(
        { dish: item.dish, hotel: hotelId },
        { $inc: { totalQuantitySold: item.quantity } },
        { upsert: true }
      );
    }

    // 👤 Update Dedicated Customer Record
    if (hasCustomerDetails) {
      const syncName = cleanName || 'Guest';
      await Customer.findOneAndUpdate(
        { phone: cleanPhone, hotel: hotelId },
        {
          $set: { name: syncName, lastVisit: new Date() },
          $inc: { totalOrders: 1, totalSpent: grandTotal }
        },
        { upsert: true, new: true }
      );
    }

    res.status(201).json({
      success: true,
      message: 'Order created successfully',
      data: {
        id: order._id,
        grandTotal: order.grandTotal,
        status: order.status
      }
    });

  } catch (err) {
    res.status(400).json({
      success: false,
      message: err.message
    });
  }
};

exports.getMyOrders = async (req, res) => {
  try {
    const isSuperAdmin = req.user.role === ROLES.SUPER_ADMIN;

    // 1. Build Base Filter (Isolation)
    let findFilter = buildFilter(req.query, ['status', 'hotel'], 'orderedAt');

    if (!isSuperAdmin) {
      findFilter.hotel = req.user.hotel;
    } else if (req.query.hotelId) {
      findFilter.hotel = req.query.hotelId;
    }

    // 2. Aggregate Data and Count
    const totalOrders = await Order.countDocuments(findFilter);
    const { skip, limit, meta } = getPagination(req.query, totalOrders);

    const matchStage = { ...findFilter };
    if (matchStage.hotel) matchStage.hotel = new mongoose.Types.ObjectId(matchStage.hotel);

    const [orders, statsResult] = await Promise.all([
      // 📦 Orders list (paginated)
      Order.find(findFilter)
        .sort({ orderedAt: -1 }) // Latest first
        .skip(skip)
        .limit(limit)
        .populate('user', 'profile.name') // 🚀 New: Populating staff name
        .lean(),

      // 📊 Comprehensive Summary (Overall + Dish Breakdown)
      Order.aggregate([
        { $match: matchStage },
        {
          $facet: {
            overall: [
              {
                $group: {
                  _id: null,
                  totalRevenue: { $sum: "$grandTotal" },
                  totalOrders: { $sum: 1 }
                }
              }
            ],
            dishBreakdown: [
              { $unwind: "$items" },
              {
                $group: {
                  _id: "$items.dish",
                  name: { $first: "$items.name" },
                  originalPrice: { $first: "$items.price" },
                  totalQuantity: { $sum: "$items.quantity" },
                  totalRevenue: { $sum: "$items.total" },
                  orderCount: { $sum: 1 }
                }
              },
              {
                $project: {
                  _id: 0,
                  dishId: "$_id",
                  name: 1,
                  originalPrice: 1,
                  totalQuantity: 1,
                  totalRevenue: 1,
                  orderCount: 1
                }
              },
              { $sort: { totalQuantity: -1 } } // Sort by most popular
            ]
          }
        }
      ])
    ]);

    // Extract stats from facet result
    const stats = statsResult[0] || { overall: [], dishBreakdown: [] };
    const totalRevenue = stats.overall.length > 0 ? stats.overall[0].totalRevenue : 0;
    const dishBreakdown = stats.dishBreakdown || [];

    res.status(200).json({
      success: true,
      summary: {
        totalOrders,
        totalRevenue,
        dishBreakdown // 🚀 New: Dish-wise sales stats for the filtered period
      },
      pagination: meta,
      data: orders.map(o => ({
        id: o._id,
        customerName: o.customer?.name || null,
        customerPhone: o.customer?.phone || null, // 🚀 New
        grandTotal: o.grandTotal,
        subTotal: o.subTotal, // 🚀 New
        gstTotal: o.gstTotal, // 🚀 New
        status: o.status,
        orderedAt: o.orderedAt,
        updatedAt: o.updatedAt, // 🚀 New
        notes: o.notes || '', // 🚀 New
        staffName: o.user?.profile?.name || 'Super Admin', // 🚀 New (from populate)
        items: o.items, // 🚀 New: Include full items list in response
        totalItemsCount: o.items.reduce((sum, item) => sum + item.quantity, 0) // 🚀 New: Total dish count for this order
      }))
    });

  } catch (err) {
    console.error('Get orders error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch orders'
    });
  }
};

// Get single order (owner or staff/admin)
exports.getOrderById = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('user', 'phone username profile.name');

    if (!order) return res.status(404).json({ message: 'Order not found' });

    const isOwner = order.user._id.toString() === req.user.id;
    const isSuperAdmin = req.user.role === ROLES.SUPER_ADMIN;
    const isHotelMember = (req.user.role === ROLES.HOTEL_ADMIN || req.user.role === ROLES.STAFF) &&
      order.hotel?.toString() === req.user.hotel?.toString();

    if (!isOwner && !isSuperAdmin && !isHotelMember) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    res.json(order);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.editOrder = async (req, res) => {
  try {
    const { orderId } = req.params;

    const {
      items,
      notes,
      customerName,
      customerPhone,
      gstPercent
    } = req.body;

    // 1. Validate Order ID
    if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({
        success: false,
        message: 'Valid Order ID is required'
      });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // 2. Authorization check — Admin / Super Admin only
    const isSuperAdmin = req.user.role === ROLES.SUPER_ADMIN;
    const isHotelAdmin = req.user.role === ROLES.HOTEL_ADMIN &&
      order.hotel?.toString() === req.user.hotel?.toString();

    if (!isSuperAdmin && !isHotelAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to edit this order'
      });
    }

    // 3. Status Guard — Cannot edit terminal orders
    if (['delivered', 'paid', 'cancelled', 'billed'].includes(order.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot edit order in '${order.status}' state`
      });
    }

    // 4. Items Update — ADDITIVE MERGE (append new, increment existing)
    if (items) {
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Items must be a non-empty array'
        });
      }

      // Build a map of existing items by dish ID for fast lookup
      const existingMap = new Map();
      const salesIncrements = []; // Track quantities added for DishSales
      for (const existingItem of order.items) {
        existingMap.set(existingItem.dish.toString(), existingItem);
      }

      const hotelId = order.hotel;

      for (const item of items) {
        if (!item.dishId || !item.quantity || item.quantity < 1) {
          return res.status(400).json({
            success: false,
            message: 'Each item must have a valid dishId and quantity (min 1)'
          });
        }

        // Validate dish exists AND belongs to this hotel
        const dish = await Dish.findOne({ _id: item.dishId, hotel: hotelId });
        if (!dish) {
          return res.status(400).json({
            success: false,
            message: `Dish with ID '${item.dishId}' not found in this hotel's menu`
          });
        }

        // Check dish availability
        if (!dish.isAvailable) {
          return res.status(400).json({
            success: false,
            message: `Dish '${dish.name}' is currently unavailable`
          });
        }

        const dishIdStr = dish._id.toString();

        if (existingMap.has(dishIdStr)) {
          // Dish already exists in order → increment quantity
          const existing = existingMap.get(dishIdStr);
          existing.quantity += item.quantity;
          existing.price = dish.price; // refresh to latest price
          existing.total = existing.quantity * dish.price;
          salesIncrements.push({ dish: dish._id, quantity: item.quantity });
        } else {
          // New dish → append to order
          const newItem = {
            dish: dish._id,
            name: dish.name,
            quantity: item.quantity,
            price: dish.price,
            total: item.quantity * dish.price
          };
          order.items.push(newItem);
          existingMap.set(dishIdStr, newItem);
          salesIncrements.push({ dish: dish._id, quantity: item.quantity });
        }
      }

      /**
       * 📦 Inventory Stock Deduction for newly added items
       */
      const newItemsForInventory = salesIncrements.map(inc => ({
        dish: inc.dish,
        quantity: inc.quantity
      }));
      const editCategoryQuantities = await groupItemsByCategory(newItemsForInventory, order.hotel);
      const editStockResult = await deductInventoryStock(order.hotel, editCategoryQuantities, order._id, order.channel, order.isFree);

      if (!editStockResult.success) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock in category '${editStockResult.failedCategory}'. Cannot add these items.`
        });
      }

      // 📊 Record Dish Sales for added items
      for (const inc of salesIncrements) {
        await DishSales.findOneAndUpdate(
          { dish: inc.dish, hotel: order.hotel },
          { $inc: { totalQuantitySold: inc.quantity } },
          { upsert: true }
        );
      }
    }

    // 🔹 Optional channel, marginAmount, and isFree updates
    if (req.body.channel !== undefined) {
      const allowedChannels = ['dine-in', 'takeaway', 'zomato', 'swiggy', 'other'];
      if (!allowedChannels.includes(req.body.channel)) {
        return res.status(400).json({ success: false, message: 'Invalid channel value' });
      }
      order.channel = req.body.channel;
    }
    if (req.body.marginAmount !== undefined) {
      if (typeof req.body.marginAmount !== 'number') {
        return res.status(400).json({ success: false, message: 'marginAmount must be a number' });
      }
      order.marginAmount = req.body.marginAmount;
    }
    if (req.body.isFree !== undefined) {
      order.isFree = req.body.isFree === true || req.body.isFree === 'true';
    }

    // Post-update validations
    if (order.channel !== 'zomato' && order.channel !== 'swiggy') {
      if (order.marginAmount !== 0) {
        return res.status(400).json({
          success: false,
          message: 'Margin amount is only allowed for zomato and swiggy channels'
        });
      }
    }
    if (order.channel !== 'other') {
      if (order.isFree) {
        return res.status(400).json({
          success: false,
          message: 'Free stock-out option is only allowed for the other channel'
        });
      }
    }

    // 🔹 Recalculate totals based on items, isFree, and marginAmount
    let subTotal = 0;
    for (const it of order.items) {
      if (order.isFree) {
        it.total = 0;
      } else {
        it.total = it.quantity * it.price;
      }
      subTotal += it.total;
    }
    order.subTotal = subTotal;

    const gstRate = gstPercent !== undefined
      ? gstPercent
      : (order.subTotal > 0 ? (order.gstTotal * 100) / order.subTotal : 0);

    order.gstTotal = order.isFree ? 0 : (subTotal * gstRate) / 100;
    order.grandTotal = order.isFree ? 0 : (subTotal + order.gstTotal + order.marginAmount);

    /**
     * 🔹 Update customer snapshot & Identity Sync
     */
    const oldPhone = order.customer?.phone || null;
    const oldGrandTotal = order.grandTotal; // The total before the recalculation below

    if (customerName !== undefined || customerPhone !== undefined) {
      const rawPhone = customerPhone !== undefined ? customerPhone : order.customer?.phone;
      const rawName = customerName !== undefined ? customerName : order.customer?.name;

      const cleanPhoneToSync = rawPhone ? String(rawPhone).trim() : null;
      const cleanNameToSync = rawName ? String(rawName).trim() : null;

      if (cleanPhoneToSync) {
        // 1. User Model Sync
        let customerUser = await User.findOne({ phone: cleanPhoneToSync });

        if (customerUser && customerUser.role !== ROLES.CUSTOMER) {
          return res.status(400).json({
            success: false,
            message: `Phone number ${cleanPhoneToSync} is already registered as ${customerUser.role}. Please use a different number.`
          });
        }

        const syncName = cleanNameToSync || 'Guest';

        if (!customerUser) {
          const hashedPassword = await bcrypt.hash('123456', 10);
          customerUser = new User({
            username: cleanPhoneToSync,
            phone: cleanPhoneToSync,
            password: hashedPassword,
            role: ROLES.CUSTOMER,
            profile: { name: syncName },
            hotel: order.hotel
          });
          await customerUser.save();
        } else {
          if (!customerUser.profile) customerUser.profile = {};
          let changed = false;

          if (cleanNameToSync && customerUser.profile.name !== cleanNameToSync) {
            customerUser.profile.name = cleanNameToSync;
            changed = true;
          }

          if (!customerUser.hotel) {
            customerUser.hotel = order.hotel;
            changed = true;
          }

          if (changed) await customerUser.save();
        }
      }

      if (order.customer) {
        if (customerName !== undefined) order.customer.name = cleanNameToSync;
        if (customerPhone !== undefined) order.customer.phone = cleanPhoneToSync;
      } else {
        order.customer = {
          name: cleanNameToSync,
          phone: cleanPhoneToSync
        };
      }
    }

    // Capture the new total after item reconciliation 
    const newGrandTotal = order.grandTotal || oldGrandTotal;
    const diff = newGrandTotal - oldGrandTotal;
    const newPhone = order.customer?.phone || null;

    // 2. Customer Model Sync
    if (oldPhone || newPhone) {
      if (oldPhone !== newPhone) {
        // Phone changed! 
        if (oldPhone) {
          // Subtract total from old customer
          await Customer.findOneAndUpdate(
            { phone: oldPhone, hotel: order.hotel },
            { $inc: { totalSpent: -oldGrandTotal, totalOrders: -1 } }
          );
        }

        if (newPhone) {
          // Add full new total to new customer
          await Customer.findOneAndUpdate(
            { phone: newPhone, hotel: order.hotel },
            {
              $set: { name: order.customer?.name || 'Guest', lastVisit: new Date() },
              $inc: { totalSpent: newGrandTotal, totalOrders: 1 }
            },
            { upsert: true }
          );
        }
      } else {
        // Same phone, just update difference in spending
        if (newPhone) {
          await Customer.findOneAndUpdate(
            { phone: newPhone, hotel: order.hotel },
            {
              $set: { name: order.customer?.name || 'Guest', lastVisit: new Date() },
              $inc: { totalSpent: diff }
            },
            { upsert: true }
          );
        }
      }
    }

    /**
     * 🔹 Optional fields
     */
    if (notes !== undefined) {
      order.notes = notes;
    }

    await order.save();

    res.status(200).json({
      success: true,
      message: 'Order updated successfully',
      data: order
    });

  } catch (err) {
    console.error('Edit Order Error:', err);
    res.status(500).json({
      success: false,
      message: 'Internal Server Error'
    });
  }
};

// Update status (staff/admin only)
exports.updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const orderId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({
        message: 'Invalid order ID format'
      });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // 🔑 Authorization check
    const isSuperAdmin = req.user.role === ROLES.SUPER_ADMIN;
    const isHotelMember = (req.user.role === ROLES.HOTEL_ADMIN || req.user.role === ROLES.STAFF) &&
      order.hotel?.toString() === req.user.hotel?.toString();

    if (!isSuperAdmin && !isHotelMember) {
      return res.status(403).json({ message: 'Not authorized to update status' });
    }

    // 🔑 Status Transition State Machine
    const allowedTransitions = {
      'pending': ['preparing', 'cancelled'],
      'preparing': ['ready', 'cancelled'],
      'ready': ['delivered', 'cancelled'],
      'delivered': ['paid', 'billed'],
      'paid': ['billed'],
      'billed': [],
      'cancelled': []
    };

    const currentStatus = order.status || 'pending';

    // Safety check if current status is not in the map (legacy)
    if (!allowedTransitions[currentStatus]) {
      // If stuck in a weird state, allow moving to cancelled or reset to pending locally
      if (status !== 'cancelled' && status !== 'pending') {
        return res.status(400).json({
          success: false,
          message: `Invalid current status: ${currentStatus}. Can only move to cancelled.`
        });
      }
    } else if (!allowedTransitions[currentStatus].includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid transition from ${currentStatus} to ${status}. Allowed: ${allowedTransitions[currentStatus].join(', ')}`
      });
    }

    // 📦 Restore inventory if transitioning to cancelled
    if (status === 'cancelled') {
      await restoreInventoryStock(order.hotel, order.items, order._id);
    }

    order.status = status;
    await order.save();

    res.json({
      success: true,
      message: `Status updated to ${status}`,
      data: {
        id: order._id,
        status: order.status
      }
    });
  } catch (err) {
    console.error('Update order error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// Cancel order (guest before preparing, staff anytime)
exports.cancelOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });

    // Authorization check
    const isOwner = order.user.toString() === req.user.id;
    const isSuperAdmin = req.user.role === ROLES.SUPER_ADMIN;
    const isHotelMember = (req.user.role === ROLES.HOTEL_ADMIN || req.user.role === ROLES.STAFF) &&
      order.hotel?.toString() === req.user.hotel?.toString();

    if (!isOwner && !isSuperAdmin && !isHotelMember) {
      return res.status(403).json({ message: 'Not authorized to cancel this order' });
    }

    if (order.status === 'delivered' || order.status === 'billed') {
      return res.status(400).json({ message: 'Cannot cancel delivered or billed order' });
    }

    // 📦 Restore inventory stock on cancellation
    await restoreInventoryStock(order.hotel, order.items, order._id);

    order.status = 'cancelled';
    await order.save();

    res.json({ success: true, message: 'Order cancelled and stock restored', order });
  } catch (err) {
    console.error('Cancel order error:', err);
    res.json({ message: err.message });
  }
};

// Generate bill PDF for order
exports.generateOrderBill = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('user', 'profile.name phone');

    if (!order) return res.status(404).json({ message: 'Order not found' });

    // Authorization: owner or hotel staff
    const isOwner = order.user._id.toString() === req.user.id;
    const isSuperAdmin = req.user.role === ROLES.SUPER_ADMIN;
    const isHotelMember = (req.user.role === ROLES.HOTEL_ADMIN || req.user.role === ROLES.STAFF) &&
      order.hotel?.toString() === req.user.hotel?.toString();

    if (!isOwner && !isSuperAdmin && !isHotelMember) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const doc = new PDFDocument({ margin: 50 });
    const fileName = `order-bill-${order._id}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    doc.pipe(res);

    // Header
    doc.fontSize(20).text('Room Service Bill', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(12).text(`Order ID: ${order._id}`, { align: 'center' });
    doc.text(`Date: ${new Date(order.orderedAt).toLocaleString()}`);
    doc.moveDown();

    // Guest info
    doc.text(`Guest: ${order.customer?.name || 'Guest'}`);
    doc.text(`Phone: ${order.customer?.phone || 'N/A'}`);
    if (order.roomNumber) {
      doc.text(`Room: ${order.roomNumber}`);
    }
    doc.moveDown();

    // Items table
    doc.fontSize(14).text('Items', { underline: true });
    doc.moveDown(0.5);

    doc.fontSize(10);
    doc.text('Item'.padEnd(30) + 'Qty'.padEnd(8) + 'Price'.padEnd(10) + 'Total');
    doc.moveDown(0.3);

    order.items.forEach(item => {
      doc.text(
        `${item.name.substring(0, 28).padEnd(30)}` +
        `${item.quantity}`.padEnd(8) +
        `$${item.price.toFixed(2)}`.padEnd(10) +
        `$${item.total.toFixed(2)}`
      );
    });

    doc.moveDown();
    doc.text(`Subtotal: $${order.subTotal.toFixed(2)}`, { align: 'right' });
    // if (order.tax > 0) {
    //   doc.text(`Tax: $${order.tax.toFixed(2)}`, { align: 'right' });
    // }
    doc.fontSize(12).text(`Total: $${order.grandTotal.toFixed(2)}`, { align: 'right', underline: true });

    doc.end();

    // Optional: mark as billed
    if (order.status !== 'billed') {
      order.status = 'billed';
      await order.save();
    }

  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({ message: 'Error generating bill' });
    }
  }
};

// ============================================================
// Staff Edit Order (Staff Only)
// ============================================================
// @desc    Edit an order (items, notes) — Staff Only
// @route   PUT /api/orders/staff-edit/:orderId
// @access  Private (Staff Only)
exports.staffEditOrder = async (req, res) => {
  try {
    const { orderId } = req.params;

    // 1. Role Check — Staff Only
    if (req.user.role !== ROLES.STAFF) {
      return res.status(403).json({
        success: false,
        message: 'Only staff members can use this endpoint'
      });
    }

    const staffHotelId = req.user.hotel;
    if (!staffHotelId) {
      return res.status(400).json({
        success: false,
        message: 'Staff member is not linked to any hotel'
      });
    }

    // 2. Find the Order
    if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({
        success: false,
        message: 'Valid Order ID is required'
      });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // 3. Hotel Ownership — Staff must belong to the same hotel
    if (order.hotel.toString() !== staffHotelId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You can only edit orders from your own hotel'
      });
    }

    // 4. Status Guard — Cannot edit terminal orders
    if (['delivered', 'paid', 'cancelled', 'billed'].includes(order.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot edit order in '${order.status}' state`
      });
    }

    const { items, notes, gstPercent } = req.body;
    const oldGrandTotal = order.grandTotal || 0;
    const oldSubTotal = order.subTotal || 0;
    const oldGstTotal = order.gstTotal || 0;

    // 5. Items Update — DELTA-SYNC (Final State Sync)
    if (items) {
      if (!Array.isArray(items)) {
        return res.status(400).json({
          success: false,
          message: 'Items must be an array'
        });
      }

      const existingItemsMap = new Map();
      order.items.forEach(item => {
        existingItemsMap.set(item.dish.toString(), item);
      });

      const deltas = []; // { dish, delta, name }
      const newItemsList = [];

      // Process Incoming Items
      for (const item of items) {
        if (!item.dishId || item.quantity === undefined || item.quantity < 0) {
          return res.status(400).json({
            success: false,
            message: 'Each item must have a valid dishId and non-negative quantity'
          });
        }

        const dish = await Dish.findOne({ _id: item.dishId, hotel: staffHotelId });
        if (!dish) {
          return res.status(400).json({
            success: false,
            message: `Dish with ID '${item.dishId}' not found in your hotel's menu`
          });
        }

        // Only check availability for INCREASES or NEW items
        const existingItem = existingItemsMap.get(item.dishId.toString());
        const existingQty = existingItem ? existingItem.quantity : 0;
        const delta = item.quantity - existingQty;

        if (delta > 0 && !dish.isAvailable) {
          return res.status(400).json({
            success: false,
            message: `Dish '${dish.name}' is currently unavailable and cannot be increased`
          });
        }

        if (item.quantity > 0) {
          newItemsList.push({
            dish: dish._id,
            name: dish.name,
            quantity: item.quantity,
            price: dish.price,
            total: item.quantity * dish.price
          });
        }

        if (delta !== 0) {
          deltas.push({ dish: dish._id, delta, name: dish.name });
        }

        // Mark as processed
        existingItemsMap.delete(item.dishId.toString());
      }

      // Process Remaining Items (Items removed from the list entirely)
      for (const [dishId, existingItem] of existingItemsMap) {
        deltas.push({
          dish: existingItem.dish,
          delta: -existingItem.quantity,
          name: existingItem.name
        });
      }

      // --- INVENTORY & SALES SYNC ---

      // A. Separate Positive and Negative Deltas
      const positiveDeltas = deltas.filter(d => d.delta > 0);
      const negativeDeltas = deltas.filter(d => d.delta < 0);

      // B. Check & Deduct Stock for Increases
      if (positiveDeltas.length > 0) {
        const itemsToDeduct = positiveDeltas.map(d => ({ dish: d.dish, quantity: d.delta }));
        const categoriesToDeduct = await groupItemsByCategory(itemsToDeduct, order.hotel);
        const stockResult = await deductInventoryStock(order.hotel, categoriesToDeduct, order._id);

        if (!stockResult.success) {
          return res.status(400).json({
            success: false,
            message: `Insufficient stock in category '${stockResult.failedCategory}'. Cannot increase quantity.`
          });
        }
      }

      // C. Restore Stock for Decreases/Removals
      if (negativeDeltas.length > 0) {
        const itemsToRestore = negativeDeltas.map(d => ({ dish: d.dish, quantity: Math.abs(d.delta) }));
        const categoriesToRestore = await groupItemsByCategory(itemsToRestore, order.hotel);

        for (const cat of categoriesToRestore) {
          if (!cat.stockManaged) continue;

          await CategoryInventory.findOneAndUpdate(
            { hotel: order.hotel, category: cat.categoryId },
            {
              $inc: { totalStock: cat.totalQty, totalConsumed: -cat.totalQty },
              $set: { lastUpdatedAt: new Date() }
            }
          );

          await InventoryLog.create({
            hotel: order.hotel,
            category: cat.categoryId,
            type: 'RESTORE',
            quantity: cat.totalQty,
            reference: order._id,
            notes: `Restored ${cat.totalQty} plates via staff order edit (Quantity Adjustment)`
          });
        }
      }

      // D. Sync Dish Sales Analytics
      for (const d of deltas) {
        await DishSales.findOneAndUpdate(
          { dish: d.dish, hotel: order.hotel },
          { $inc: { totalQuantitySold: d.delta } },
          { upsert: true }
        );
      }

      // E. Update Order Object
      order.items = newItemsList;

      let subTotal = 0;
      for (const it of order.items) {
        subTotal += it.total;
      }
      order.subTotal = subTotal;

      // GST Recalculation
      let gstRate = 0;
      if (gstPercent !== undefined) {
        gstRate = gstPercent;
      } else if (oldSubTotal > 0) {
        gstRate = (oldGstTotal * 100) / oldSubTotal;
      }

      order.gstTotal = (subTotal * gstRate) / 100;
      order.grandTotal = subTotal + order.gstTotal;
    }

    // 6. Update Notes if provided
    if (notes !== undefined) {
      order.notes = notes;
    }

    // 7. Final Revenue Adjustment for Customer
    const finalDiff = order.grandTotal - oldGrandTotal;
    if (finalDiff !== 0 && order.customer?.phone) {
      await Customer.findOneAndUpdate(
        { phone: order.customer.phone, hotel: order.hotel },
        { $inc: { totalSpent: finalDiff } },
        { upsert: true }
      );
    }

    await order.save();

    res.status(200).json({
      success: true,
      message: 'Order updated successfully (Sync Mode)',
      data: order
    });

  } catch (err) {
    console.error('Staff Edit Order Error:', err);
    res.status(500).json({
      success: false,
      message: 'Internal Server Error'
    });
  }
};