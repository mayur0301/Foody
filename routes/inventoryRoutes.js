const express = require('express');
const router = express.Router();

const {
  addStock,
  adjustStock,
  getInventoryStats,
  getInventoryLogs,
  getInventoryOverview
} = require('../controllers/InventoryController');

const authenticate = require('../middleware/auth');
const allowRoles = require('../middleware/allowedRoles');
const { ROLES } = require('../utils/constants');

// ── Dashboard: View inventory stats ──
router.get('/',
  authenticate,
  allowRoles(ROLES.HOTEL_ADMIN, ROLES.STAFF, ROLES.SUPER_ADMIN),
  getInventoryStats
);

// ── Audit Trail: View inventory logs ──
router.get('/logs',
  authenticate,
  allowRoles(ROLES.HOTEL_ADMIN, ROLES.SUPER_ADMIN),
  getInventoryLogs
);

// ── Overview: View both stats and logs ──
router.get('/overview',
  authenticate,
  allowRoles(ROLES.HOTEL_ADMIN, ROLES.STAFF, ROLES.SUPER_ADMIN),
  getInventoryOverview
);

// ── Add stock to a category ──
router.post('/add',
  authenticate,
  allowRoles(ROLES.HOTEL_ADMIN, ROLES.SUPER_ADMIN),
  addStock
);

// ── Manually adjust stock ──
router.post('/adjust',
  authenticate,
  allowRoles(ROLES.HOTEL_ADMIN, ROLES.SUPER_ADMIN),
  adjustStock
);

module.exports = router;
