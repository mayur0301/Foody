const Hotel = require('../models/Hotel');
const User = require('../models/User');
const Dish = require('../models/Dish');
const Category = require('../models/Category');
const Order = require('../models/orderItem');
const Plan = require('../models/Plan');
const Subscription = require('../models/Subscription');
const Transaction = require('../models/Transaction');
const Usage = require('../models/Usage');
const mongoose = require('mongoose');
const { ROLES } = require('../utils/constants');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const getPagination = require('../utils/pagination');
const buildFilter = require('../utils/queryFilter');
const razorpay = require('../config/razorpay');
const { calculateEndDate } = require('../utils/subscription');
const { logAction } = require('../utils/logger');
const crypto = require('crypto');

// @desc    Register a new hotel (Public Self-Serve)
// @route   POST /api/hotels/register
// @access  Public
exports.registerHotel = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const {
            name, address, city, country, phone, email,
            adminUsername, adminPassword, adminName,
            planId
        } = req.body;

        // 1. Basic validation
        if (!name || !adminUsername || !adminPassword || !phone) {
            return res.status(400).json({
                success: false,
                message: 'Hotel name, admin username, password, and phone are required'
            });
        }

        // 2. Check if username or phone already exists
        const existingUser = await User.findOne({ $or: [{ username: adminUsername }, { phone }] });
        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: 'Username or phone already exists'
            });
        }

        // 3. Validate plan if provided
        let assignedPlan = null;
        if (planId) {
            assignedPlan = await Plan.findById(planId);
            if (!assignedPlan || !assignedPlan.isActive) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid or inactive plan ID provided'
                });
            }
        }

        // 4. Handle Paid Plan (Defer Account Creation)
        if (assignedPlan && assignedPlan.price > 0) {
            const hotelId = new mongoose.Types.ObjectId();
            const adminId = new mongoose.Types.ObjectId();
            const hashedPassword = await bcrypt.hash(adminPassword, 10);

            // Paid Plan -> Create Razorpay Order
            const orderOptions = {
                amount: Math.round(assignedPlan.price * 100),
                currency: assignedPlan.currency || 'INR',
                receipt: `reg_${Date.now()}`
            };

            const razorpayOrder = await razorpay.orders.create(orderOptions);

            const pendingRegistrationData = {
                hotel: {
                    _id: hotelId,
                    name,
                    address: address || '',
                    city: city || '',
                    country: country || '',
                    phone,
                    email: email || '',
                    status: 'pending',
                    admin: adminId
                },
                admin: {
                    _id: adminId,
                    username: adminUsername,
                    phone,
                    password: hashedPassword,
                    role: ROLES.HOTEL_ADMIN,
                    profile: {
                        name: adminName || adminUsername,
                        email: email || ''
                    },
                    hotel: hotelId,
                    creator: adminId
                }
            };

            await Transaction.create([{
                hotel: hotelId,
                plan: assignedPlan._id,
                amount: assignedPlan.price,
                currency: assignedPlan.currency,
                status: 'PENDING',
                razorpayOrderId: razorpayOrder.id,
                notes: `Registration order for plan: ${assignedPlan.name}`,
                pendingRegistrationData // Store data for creation later
            }], { session });

            await session.commitTransaction();
            session.endSession();

            return res.status(201).json({
                success: true,
                message: 'Order created. Please complete payment to finish registration.',
                data: {
                    payment: {
                        orderId: razorpayOrder.id,
                        amount: razorpayOrder.amount,
                        currency: razorpayOrder.currency,
                        planName: assignedPlan.name,
                        keyId: process.env.RAZORPAY_KEY_ID
                    }
                }
            });
        }

        // 5. Handle Free Plan or No Plan (Immediate Account Creation)
        const hotelId = new mongoose.Types.ObjectId();
        const adminId = new mongoose.Types.ObjectId();
        const hashedPassword = await bcrypt.hash(adminPassword, 10);

        const hotel = new Hotel({
            _id: hotelId,
            name,
            address: address || '',
            city: city || '',
            country: country || '',
            phone,
            email: email || '',
            status: 'pending',
            admin: adminId
        });

        const adminUser = new User({
            _id: adminId,
            username: adminUsername,
            phone,
            password: hashedPassword,
            role: ROLES.HOTEL_ADMIN,
            profile: {
                name: adminName || adminUsername,
                email: email || ''
            },
            hotel: hotel._id,
            creator: adminId
        });

        await hotel.save({ session });
        await adminUser.save({ session });

        // Generate Login Token
        const token = jwt.sign(
            { id: adminUser._id, role: adminUser.role, phone: adminUser.phone, hotel: hotel._id },
            process.env.JWT_SECRET || 'your-very-long-random-secret-key-2025',
            { expiresIn: '24h' }
        );

        if (assignedPlan) {
            // price is 0 guaranteed here
            const now = new Date();
            const endDate = calculateEndDate(now, assignedPlan.billingCycle, assignedPlan.trialDays);

            const sub = await Subscription.create([{
                hotel: hotel._id,
                plan: assignedPlan._id,
                status: assignedPlan.trialDays > 0 ? 'TRIALING' : 'ACTIVE',
                startDate: now,
                endDate,
                trialEndDate: assignedPlan.trialDays > 0
                    ? new Date(now.getTime() + (assignedPlan.trialDays * 86400000))
                    : null,
            }], { session });

            await Transaction.create([{
                hotel: hotel._id,
                subscription: sub[0]._id,
                plan: assignedPlan._id,
                amount: 0,
                currency: assignedPlan.currency,
                status: 'SUCCESS',
                notes: 'Free/Trial plan activation upon registration.',
            }], { session });
        }

        await session.commitTransaction();
        session.endSession();

        res.status(201).json({
            success: true,
            message: 'Registration successful.',
            token,
            data: {
                hotel: { id: hotel._id, name: hotel.name, status: hotel.status },
                admin: { id: adminUser._id, username: adminUser.username }
            }
        });
    } catch (err) {
        await session.abortTransaction();
        session.endSession();
        console.error('Register Hotel Error:', err);
        res.status(500).json({
            success: false,
            message: 'Internal Server Error'
        });
    }
};

