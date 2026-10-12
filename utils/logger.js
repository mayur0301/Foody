// utils/logger.js
const AuditLog = require('../models/AuditLog');

/**
 * Log a system action to the AuditLog collection
 * 
 * @param {Object} params
 * @param {String} params.action - Name of the action (e.g., 'UPDATE_PLAN')
 * @param {ObjectId} params.performedBy - User ID of the performer
 * @param {String} params.entityType - Type of entity affected
 * @param {ObjectId} [params.entityId] - ID of the entity affected
 * @param {ObjectId} [params.hotel] - Reference hotel if applicable
 * @param {Object} [params.changes] - before/after state
 * @param {Object} [req] - Express request object to capture IP/UserAgent
 */
exports.logAction = async ({ action, performedBy, entityType, entityId, hotel, changes }, req = null) => {
    try {
        const logData = {
            action,
            performedBy,
            entityType,
            entityId,
            hotel,
            changes
        };

        if (req) {
            logData.ipAddress = req.ip || req.headers['x-forwarded-for'];
            logData.userAgent = req.get('User-Agent');
        }

        await AuditLog.create(logData);
    } catch (err) {
        console.error('Audit Logging Failed:', err);
    }
};
