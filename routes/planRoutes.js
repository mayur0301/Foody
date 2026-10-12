// routes/planRoutes.js
const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const allowRoles = require('../middleware/allowedRoles');
const { ROLES } = require('../utils/constants');
const {
  createPlan,
  getAllPlans,
  getPlanById,
  updatePlan,
  archivePlan,
  getActivePlans,
  getPlanStats,
} = require('../controllers/planController');

/* ═══════════════════════════════════════════
   PUBLIC ROUTES
   ═══════════════════════════════════════════ */

// GET /api/plans — Public pricing page
router.get('/', getActivePlans);

/* ═══════════════════════════════════════════
   SUPERADMIN ROUTES — mounted at /api/admin/plans
   ═══════════════════════════════════════════ */

// All admin routes require authentication + SUPER_ADMIN role
router.use('/admin', authenticate, allowRoles(ROLES.SUPER_ADMIN));

router.get('/admin', getAllPlans);
router.get('/admin/stats', getPlanStats);
router.get('/admin/:id', getPlanById);
router.post('/admin', createPlan);
router.put('/admin/:id', updatePlan);
router.delete('/admin/:id', archivePlan);

module.exports = router;