// @desc    Create a new hotel (and its Admin)
// @route   POST /api/hotels
// @access  Private (Super Admin Only)
exports.createHotel = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const {
            name, address, city, country, phone, email,
            adminUsername, adminPassword, adminName,
            planId  // ← Optional: Assign a subscription plan during creation
        } = req.body;

        // 1. Basic validation
        if (!name || !adminUsername || !adminPassword || !phone) {
            return res.status(400).json({
                success: false,
                message: 'Hotel name, admin username, password, and phone are required'
            });
        }

        // 2. Check if username or phone already exists
        const existingUser = await User.findOne({ $or: [{ username: adminUsername }, { phone }] });
        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: 'Username or phone already exists'
            });
        }

        // 3. Validate plan if provided
        let assignedPlan = null;
        if (planId) {
            assignedPlan = await Plan.findById(planId);
            if (!assignedPlan || !assignedPlan.isActive) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid or inactive plan ID provided'
                });
            }
        }

        // 4. Create the Hotel (Pending state)
        const hotel = new Hotel({
            name,
            address: address || '',
            city: city || '',
            country: country || '',
            phone,
            email: email || '',
            status: 'pending',
            admin: new mongoose.Types.ObjectId() // Placeholder
        });

        // 5. Create the Admin User
        const hashedPassword = await bcrypt.hash(adminPassword, 10);
        const adminUser = new User({
            username: adminUsername,
            phone,
            password: hashedPassword,
            role: ROLES.HOTEL_ADMIN,
            profile: {
                name: adminName || adminUsername,
                email: email || ''
            },
            hotel: hotel._id,
            creator: req.user.id // Super Admin ID
        });

        // 6. Update Hotel's admin reference
        hotel.admin = adminUser._id;

        await hotel.save({ session });
        await adminUser.save({ session });

        await session.commitTransaction();
        session.endSession();

        res.status(201).json({
            success: true,
            message: assignedPlan
                ? `Hotel created with "${assignedPlan.name}" plan. Subscription will activate on approval.`
                : 'Hotel created successfully and is pending approval. No plan assigned yet.',
            data: {
                hotel,
                admin: {
                    id: adminUser._id,
                    username: adminUser.username,
                    role: adminUser.role
                },
                assignedPlan: assignedPlan ? { id: assignedPlan._id, name: assignedPlan.name, price: assignedPlan.price } : null
            }
        });
    } catch (err) {
        await session.abortTransaction();
        session.endSession();
        console.error('Create Hotel Error:', err);
        res.status(500).json({
            success: false,
            message: 'Internal Server Error'
        });
    }
};

