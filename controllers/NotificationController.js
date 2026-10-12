// controllers/NotificationController.js
const Notification = require('../models/Notification');
const { logAction } = require('../utils/logger');

/**
 * @desc    Create a new notification (Super Admin)
 * @route   POST /api/admin/notifications
 * @access  Private (Super Admin)
 */
exports.createNotification = async (req, res) => {
    try {
        const { title, message, type, target, targetHotel, expiresAt } = req.body;

        const notification = await Notification.create({
            title,
            message,
            type,
            target,
            targetHotel,
            expiresAt,
            createdBy: req.user.id
        });

        await logAction({
            action: 'NOTIFICATION_CREATE',
            performedBy: req.user.id,
            entityType: 'SETTING', // Using SETTING or creating new entity type for logs
            entityId: notification._id,
            changes: { before: null, after: notification.toObject() }
        }, req);

        res.status(201).json({
            success: true,
            message: 'Notification created successfully',
            data: notification
        });
    } catch (err) {
        console.error('CreateNotification Error:', err);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};

/**
 * @desc    Get all notifications (Super Admin)
 * @route   GET /api/admin/notifications
 * @access  Private (Super Admin)
 */
exports.getAllNotifications = async (req, res) => {
    try {
        const notifications = await Notification.find()
            .populate('createdBy', 'username')
            .populate('targetHotel', 'name')
            .sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            count: notifications.length,
            data: notifications
        });
    } catch (err) {
        console.error('GetAllNotifications Error:', err);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};

/**
 * @desc    Delete a notification (Super Admin)
 * @route   DELETE /api/admin/notifications/:id
 * @access  Private (Super Admin)
 */
exports.deleteNotification = async (req, res) => {
    try {
        const notification = await Notification.findByIdAndDelete(req.params.id);
        if (!notification) {
            return res.status(404).json({ success: false, message: 'Notification not found' });
        }

        await logAction({
            action: 'NOTIFICATION_DELETE',
            performedBy: req.user.id,
            entityType: 'SETTING',
            entityId: notification._id,
            changes: { before: notification.toObject(), after: null }
        }, req);

        res.status(200).json({ success: true, message: 'Notification deleted' });
    } catch (err) {
        console.error('DeleteNotification Error:', err);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};

/**
 * @desc    Get active notifications for current user (Hotel Admin/Staff)
 * @route   GET /api/notifications
 * @access  Private
 */
exports.getMyNotifications = async (req, res) => {
    try {
        const now = new Date();
        const role = req.user.role;
        const hotelId = req.user.hotel;

        const filter = {
            isActive: true,
            $or: [
                { expiresAt: { $exists: false } },
                { expiresAt: { $gt: now } }
            ],
            $and: []
        };

        // Target filtering
        const targetOr = [{ target: 'ALL' }];

        if (hotelId) {
            targetOr.push({ target: 'HOTEL_ONLY' });
            targetOr.push({ target: 'SPECIFIC_HOTEL', targetHotel: hotelId });
        }

        if (role === 'STAFF') {
            targetOr.push({ target: 'STAFF_ONLY' });
        }

        filter.$and.push({ $or: targetOr });

        const notifications = await Notification.find(filter)
            .select('-createdBy -targetHotel')
            .sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            count: notifications.length,
            data: notifications
        });
    } catch (err) {
        console.error('GetMyNotifications Error:', err);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};
