const User = require('../models/User');
const Hotel = require('../models/Hotel');
const Order = require('../models/orderItem');
const Dish = require('../models/Dish');
const Category = require('../models/Category');
const CategoryInventory = require('../models/CategoryInventory');
const bcrypt = require('bcryptjs');
const { ROLES } = require('../utils/constants');
const mongoose = require('mongoose');
const getPagination = require('../utils/pagination');
const buildFilter = require('../utils/queryFilter');
const moment = require('moment-timezone');

// @desc    Create a new staff member
// @route   POST /api/staff
// @access  Private (Hotel Admin / Super Admin)
exports.createStaff = async (req, res) => {
    try {
        const { username, phone, password, name, email, hotelId } = req.body;

        // 1. Basic validation
        if (!username || !phone || !password) {
            return res.status(400).json({
                success: false,
                message: 'Username, phone, and password are required'
            });
        }

        // 2. Determine Hotel ID
        let assignedHotelId = hotelId;

        // If not Super Admin, identify the hotel owned by this admin
        if (req.user.role !== ROLES.SUPER_ADMIN) {
            // First check if hotel is already on req.user (from token)
            if (req.user.hotel) {
                assignedHotelId = req.user.hotel;
            } else {
                const hotel = await Hotel.findOne({ admin: req.user.id });
                if (!hotel) {
                    return res.status(403).json({
                        success: false,
                        message: 'You must own a hotel to create staff'
                    });
                }
                assignedHotelId = hotel._id;
            }
        } else {
            // Super Admin must provide hotelId
            if (!assignedHotelId) {
                return res.status(400).json({
                    success: false,
                    message: 'Hotel ID is required for Super Admin to create staff'
                });
            }
            if (!mongoose.Types.ObjectId.isValid(assignedHotelId)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid Hotel ID format'
                });
            }
            const hotel = await Hotel.findById(assignedHotelId);
            if (!hotel) {
                return res.status(404).json({
                    success: false,
                    message: 'Hotel not found'
                });
            }
        }

        // 3. Check if staff user already exists
        const existingUser = await User.findOne({ $or: [{ username }, { phone }] });
        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: 'Username or phone already exists'
            });
        }

        // 4. Create Staff User
        const hashedPassword = await bcrypt.hash(password, 10);
        const staff = new User({
            username,
            phone,
            password: hashedPassword,
            role: ROLES.STAFF,
            profile: { name, email },
            hotel: assignedHotelId,
            creator: req.user.id
        });

        await staff.save();

        // 5. Enrich Response (Omit password)
        const staffData = staff.toObject();
        delete staffData.password;

        res.status(201).json({
            success: true,
            data: staffData
        });
    } catch (err) {
        console.error('Create Staff Error:', err);
        res.status(500).json({
            success: false,
            message: err.name === 'ValidationError' ? err.message : 'Internal Server Error'
        });
    }
};

// @desc    Get all staff for a specific hotel
// @route   GET /api/staff/hotel/:hotelId
// @access  Private (Hotel Admin / Super Admin)
exports.getHotelStaff = async (req, res) => {
    try {
        const { hotelId } = req.params;

        // 2. Validate ObjectId format
        if (!mongoose.Types.ObjectId.isValid(hotelId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid Hotel ID format'
            });
        }

        // 3. Authorization check: Hotel Admin can only see their own hotel's staff
        if (req.user.role === ROLES.HOTEL_ADMIN) {
            const hotel = await Hotel.findOne({ _id: hotelId, admin: req.user.id });
            if (!hotel) {
                return res.status(403).json({
                    success: false,
                    message: 'You do not have permission to view staff for this hotel'
                });
            }
        }

        const totalStaff = await User.countDocuments({ hotel: hotelId, role: ROLES.STAFF });
        const { skip, limit, meta } = getPagination(req.query, totalStaff);

        const staff = await User.find({ hotel: hotelId, role: ROLES.STAFF })
            .select('-password')
            .skip(skip)
            .limit(limit);

        res.status(200).json({
            success: true,
            pagination: meta,
            data: staff
        });
    } catch (err) {
        console.error('Get Hotel Staff Error:', err);
        res.status(500).json({
            success: false,
            message: 'Internal Server Error'
        });
    }
};