// @desc    Get all hotels
// @route   GET /api/hotels
// @access  Private (Super Admin / Hotel Admin)
exports.getAllHotels = async (req, res) => {
    try {
        const { status, search } = req.query;
        const filter = {};

        if (status) filter.status = status;
        if (search) {
            filter.$or = [
                { name: { $regex: search, $options: 'i' } },
                { city: { $regex: search, $options: 'i' } },
                { phone: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } }
            ];
        }

        const totalHotels = await Hotel.countDocuments(filter);
        const { skip, limit, meta } = getPagination(req.query, totalHotels);

        const hotels = await Hotel.find(filter)
            .populate('admin', 'username phone profile status lastLogin')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        // Fetch active subscriptions for these hotels to show their plans
        const hotelIds = hotels.map(h => h._id);
        const subscriptions = await Subscription.find({
            hotel: { $in: hotelIds },
            status: { $in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] }
        }).populate('plan', 'name planType price billingCycle');

        // Map subscriptions by hotel ID
        const subMap = {};
        subscriptions.forEach(sub => {
            subMap[sub.hotel.toString()] = sub;
        });

        // Attach subscription data to each hotel
        const dataWithPlans = hotels.map(hotel => {
            const hotelObj = hotel.toObject();
            hotelObj.subscription = subMap[hotel._id.toString()] || null;
            return hotelObj;
        });

        res.status(200).json({
            success: true,
            pagination: meta,
            data: dataWithPlans
        });
    } catch (err) {
        console.error('Get All Hotels Error:', err);
        res.status(500).json({
            success: false,
            message: 'Internal Server Error'
        });
    }
};

// @desc    Get single hotel
// @route   GET /api/hotels/:id
// @access  Private
exports.getHotelById = async (req, res) => {
    try {
        const { id } = req.params;

        // 1. Validate ObjectId format
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid Hotel ID format'
            });
        }

        const hotel = await Hotel.findById(id).populate('admin', 'username phone profile.name');

        if (!hotel) {
            return res.status(404).json({
                success: false,
                message: 'Hotel not found'
            });
        }

        res.status(200).json({
            success: true,
            data: hotel
        });
    } catch (err) {
        console.error('Get Hotel By Id Error:', err);
        res.status(500).json({
            success: false,
            message: 'Internal Server Error'
        });
    }
};

// @desc    Update hotel
// @route   PUT /api/hotels/:id
// @access  Private (Super Admin / Hotel Admin)
exports.updateHotel = async (req, res) => {
    try {
        const { id } = req.params;
        const { admin } = req.body;

        // 1. Validate ObjectId format for hotel
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid Hotel ID format'
            });
        }

        // 2. If admin is being changed, validate and sync
        if (admin) {
            if (!mongoose.Types.ObjectId.isValid(admin)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid Admin ID format'
                });
            }
            const adminUser = await User.findById(admin);
            if (!adminUser) {
                return res.status(404).json({
                    success: false,
                    message: 'The assigned admin user does not exist'
                });
            }
            // Update the new admin's hotel field
            await User.findByIdAndUpdate(admin, { hotel: id });
        }

        // 3. Update hotel
        const hotel = await Hotel.findByIdAndUpdate(id, req.body, {
            new: true,
            runValidators: true
        });

        if (!hotel) {
            return res.status(404).json({
                success: false,
                message: 'Hotel not found'
            });
        }

        res.status(200).json({
            success: true,
            data: hotel
        });
    } catch (err) {
        console.error('Update Hotel Error:', err);
        res.status(500).json({
            success: false,
            message: err.name === 'ValidationError' ? err.message : 'Internal Server Error'
        });
    }
};

