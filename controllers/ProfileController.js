const User = require('../models/User');
const Subscription = require('../models/Subscription');
const { ROLES } = require('../utils/constants');

exports.getProfile = async (req, res) => {
  try {
    // Safety check
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized access'
      });
    }

    const user = await User.findById(req.user.id)
      .select('-password')
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // 3. Include detailed subscription/plan info for Hotel Admins & Staff
    let subscriptionData = null;
    if ((user.role === ROLES.HOTEL_ADMIN || user.role === ROLES.STAFF) && user.hotel) {
      const subscription = await Subscription.findOne({
        hotel: user.hotel,
        status: { $in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] }
      }).populate('plan');

      if (subscription) {
        subscriptionData = {
          id: subscription._id,
          status: subscription.status,
          startDate: subscription.startDate,
          endDate: subscription.endDate,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
          daysRemaining: Math.max(0, Math.ceil((new Date(subscription.endDate) - new Date()) / (1000 * 60 * 60 * 24))),
          plan: {
            id: subscription.plan?._id,
            name: subscription.plan?.name,
            planType: subscription.plan?.planType,
            price: subscription.plan?.price,
            currency: subscription.plan?.currency || 'INR',
            billingCycle: subscription.plan?.billingCycle,
            trialDays: subscription.plan?.trialDays || 0,
            features: subscription.plan?.features || []
          }
        };
      }
    }

    return res.json({
      success: true,
      profile: user,
      subscription: subscriptionData
    });


  } catch (err) {
    console.error('Get profile error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch profile',
      error: err.message
    });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const { username, phone, name, email } = req.body;

    const updateData = {};

    // root-level fields
    if (username) updateData.username = username;
    if (phone) updateData.phone = phone;

    // nested profile fields
    if (name) updateData['profile.name'] = name;
    if (email) updateData['profile.email'] = email;

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: user
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
};