// @desc    Get all staff (System-wide)
// @route   GET /api/staff/all
// @access  Private (Super Admin)
exports.getAllStaff = async (req, res) => {
    try {
        // Double check Super Admin role (extra safety)
        if (req.user.role !== ROLES.SUPER_ADMIN) {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Super Admin only.'
            });
        }

        const totalStaff = await User.countDocuments({ role: ROLES.STAFF });
        const { skip, limit, meta } = getPagination(req.query, totalStaff);

        const staff = await User.find({ role: ROLES.STAFF })
            .select('-password')
            .populate('hotel', 'name city')
            .skip(skip)
            .limit(limit);

        res.status(200).json({
            success: true,
            pagination: meta,
            data: staff
        });
    } catch (err) {
        console.error('Get All Staff Error:', err);
        res.status(500).json({
            success: false,
            message: 'Internal Server Error'
        });
    }
};

// @desc    Get staff members created by the current admin
// @route   GET /api/staff/me
// @access  Private (Hotel Admin / Super Admin)
exports.getStaffByAdmin = async (req, res) => {
    try {
        const totalStaff = await User.countDocuments({ creator: req.user.id, role: ROLES.STAFF });
        const { skip, limit, meta } = getPagination(req.query, totalStaff);

        const staff = await User.find({ creator: req.user.id, role: ROLES.STAFF })
            .select('-password')
            .populate('hotel', 'name')
            .skip(skip)
            .limit(limit);

        res.status(200).json({
            success: true,
            pagination: meta,
            data: staff
        });
    } catch (err) {
        console.error('Get Staff By Admin Error:', err);
        res.status(500).json({
            success: false,
            message: 'Internal Server Error'
        });
    }
};

// @desc    Delete staff member
// @route   DELETE /api/staff/:id
// @access  Private (Hotel Admin / Super Admin)
exports.deleteStaff = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid Staff ID format'
            });
        }

        const staff = await User.findById(id);

        if (!staff || staff.role !== ROLES.STAFF) {
            return res.status(404).json({
                success: false,
                message: 'Staff member not found'
            });
        }

        // Authorization check: Hotel Admin can only delete staff from their own hotel
        if (req.user.role === ROLES.HOTEL_ADMIN) {
            const hotel = await Hotel.findOne({ _id: staff.hotel, admin: req.user.id });
            if (!hotel) {
                return res.status(403).json({
                    success: false,
                    message: 'You do not have permission to delete staff from this hotel'
                });
            }
        }

        // 🔒 SAFETY CHECK

        // 1. Check for Active Orders (Blocker)
        const activeOrderExists = await Order.exists({
            user: id,
            status: { $in: ['pending', 'preparing', 'ready'] }
        });

        if (activeOrderExists) {
            return res.status(400).json({
                success: false,
                message: 'Staff member has active orders and cannot be deleted. Please complete or cancel those orders first.'
            });
        }

        // 2. Check for Order History (Data Integrity)
        const historicOrderExists = await Order.exists({ user: id });

        if (historicOrderExists) {
            return res.status(400).json({
                success: false,
                message: 'Staff member has a record of past orders and cannot be deleted to preserve financial history.'
            });
        }

        await User.findByIdAndDelete(id);

        res.status(200).json({
            success: true,
            message: 'Staff member deleted successfully'
        });
    } catch (err) {
        console.error('Delete Staff Error:', err);
        res.status(500).json({
            success: false,
            message: 'Internal Server Error'
        });
    }
};