// @desc    Nuclear Delete Hotel (Cascaded Wipe - Super Admin Only)
// @route   DELETE /api/hotels/:id
// @access  Private (Super Admin Only)
exports.deleteHotel = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const { id } = req.params;

        // Double Security Check: Only Super Admin
        if (req.user.role !== ROLES.SUPER_ADMIN) {
            return res.status(403).json({
                success: false,
                message: 'Only Super Admins can perform a total hotel deletion'
            });
        }

        // 1. Validate ObjectId format
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid Hotel ID format'
            });
        }

        const hotel = await Hotel.findById(id).session(session);

        if (!hotel) {
            return res.status(404).json({
                success: false,
                message: 'Hotel not found'
            });
        }

        // --- NUCLEAR CASCADE WIPE ---
        // (No trace left, no safety checks for active orders)

        // 2. Delete all Users (Admins, Staff, and Customers) belonging to this hotel
        // 🛡️ EXCEPTION: Protect Super Admins from being wiped
        await User.deleteMany({
            hotel: id,
            role: { $ne: ROLES.SUPER_ADMIN }
        }).session(session);

        // 3. Delete all Dishes belonging to this hotel
        await Dish.deleteMany({ hotel: id }).session(session);

        // 4. Delete all Categories belonging to this hotel
        await Category.deleteMany({ hotel: id }).session(session);

        // 5. Delete all Orders belonging to this hotel
        await Order.deleteMany({ hotel: id }).session(session);

        // 6. Delete all Subscriptions, Transactions & Usage for this hotel
        await Subscription.deleteMany({ hotel: id }).session(session);
        await Transaction.deleteMany({ hotel: id }).session(session);
        await Usage.deleteMany({ hotel: id }).session(session);

        // 7. Finally, delete the Hotel itself
        await Hotel.findByIdAndDelete(id).session(session);

        await logAction({
            action: 'HOTEL_DELETE_NUCLEAR',
            performedBy: req.user.id,
            entityType: 'HOTEL',
            entityId: id,
            hotel: id,
            changes: { before: 'NUCLEAR CASCADE WIPED', after: null }
        }, req);

        await session.commitTransaction();
        session.endSession();

        res.status(200).json({
            success: true,
            message: 'NUCLEAR DELETE COMPLETE: Hotel and all associated data (Admins, Staff, Customers, Dishes, Categories, Orders, Subscriptions, Transactions) have been wiped from the system.'
        });
    } catch (err) {
        await session.abortTransaction();
        session.endSession();
        console.error('Nuclear Delete Hotel Error:', err);
        res.status(500).json({
            success: false,
            message: 'Internal Server Error during hotel wipe'
        });
    }
};

