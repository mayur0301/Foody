// controllers/AuditLogController.js
const AuditLog = require('../models/AuditLog');
const getPagination = require('../utils/pagination');

/**
 * @desc    Get all audit logs
 * @route   GET /api/admin/logs
 * @access  Private (Super Admin)
 */
exports.getAllLogs = async (req, res) => {
    try {
        const { action, entityType, performedBy, hotel } = req.query;
        const filter = {};

        if (action) filter.action = action;
        if (entityType) filter.entityType = entityType;
        if (performedBy) filter.performedBy = performedBy;
        if (hotel) filter.hotel = hotel;

        const totalLogs = await AuditLog.countDocuments(filter);
        const { skip, limit, meta } = getPagination(req.query, totalLogs);

        const logs = await AuditLog.find(filter)
            .populate('performedBy', 'username profile.name')
            .populate('hotel', 'name')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        res.status(200).json({
            success: true,
            pagination: meta,
            data: logs
        });
    } catch (err) {
        console.error('GetAllLogs Error:', err);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};

/**
 * @desc    Get logs for a specific entity
 * @route   GET /api/admin/logs/:entityType/:entityId
 * @access  Private (Super Admin)
 */
exports.getEntityLogs = async (req, res) => {
    try {
        const { entityType, entityId } = req.params;
        const logs = await AuditLog.find({ entityType, entityId })
            .populate('performedBy', 'username profile.name')
            .sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            count: logs.length,
            data: logs
        });
    } catch (err) {
        console.error('GetEntityLogs Error:', err);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};
