// middleware/requireFeature.js
const Subscription = require('../models/Subscription');
const { ROLES } = require('../utils/constants');

/**
 * Middleware: Checks if the hotel has an active subscription plan.
 * (Feature checks are currently disabled per simplified plan model)
 * SUPER_ADMIN bypasses all checks.
 */
const requireFeature = (requiredFeature) => {
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

      // Feature-based check is currently disabled due to simplified plan model
      // but we still ensure they have a valid subscription.

      // Attach subscription info to request for downstream use
      req.subscription = subscription;
      next();
    } catch (err) {
      console.error('requireFeature middleware error:', err);
      res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  };
};

module.exports = requireFeature;