// @desc    Update staff member
// @route   PUT /api/staff/:id
// @access  Private (Staff member / Hotel Admin / Super Admin)
exports.updateStaff = async (req, res) => {
    try {
        const { id } = req.params;
        const { username, phone, name, email } = req.body;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid Staff ID format'
            });
        }

        const staff = await User.findById(id);
        if (!staff) {
            return res.status(404).json({
                success: false,
                message: 'Staff member not found'
            });
        }

        // Authorization check:
        // 1. Super Admin can edit anyone
        // 2. Hotel Admin can edit staff from their own hotel
        // 3. Staff can edit their own profile
        const isSelf = req.user.id === id;
        const isSuperAdmin = req.user.role === ROLES.SUPER_ADMIN;
        const isHotelAdminForThisStaff = req.user.role === ROLES.HOTEL_ADMIN &&
            staff.hotel?.toString() === req.user.hotel?.toString();

        if (!isSuperAdmin && !isHotelAdminForThisStaff && !isSelf) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to update this profile'
            });
        }

        // Update basic fields
        if (name) staff.profile.name = name;
        if (email) staff.profile.email = email;

        // Handle unique field updates (username / phone)
        if (username && username !== staff.username) {
            const usernameExists = await User.findOne({ username });
            if (usernameExists) {
                return res.status(400).json({ success: false, message: 'Username already in use' });
            }
            staff.username = username;
        }

        if (phone && phone !== staff.phone) {
            const phoneExists = await User.findOne({ phone });
            if (phoneExists) {
                return res.status(400).json({ success: false, message: 'Phone number already in use' });
            }
            staff.phone = phone;
        }

        await staff.save();

        const updatedData = staff.toObject();
        delete updatedData.password;

        res.status(200).json({
            success: true,
            message: 'Profile updated successfully',
            data: updatedData
        });
    } catch (err) {
        console.error('Update Staff Error:', err);
        res.status(500).json({
            success: false,
            message: 'Internal Server Error'
        });
    }
};