// @desc    Get Hotel Dashboard Data
// @route   GET /api/hotels/:id/dashboard
// @access  Private (Super Admin / Hotel Admin)
exports.getHotelDashboard = async (req, res) => {
    try {
        const { id } = req.params;
        const tab = req.query.tab || 'overview';

        // 1. Validate ObjectId format
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid Hotel ID format'
            });
        }

        // 2. Fetch Hotel with Admin Info
        const hotel = await Hotel.findById(id).populate('admin', 'username phone profile.name profile.email');

        if (!hotel) {
            return res.status(404).json({
                success: false,
                message: 'Hotel not found'
            });
        }

        // 3. Authorization Check
        // Hotel Admin can only access their own hotel's dashboard
        if (req.user.role === ROLES.HOTEL_ADMIN && hotel.admin?._id.toString() !== req.user.id) {
            return res.status(403).json({
                success: false,
                message: 'You are not authorized to view this hotel dashboard'
            });
        }

        // 4. Build Filter for Metrics (Daynation)
        const filter = buildFilter(req.query, [], 'orderedAt');
        filter.hotel = new mongoose.Types.ObjectId(id);

        // 5. Always Fetch Summary Counts & Financials (Constant Counts)
        const [
            adminCount,
            staffCount,
            dishCount,
            categoryCount,
            uniqueCustomersCountRes,
            orderStats
        ] = await Promise.all([
            User.countDocuments({ hotel: id, role: ROLES.HOTEL_ADMIN }),
            User.countDocuments({ hotel: id, role: ROLES.STAFF }),
            Dish.countDocuments({ hotel: id }),
            Category.countDocuments({ hotel: id }),
            Order.distinct('customer.phone', { ...filter, 'customer.phone': { $exists: true, $nin: [null, ""] } }),
            Order.aggregate([
                { $match: filter },
                {
                    $group: {
                        _id: null,
                        totalCount: { $sum: 1 },
                        revenue: { $sum: "$grandTotal" }
                    }
                }
            ])
        ]);

        const uniqueCustomersCount = uniqueCustomersCountRes.length;
        const totalOrders = orderStats.length > 0 ? orderStats[0].totalCount : 0;
        const totalRevenue = orderStats.length > 0 ? orderStats[0].revenue : 0;

        const summary = {
            counts: {
                admins: adminCount,
                staff: staffCount,
                customers: uniqueCustomersCount,
                dishes: dishCount,
                categories: categoryCount,
                orders: totalOrders
            },
            financials: {
                totalRevenue: totalRevenue
            }
        };

        // 6. Fetch Subscription Data (Always included)
        const subscription = await Subscription.findOne({
            hotel: id,
            status: { $in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] }
        }).populate('plan');

        let subscriptionData = null;
        if (subscription) {
            subscriptionData = {
                status: subscription.status,
                planName: subscription.plan.name,
                planType: subscription.plan.planType,
                startDate: subscription.startDate,
                endDate: subscription.endDate,
                daysRemaining: Math.max(
                    0,
                    Math.ceil((new Date(subscription.endDate) - new Date()) / (1000 * 60 * 60 * 24))
                ),
                cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
            };
        }

        // 7. Tab-Specific Data Fetching
        let responseData = [];
        let paginationMeta = null;

        switch (tab) {
            case 'staff': {
                const totalItems = staffCount;
                const { skip, limit, meta } = getPagination(req.query, totalItems);
                paginationMeta = meta;

                responseData = await User.find({ hotel: id, role: ROLES.STAFF })
                    .select('username phone profile.name profile.email createdAt')
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(limit)
                    .lean();
                break;
            }

            case 'dishes': {
                const totalItems = dishCount;
                const { skip, limit, meta } = getPagination(req.query, totalItems);
                paginationMeta = meta;

                const dishes = await Dish.find({ hotel: id })
                    .populate('category', 'name')
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(limit)
                    .lean();

                responseData = dishes.map(dish => ({
                    ...dish,
                    category: dish.category?.name || 'Uncategorized'
                }));
                break;
            }

            case 'categories': {
                const totalItems = categoryCount;
                const { skip, limit, meta } = getPagination(req.query, totalItems);
                paginationMeta = meta;

                responseData = await Category.find({ hotel: id })
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(limit)
                    .lean();
                break;
            }

            case 'customers': {
                const totalItems = uniqueCustomersCount;
                const { skip, limit, meta } = getPagination(req.query, totalItems);
                paginationMeta = meta;

                responseData = await Order.aggregate([
                    { $match: { ...filter, 'customer.phone': { $exists: true, $nin: [null, ""] } } },
                    {
                        $group: {
                            _id: "$customer.phone",
                            name: { $first: "$customer.name" },
                            phone: { $first: "$customer.phone" },
                            lastVisit: { $max: "$orderedAt" }
                        }
                    },
                    { $sort: { lastVisit: -1 } },
                    { $skip: skip },
                    { $limit: limit },
                    { $project: { _id: 0, name: 1, phone: 1, lastVisit: 1 } }
                ]);
                break;
            }

            case 'orders': {
                const totalItems = totalOrders;
                const { skip, limit, meta } = getPagination(req.query, totalItems);
                paginationMeta = meta;

                responseData = await Order.find(filter)
                    .sort({ orderedAt: -1 })
                    .skip(skip)
                    .limit(limit)
                    .lean();
                break;
            }

            case 'overview':
            default: {
                // Overview returns small previews of each
                const [staff, dishes, categories, customers, orders] = await Promise.all([
                    User.find({ hotel: id, role: ROLES.STAFF })
                        .select('username phone profile.name profile.email createdAt')
                        .limit(5)
                        .lean(),
                    Dish.find({ hotel: id })
                        .populate('category', 'name')
                        .limit(5)
                        .lean()
                        .then(dishes => dishes.map(d => ({ ...d, category: d.category?.name || 'Uncategorized' }))),
                    Category.find({ hotel: id }).limit(5).lean(),
                    Order.aggregate([
                        { $match: { ...filter, 'customer.phone': { $exists: true, $nin: [null, ""] } } },
                        {
                            $group: {
                                _id: "$customer.phone",
                                name: { $first: "$customer.name" },
                                phone: { $first: "$customer.phone" },
                                lastVisit: { $max: "$orderedAt" }
                            }
                        },
                        { $sort: { lastVisit: -1 } },
                        { $limit: 5 },
                        { $project: { _id: 0, name: 1, phone: 1, lastVisit: 1 } }
                    ]),
                    Order.find(filter)
                        .sort({ orderedAt: -1 })
                        .limit(5)
                        .lean()
                ]);

                responseData = {
                    staff,
                    dishes,
                    categories,
                    customers,
                    orders
                };
                break;
            }
        }

        res.status(200).json({
            success: true,
            activeTab: tab,
            hotel: {
                id: hotel._id,
                name: hotel.name,
                address: hotel.address,
                city: hotel.city,
                country: hotel.country,
                contact: {
                    phone: hotel.phone,
                    email: hotel.email
                }
            },
            admin: hotel.admin,
            summary,
            subscription: subscriptionData,
            data: responseData,
            pagination: paginationMeta
        });

    } catch (err) {
        console.error('Hotel Dashboard Error:', err);
        res.status(500).json({
            success: false,
            message: 'Internal Server Error'
        });
    }
};


