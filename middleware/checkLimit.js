// middleware/checkLimit.js
const Subscription = require('../models/Subscription');
const { ROLES } = require('../utils/constants');

/**
 * Middleware: Checks if a hotel has an active subscription.
 * (Limit checks are currently disabled per simplified plan model)
 * SUPER_ADMIN bypasses all checks.
 */
const checkLimit = (limitKey, countFn) => {
  return async (req, res, next) => {
    try {
      // 👑 Super Admin bypass
      if (req.user.role === ROLES.SUPER_ADMIN) return next();

      const hotelId = req.user.hotel;
      if (!hotelId) {
        return res.status(403).json({ success: false, message: 'No hotel associated with this user.' });
      }

      const subscription = await Subscription.findOne({
        hotel: hotelId,
        status: { $in: ['ACTIVE', 'TRIALING'] },
      }).populate('plan');

      if (!subscription) {
        return res.status(403).json({
          success: false,
          message: 'No active subscription. Please subscribe to a plan.',
        });
      }

      // Limit checking is currently disabled due to simplified plan model (all operations unlimited)
      req.subscription = subscription;
      next();
    } catch (err) {
      console.error('checkLimit middleware error:', err);
      res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  };
};

module.exports = checkLimit;