// @desc    Get Staff Dashboard (Summary)
// @route   GET /api/staff/dashboard
// @access  Private (Staff)
exports.getStaffDashboard = async (req, res) => {
    try {
        const staffId = req.user.id;
        const hotelId = req.user.hotel;

        if (!hotelId) return res.status(400).json({ message: 'Hotel reference missing' });

        const filter = { user: new mongoose.Types.ObjectId(staffId) };

        // 1. Get total for pagination and metrics
        const totalOrders = await Order.countDocuments(filter);
        const { skip, limit, meta } = getPagination(req.query, totalOrders);

        const [orderStats, dishesCount, categoriesCount, recentOrders] = await Promise.all([
            Order.aggregate([
                { $match: filter },
                {
                    $group: {
                        _id: null,
                        totalRevenue: { $sum: "$grandTotal" }
                    }
                }
            ]),
            Dish.countDocuments({ hotel: hotelId }),
            Category.countDocuments({ hotel: hotelId }),
            Order.find(filter)
                .sort({ orderedAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean()
        ]);

        const summary = {
            totalOrders: totalOrders,
            totalRevenue: orderStats.length > 0 ? orderStats[0].totalRevenue : 0,
            hotelDishes: dishesCount,
            hotelCategories: categoriesCount,
            pagination: meta,
            recentOrders: recentOrders.map(o => ({
                id: o._id,
                customerName: o.customer?.name || null,
                grandTotal: o.grandTotal,
                status: o.status,
                orderedAt: o.orderedAt
            }))
        };

        res.status(200).json({
            success: true,
            data: summary
        });
    } catch (err) {
        console.error('Staff Dashboard Error:', err);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};

// @desc    Get Personal Orders for Staff
// @route   GET /api/staff/orders
// @access  Private (Staff)
// exports.getStaffOrders = async (req, res) => {
//     try {
//         const staffId = req.user.id;

//         // Build filter supporting status and date range
//         const filter = buildFilter(req.query, ['status'], 'orderedAt');
//         filter.user = new mongoose.Types.ObjectId(staffId);

//         const totalOrders = await Order.countDocuments(filter);
//         const { skip, limit, meta } = getPagination(req.query, totalOrders);

//         const orders = await Order.find(filter)
//             .sort({ orderedAt: -1 })
//             .skip(skip)
//             .limit(limit)
//             .lean();

//         res.status(200).json({
//             success: true,
//             pagination: meta,
//             data: orders
//         });
//     } catch (err) {
//         console.error('Staff Orders Error:', err);
//         res.status(500).json({ success: false, message: 'Internal Server Error' });
//     }
// };

exports.getStaffOrders = async (req, res) => {
    try {
        const staffId = req.user.id;

        const filter = buildFilter(req.query, ['status'], 'orderedAt');
        filter.user = new mongoose.Types.ObjectId(staffId);

        // 🕒 IST Date Handling
        const range = req.query.range;

        // ✅ Priority: range > custom dates
        if (range) {
            let start, end;

            if (range === 'today') {
                start = moment().tz('Asia/Kolkata').startOf('day').toDate();
                end = moment().tz('Asia/Kolkata').endOf('day').toDate();
            } 
            else if (range === 'yesterday') {
                start = moment().tz('Asia/Kolkata').subtract(1, 'day').startOf('day').toDate();
                end = moment().tz('Asia/Kolkata').subtract(1, 'day').endOf('day').toDate();
            }

            // "all" → no filter
            if (range !== 'all') {
                filter.orderedAt = {
                    ...(start && { $gte: start }),
                    ...(end && { $lte: end })
                };
            }
        } 
        
        // 🔁 Fallback to manual date filter
        else if (req.query.startDate || req.query.endDate) {
            const start = req.query.startDate
                ? moment.tz(req.query.startDate, 'Asia/Kolkata').startOf('day').toDate()
                : null;

            const end = req.query.endDate
                ? moment.tz(req.query.endDate, 'Asia/Kolkata').endOf('day').toDate()
                : null;

            filter.orderedAt = {};

            if (start) filter.orderedAt.$gte = start;
            if (end) filter.orderedAt.$lte = end;
        }

        const totalOrders = await Order.countDocuments(filter);
        const { skip, limit, meta } = getPagination(req.query, totalOrders);

        const orders = await Order.find(filter)
            .sort({ orderedAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

        // 🟢 Convert response to IST
        const formattedOrders = orders.map(order => ({
            ...order,
            orderedAt: moment(order.orderedAt)
                .tz('Asia/Kolkata')
                .format('YYYY-MM-DD HH:mm:ss')
        }));

        res.status(200).json({
            success: true,
            pagination: meta,
            data: formattedOrders
        });

    } catch (err) {
        console.error('Staff Orders Error:', err);
        res.status(500).json({
            success: false,
            message: 'Internal Server Error'
        });
    }
};
// @desc    Get Categories for Staff's Hotel
// @route   GET /api/staff/categories
// @access  Private (Staff)
exports.getStaffCategories = async (req, res) => {
    try {
        const hotelId = req.user.hotel;
        if (!hotelId) return res.status(400).json({ message: 'Hotel reference missing' });

        const total = await Category.countDocuments({ hotel: hotelId });
        const { skip, limit, meta } = getPagination(req.query, total);

        const categories = await Category.find({ hotel: hotelId })
            .sort({ name: 1 })
            .skip(skip)
            .limit(limit)
            .lean();

        const categoryIds = categories.map(cat => cat._id);
        const inventoryRecords = await CategoryInventory.find({
            hotel: hotelId,
            category: { $in: categoryIds }
        }).lean();

        const invMap = new Map();
        inventoryRecords.forEach(inv => invMap.set(inv.category.toString(), inv));

        const data = categories.map(cat => {
            const inv = invMap.get(cat._id.toString());
            return {
                ...cat,
                totalStock: inv ? inv.totalStock : 0,
                totalConsumed: inv ? inv.totalConsumed : 0
            };
        });

        res.status(200).json({
            success: true,
            pagination: meta,
            data: data
        });
    } catch (err) {
        console.error('Staff Categories Error:', err);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};

// @desc    Get Dishes for Staff's Hotel
// @route   GET /api/staff/dishes
// @access  Private (Staff)
exports.getStaffDishes = async (req, res) => {
    try {
        const hotelId = req.user.hotel;
        if (!hotelId) return res.status(400).json({ message: 'Hotel reference missing' });

        const filter = buildFilter(req.query, ['type', 'isAvailable', 'category'], 'createdAt');
        filter.hotel = hotelId;

        const total = await Dish.countDocuments(filter);
        const { skip, limit, meta } = getPagination(req.query, total);

        const dishes = await Dish.find(filter)
            .populate('category', 'name')
            .sort({ name: 1 })
            .skip(skip)
            .limit(limit)
            .lean();

        res.status(200).json({
            success: true,
            pagination: meta,
            data: dishes
        });
    } catch (err) {
        console.error('Staff Dishes Error:', err);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};


// Helper for fetching unified staff data
const fetchStaffMegaProfileData = async (staffId, query) => {
    // 1. Fetch Staff with populated Creator and Hotel
    const staff = await User.findById(staffId)
        .populate('creator', 'profile phone role username')
        .populate('hotel')
        .lean();

    if (!staff) return { error: 'Staff profile not found', status: 404 };

    // 2. Metrics & Orders (Paginated)
    const filter = buildFilter(query, ['status'], 'orderedAt');
    filter.user = new mongoose.Types.ObjectId(staffId);

    const totalOrders = await Order.countDocuments(filter);
    const { skip, limit, meta } = getPagination(query, totalOrders);

    const [orders, revenueStats, uniqueCustomers] = await Promise.all([
        Order.find(filter)
            .sort({ orderedAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        Order.aggregate([
            { $match: { user: new mongoose.Types.ObjectId(staffId) } },
            { $group: { _id: null, totalRevenue: { $sum: "$grandTotal" } } }
        ]),
        Order.distinct('customer.phone', { user: new mongoose.Types.ObjectId(staffId), 'customer.phone': { $exists: true, $nin: [null, ""] } })
    ]);

    return {
        profiles: {
            staff: {
                id: staff._id,
                name: staff.profile?.name || '',
                phone: staff.phone,
                role: staff.role,
                username: staff.username,
                email: staff.profile?.email || ''
            },
            manager: staff.creator ? {
                id: staff.creator._id,
                name: staff.creator.profile?.name || '',
                phone: staff.creator.phone,
                role: staff.creator.role
            } : null,
            hotel: staff.hotel
        },
        metrics: {
            totalOrders,
            totalRevenue: revenueStats.length > 0 ? revenueStats[0].totalRevenue : 0,
            uniqueCustomersServed: uniqueCustomers.length
        },
        pagination: meta,
        orders: orders.map(o => ({
            id: o._id,
            customer: o.customer,
            grandTotal: o.grandTotal,
            status: o.status,
            orderedAt: o.orderedAt
        }))
    };
};

// @desc    Get Unified Staff Profile (Mega Profile - Self)
// @route   GET /api/staff/mega-profile
// @access  Private (Staff)
exports.getStaffMegaProfile = async (req, res) => {
    try {
        const staffId = req.user.id;
        const result = await fetchStaffMegaProfileData(staffId, req.query);
        if (result.error) return res.status(result.status).json({ message: result.error });
        res.status(200).json({ success: true, ...result });
    } catch (err) {
        console.error('Staff Mega Profile Error:', err);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};

// @desc    Get Unified Staff Profile (Mega Profile - Admin View)
// @route   GET /api/staff/:id/mega-profile
// @access  Private (Admin/SuperAdmin)
exports.getStaffMegaProfileById = async (req, res) => {
    try {
        const staffId = req.params.id;

        // Security Check: Only same hotel admin or super admin
        const staffToView = await User.findById(staffId).select('hotel role');
        if (!staffToView) return res.status(404).json({ message: 'Staff profile not found' });

        if (req.user.role !== ROLES.SUPER_ADMIN) {
            if (!staffToView.hotel || staffToView.hotel.toString() !== req.user.hotel.toString()) {
                return res.status(403).json({ message: 'Access denied: Staff belongs to another hotel' });
            }
        }

        const result = await fetchStaffMegaProfileData(staffId, req.query);
        if (result.error) return res.status(result.status).json({ message: result.error });
        res.status(200).json({ success: true, ...result });
    } catch (err) {
        console.error('Staff Mega Profile By ID Error:', err);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};