// @desc    Approve a hotel (and optionally activate a subscription plan)
// @route   PATCH /api/hotels/:id/approve
// @access  Private (Super Admin only)
// @body    { planId?: String } — Optional plan to assign on approval
exports.approveHotel = async (req, res) => {
    try {
        const { id } = req.params;
        const { planId } = req.body;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid Hotel ID format'
            });
        }

        const hotel = await Hotel.findByIdAndUpdate(id, { status: 'active' }, { new: true });

        if (!hotel) {
            return res.status(404).json({
                success: false,
                message: 'Hotel not found'
            });
        }

        // ── Auto-create Subscription if planId is provided ──
        let subscription = null;
        if (planId) {
            const plan = await Plan.findById(planId);
            if (!plan || !plan.isActive) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid or inactive plan ID'
                });
            }

            // Check if hotel already has an active subscription
            const existingSub = await Subscription.findOne({
                hotel: id,
                status: { $in: ['ACTIVE', 'TRIALING'] }
            });

            if (!existingSub) {
                const now = new Date();
                const endDate = calculateEndDate(now, plan.billingCycle, plan.trialDays);

                subscription = await Subscription.create({
                    hotel: id,
                    plan: plan._id,
                    status: plan.trialDays > 0 ? 'TRIALING' : 'ACTIVE',
                    startDate: now,
                    endDate,
                    trialEndDate: plan.trialDays > 0
                        ? new Date(now.getTime() + plan.trialDays * 86400000)
                        : null,
                });

                // Log a free transaction for admin-assigned plans
                await Transaction.create({
                    hotel: id,
                    subscription: subscription._id,
                    plan: plan._id,
                    amount: plan.price,
                    currency: plan.currency,
                    status: 'SUCCESS',
                    notes: `Plan "${plan.name}" assigned by SuperAdmin on approval.`,
                });
            }
        }

        res.status(200).json({
            success: true,
            message: subscription
                ? `Hotel approved and "${subscription.plan}" plan activated.`
                : 'Hotel approved and is now live. No plan assigned — hotel admin can subscribe later.',
            data: {
                hotel,
                subscription
            }
        });

        await logAction({
            action: 'HOTEL_APPROVE',
            performedBy: req.user.id,
            entityType: 'HOTEL',
            entityId: id,
            hotel: id,
            changes: { before: { status: 'pending' }, after: { status: 'active' } }
        }, req);
    } catch (err) {
        console.error('Approve Hotel Error:', err);
        res.status(500).json({
            success: false,
            message: 'Internal Server Error'
        });
    }
};

