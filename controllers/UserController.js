// controllers/UserController.js
const User = require('../models/User');
const Hotel = require('../models/Hotel');
const getPagination = require('../utils/pagination');
const { logAction } = require('../utils/logger');

/**
 * @desc    Get all users across all hotels (Super Admin)
 * @route   GET /api/admin/users
 * @access  Private (Super Admin)
 */
exports.getAllUsers = async (req, res) => {
    try {
        const { role, hotel, search, status } = req.query;
        const filter = {};

        if (role) filter.role = role;
        if (hotel) filter.hotel = hotel;
        if (status) filter.status = status;
        if (search) {
            filter.$or = [
                { username: { $regex: search, $options: 'i' } },
                { phone: { $regex: search, $options: 'i' } },
                { 'profile.name': { $regex: search, $options: 'i' } },
                { 'profile.email': { $regex: search, $options: 'i' } }
            ];
        }

        const totalUsers = await User.countDocuments(filter);
        const { skip, limit, meta } = getPagination(req.query, totalUsers);

        const users = await User.find(filter)
            .populate('hotel') // Fetch full hotel details
            .populate('creator', 'username phone profile.name') // Plus basic info on who created this user
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);


        // ✅ NEW: Fetch active subscriptions for these hotels to show their plans
        const Subscription = require('../models/Subscription');
        const hotelIds = [...new Set(users.map(u => u.hotel?._id).filter(id => id))];
        
        const subscriptions = await Subscription.find({
            hotel: { $in: hotelIds },
            status: { $in: ['ACTIVE', 'TRIALING'] }
        }).populate('plan', 'name planType price billingCycle');

        // Map subscriptions by hotel ID for easy lookup
        const subMap = {};
        subscriptions.forEach(sub => {
            subMap[sub.hotel.toString()] = sub;
        });

        // Attach subscription data to each user
        const dataWithPlans = users.map(user => {
            const userObj = user.toObject();
            if (userObj.hotel) {
                userObj.hotel.subscription = subMap[userObj.hotel._id.toString()] || null;
            }
            return userObj;
        });

        res.status(200).json({
            success: true,
            pagination: meta,
            data: dataWithPlans
        });

    } catch (err) {
        console.error('GetAllUsers Error:', err);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};

/**
 * @desc    Toggle user status (active <-> blocked)
 * @route   PATCH /api/admin/users/:id/toggle-status
 * @access  Private (Super Admin)
 */
exports.toggleUserStatus = async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const oldStatus = user.status || 'active';
        const newStatus = oldStatus === 'active' ? 'blocked' : 'active';

        user.status = newStatus;
        await user.save();

        await logAction({
            action: 'USER_STATUS_TOGGLE',
            performedBy: req.user.id,
            entityType: 'USER',
            entityId: user._id,
            hotel: user.hotel,
            changes: { before: { status: oldStatus }, after: { status: newStatus } }
        }, req);

        res.status(200).json({
            success: true,
            message: `User status toggled to ${newStatus}`,
            data: user
        });
    } catch (err) {
        console.error('ToggleUserStatus Error:', err);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};

/**
 * @desc    Delete a user globally
 * @route   DELETE /api/admin/users/:id
 * @access  Private (Super Admin)
 */
exports.deleteUser = async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        // Prevent deleting yourself
        if (user._id.toString() === req.user.id) {
            return res.status(400).json({ success: false, message: 'You cannot delete your own account' });
        }

        await User.findByIdAndDelete(req.params.id);

        await logAction({
            action: 'USER_DELETE',
            performedBy: req.user.id,
            entityType: 'USER',
            entityId: user._id,
            hotel: user.hotel,
            changes: { before: user.toObject(), after: null }
        }, req);

        res.status(200).json({
            success: true,
            message: 'User deleted successfully'
        });
    } catch (err) {
        console.error('DeleteUser Error:', err);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};
