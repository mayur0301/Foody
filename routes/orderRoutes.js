const express = require('express');
const router = express.Router();

const {
  createOrder,
  getMyOrders,
  getOrderById,
  updateOrderStatus,
  cancelOrder,
  generateOrderBill,
  editOrder,
  staffEditOrder
} = require('../controllers/orderController');

const authenticate = require('../middleware/auth');
const allowRoles = require('../middleware/allowedRoles');
const requireFeature = require('../middleware/requireFeature');
const { ROLES, FEATURES } = require('../utils/constants');

// ── Create Order: Requires ORDER_MANAGEMENT feature ──
router.post('/',
  authenticate,
  requireFeature(FEATURES.ORDER_MANAGEMENT),
  createOrder
);

router.get('/', authenticate, getMyOrders);
router.get('/:id', authenticate, getOrderById);
router.put('/update/:orderId', authenticate, editOrder);
router.delete('/:id', authenticate, cancelOrder);

// Staff/Admin can update status & generate bills
router.patch('/:id/status', authenticate, allowRoles(ROLES.HOTEL_ADMIN, ROLES.STAFF), updateOrderStatus);
router.get('/:id/bill', authenticate, allowRoles(ROLES.HOTEL_ADMIN, ROLES.STAFF), generateOrderBill);

// Staff-only edit order
router.put('/staff-edit/:orderId', authenticate, allowRoles(ROLES.STAFF), staffEditOrder);

module.exports = router;