// @desc    Get Global Super Admin Dashboard Data
// @route   GET /api/hotels/super/dashboard
// @access  Private (Super Admin Only)
exports.getSuperAdminDashboard = async (req, res) => {
    try {
        // 1. Fetch Core Entities
        const [hotels, users, dishes, categories, orderStats, subscriptions] = await Promise.all([
            Hotel.find().populate('admin', 'username profile.name').lean(),
            User.find({ role: { $in: [ROLES.HOTEL_ADMIN, ROLES.STAFF] } }).select('hotel role').lean(),
            Dish.find().lean(),
            Category.find().lean(),
            Order.aggregate([
                {
                    $group: {
                        _id: "$hotel",
                        count: { $sum: 1 },
                        revenue: { $sum: "$grandTotal" },
                        customers: { $addToSet: "$customer.phone" }
                    }
                }
            ]),
            // Fetch all active/trialing subscriptions with plan details
            Subscription.find({ status: { $in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } })
                .populate('plan', 'name price billingCycle features')
                .lean()
        ]);

        // 2. Global Aggregates
        const globalStats = {
            totalHotels: hotels.length,
            totalStaff: users.filter(u => u.role === ROLES.STAFF).length,
            totalRevenue: orderStats.reduce((acc, curr) => acc + curr.revenue, 0),
            totalUniqueCustomers: new Set(orderStats.flatMap(os => os.customers).filter(p => p)).size,
            // Subscription stats
            totalActiveSubscriptions: subscriptions.filter(s => s.status === 'ACTIVE').length,
            totalTrialing: subscriptions.filter(s => s.status === 'TRIALING').length,
            totalPastDue: subscriptions.filter(s => s.status === 'PAST_DUE').length,
            hotelsWithoutSubscription: hotels.length - subscriptions.length,
        };

        // 2.5 Historical Trends (Last 6 Months)
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

        const [revenueTrend, registrationTrend] = await Promise.all([
            // Monthly Revenue Trend
            Order.aggregate([
                { $match: { orderedAt: { $gte: sixMonthsAgo } } },
                {
                    $group: {
                        _id: { $dateToString: { format: "%Y-%m", date: "$orderedAt" } },
                        totalRevenue: { $sum: "$grandTotal" }
                    }
                },
                { $sort: { "_id": 1 } }
            ]),
            // Monthly Hotel Registration Trend
            Hotel.aggregate([
                { $match: { createdAt: { $gte: sixMonthsAgo } } },
                {
                    $group: {
                        _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } },
                        count: { $sum: 1 }
                    }
                },
                { $sort: { "_id": 1 } }
            ])
        ]);

        // 3. Paginate Hotel Breakdown
        const { skip, limit, meta } = getPagination(req.query, hotels.length);
        const paginatedHotels = hotels.slice(skip, skip + limit);

        const hotelBreakdown = paginatedHotels.map(hotel => {
            const hId = hotel._id.toString();

            const hotelOrderStats = orderStats.find(os => os._id?.toString() === hId) || { count: 0, revenue: 0, customers: [] };
            const hotelDishes = dishes.filter(d => d.hotel?.toString() === hId);
            const hotelCategories = categories.filter(c => c.hotel?.toString() === hId);
            const hotelStaff = users.filter(u => u.hotel?.toString() === hId && u.role === ROLES.STAFF);

            return {
                id: hotel._id,
                name: hotel.name,
                status: hotel.status,
                admin: hotel.admin,
                stats: {
                    staffCount: hotelStaff.length,
                    orderCount: hotelOrderStats.count,
                    revenue: hotelOrderStats.revenue,
                    dishCount: hotelDishes.length,
                    categoryCount: hotelCategories.length,
                    customerCount: hotelOrderStats.customers.filter(p => p).length
                },
                // Subscription info for this hotel
                subscription: (() => {
                    const sub = subscriptions.find(s => s.hotel?.toString() === hId);
                    if (!sub) return null;
                    return {
                        status: sub.status,
                        planName: sub.plan?.name,
                        price: sub.plan?.price,
                        billingCycle: sub.plan?.billingCycle,
                        endDate: sub.endDate,
                        daysRemaining: Math.max(0, Math.ceil((new Date(sub.endDate) - new Date()) / 86400000)),
                    };
                })(),
                catalog: {
                    categories: hotelCategories,
                    dishes: hotelDishes
                }
            };
        });

        res.status(200).json({
            success: true,
            summary: {
                ...globalStats,
                trends: {
                    revenue: revenueTrend,
                    registrations: registrationTrend
                }
            },
            pagination: meta,
            hotels: hotelBreakdown
        });

    } catch (err) {
        console.error('Super Admin Dashboard Error:', err);
        res.status(500).json({
            success: false,
            message: 'Internal Server Error',
            error: err.message
        });
    }
};

