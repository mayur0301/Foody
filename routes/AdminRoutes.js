// routes/AdminRoutes.js
const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const allowRoles = require('../middleware/allowedRoles');
const { ROLES } = require('../utils/constants');
const {
    getAllUsers,
    toggleUserStatus,
    deleteUser
} = require('../controllers/UserController');
const {
    getSettings,
    updateSetting,
    getSettingByKey
} = require('../controllers/SettingController');
const {
    getAllLogs,
    getEntityLogs
} = require('../controllers/AuditLogController');
const {
    createNotification,
    getAllNotifications,
    deleteNotification
} = require('../controllers/NotificationController');

// All routes here require Super Admin access
router.use(authenticate, allowRoles(ROLES.SUPER_ADMIN));

/* ═══════════════════════════════════════════
   USER MANAGEMENT
   ═══════════════════════════════════════════ */
router.get('/users', getAllUsers);
router.patch('/users/:id/toggle-status', toggleUserStatus);
router.delete('/users/delete/:id', deleteUser);

/* ═══════════════════════════════════════════
   PLATFORM SETTINGS
   ═══════════════════════════════════════════ */
router.get('/settings', getSettings);
router.get('/settings/:key', getSettingByKey);
router.post('/settings', updateSetting);

router.get('/logs', getAllLogs);
router.get('/logs/:entityType/:entityId', getEntityLogs);

/* ═══════════════════════════════════════════
   NOTIFICATIONS (ANNOUNCEMENTS)
   ═══════════════════════════════════════════ */
router.post('/notifications', createNotification);
router.get('/notifications', getAllNotifications);
router.delete('/notifications/:id', deleteNotification);

module.exports = router;