// @desc    Get Detailed Paginated Customers for a Hotel
// @route   GET /api/hotels/customers
// @access  Private (Hotel Admin / Staff)
exports.getCustomers = async (req, res) => {
    try {
        const hotelId = req.user.hotel;
        if (!hotelId) return res.status(400).json({ message: 'Hotel reference missing' });

        // 1. Build Filter (Daynation)
        const filter = buildFilter(req.query, [], 'orderedAt');
        filter.hotel = new mongoose.Types.ObjectId(hotelId);

        // 2. Aggregate to find unique customers with visit counts and latest name
        const aggregationStages = [
            { $match: { ...filter, 'customer.phone': { $exists: true, $nin: [null, ""] } } },
            {
                $group: {
                    _id: "$customer.phone",
                    name: { $first: "$customer.name" },
                    phone: { $first: "$customer.phone" },
                    visitCount: { $sum: 1 },
                    totalSpent: { $sum: "$grandTotal" },
                    lastVisit: { $max: "$orderedAt" }
                }
            }
        ];

        // Get total count for pagination (using a separate aggregation for simplicity)
        const totalResult = await Order.aggregate([
            { $match: { ...filter, 'customer.phone': { $exists: true, $nin: [null, ""] } } },
            { $group: { _id: "$customer.phone" } },
            { $count: "count" }
        ]);

        const totalItems = totalResult.length > 0 ? totalResult[0].count : 0;
        const { skip, limit, meta } = getPagination(req.query, totalItems);

        // 3. Execute Paginated Aggregation
        const customers = await Order.aggregate([
            ...aggregationStages,
            { $sort: { lastVisit: -1 } },
            { $skip: skip },
            { $limit: limit }
        ]);

        res.status(200).json({
            success: true,
            pagination: meta,
            data: customers
        });

    } catch (err) {
        console.error('Get Customers Error:', err);
        res.status(500).json({
            success: false,
            message: 'Internal Server Error',
            error: err.message
        });
    }
};

// @desc    Verify Razorpay payment for registration and create account
// @route   POST /api/hotels/verify-registration-payment
// @access  Public
exports.verifyRegistrationPayment = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return res.status(400).json({ success: false, message: 'All payment fields are required.' });
        }

        // 1. Verify the signature
        const generatedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(`${razorpay_order_id}|${razorpay_payment_id}`)
            .digest('hex');

        if (generatedSignature !== razorpay_signature) {
            await Transaction.findOneAndUpdate(
                { razorpayOrderId: razorpay_order_id },
                { status: 'FAILED', notes: 'Signature verification failed during registration.' }
            );
            return res.status(400).json({ success: false, message: 'Payment verification failed.' });
        }

        // 2. Find the pending transaction with registration data
        const transaction = await Transaction.findOne({ 
            razorpayOrderId: razorpay_order_id,
            status: 'PENDING'
        });

        if (!transaction || !transaction.pendingRegistrationData) {
            return res.status(404).json({ success: false, message: 'Pending registration not found or already processed.' });
        }

        const { hotel: hotelData, admin: adminData } = transaction.pendingRegistrationData;

        // Check if user already exists (backup check)
        const existingUser = await User.findOne({ $or: [{ username: adminData.username }, { phone: adminData.phone }] });
        if (existingUser) {
            return res.status(400).json({ success: false, message: 'User already exists' });
        }

        // 3. Create Hotel and Admin User
        const hotel = new Hotel(hotelData);
        const adminUser = new User(adminData);

        await hotel.save({ session });
        await adminUser.save({ session });

        // 4. Create Subscription
        const plan = await Plan.findById(transaction.plan);
        const now = new Date();
        const endDate = calculateEndDate(now, plan.billingCycle, plan.trialDays);

        const sub = await Subscription.create([{
            hotel: hotel._id,
            plan: plan._id,
            status: plan.trialDays > 0 ? 'TRIALING' : 'ACTIVE',
            startDate: now,
            endDate,
            trialEndDate: plan.trialDays > 0
                ? new Date(now.getTime() + (plan.trialDays * 86400000))
                : null,
        }], { session });

        // 5. Update Transaction
        transaction.status = 'SUCCESS';
        transaction.subscription = sub[0]._id;
        transaction.razorpayPaymentId = razorpay_payment_id;
        transaction.razorpaySignature = razorpay_signature;
        transaction.pendingRegistrationData = null; // Clear sensitive data
        await transaction.save({ session });

        await session.commitTransaction();
        session.endSession();

        // 6. Generate Login Token
        const token = jwt.sign(
            { id: adminUser._id, role: adminUser.role, phone: adminUser.phone, hotel: hotel._id },
            process.env.JWT_SECRET || 'your-very-long-random-secret-key-2025',
            { expiresIn: '24h' }
        );

        res.status(200).json({
            success: true,
            message: 'Payment verified and registration completed!',
            token,
            data: {
                hotel: { id: hotel._id, name: hotel.name },
                admin: { id: adminUser._id, username: adminUser.username }
            }
        });

    } catch (err) {
        await session.abortTransaction();
        session.endSession();
        console.error('Verify Registration Payment Error:', err);
        res.status(500).json({ success: false, message: 'Server error during registration completion.', error: err.message });
    }
};
