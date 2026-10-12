// controllers/subscriptionController.js
const crypto = require('crypto');
const Plan = require('../models/Plan');
const Subscription = require('../models/Subscription');
const Transaction = require('../models/Transaction');
const Usage = require('../models/Usage');
const Hotel = require('../models/Hotel');
const User = require('../models/User');
const razorpay = require('../config/razorpay');
const { calculateEndDate } = require('../utils/subscription');

/* ═══════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════ */

// Moved to utils/subscription.js

/* ═══════════════════════════════════════════
   HOTEL — View Subscription
   ═══════════════════════════════════════════ */

/**
 * @desc    Get current hotel's subscription details
 * @route   GET /api/subscription
 * @access  HOTEL_ADMIN
 */
exports.getMySubscription = async (req, res) => {
  try {
    // Find the currently active or trialing subscription
    const subscription = await Subscription.findOne({
      hotel: req.user.hotel,
      status: { $in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] },
    }).populate('plan');

    // Also look for any queued upcoming subscription
    const upcomingSubscription = await Subscription.findOne({
      hotel: req.user.hotel,
      status: 'UPCOMING'
    }).populate('plan');

    if (!subscription && !upcomingSubscription) {
      return res.json({
        success: true,
        data: null,
        message: 'No active subscription. Please subscribe to a plan.',
      });
    }

    // Get usage metrics for the active subscription (if it exists)
    let usageRecords = [];
    if (subscription) {
      usageRecords = await Usage.find({ subscription: subscription._id });
    }

    res.json({
      success: true,
      data: {
        subscription: subscription || upcomingSubscription, // Fallback if only upcoming
        upcomingSubscription,
        usage: usageRecords,
        daysRemaining: subscription ? Math.max(
          0,
          Math.ceil((new Date(subscription.endDate) - new Date()) / (1000 * 60 * 60 * 24))
        ) : 0,
      },
    });
  } catch (err) {
    console.error('getMySubscription error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch subscription.' });
  }
};

/* ═══════════════════════════════════════════
   HOTEL — Create Razorpay Order (Step 1)
   ═══════════════════════════════════════════ */

/**
 * @desc    Create a Razorpay order for a plan subscription
 * @route   POST /api/subscription/create-order
 * @access  HOTEL_ADMIN
 * @body    { planId: String }
 */
exports.createOrder = async (req, res) => {
  try {
    const { planId } = req.body;
    const hotelId = req.user.hotel;

    if (!planId) {
      return res.status(400).json({ success: false, message: 'planId is required.' });
    }

    // 1. Validate plan
    const plan = await Plan.findById(planId);
    if (!plan || !plan.isActive) {
      return res.status(404).json({ success: false, message: 'Plan not found or inactive.' });
    }

    // 2. Check current subscription status
    const existingActive = await Subscription.findOne({
      hotel: hotelId,
      status: 'ACTIVE',
    });

    if (existingActive) {
      return res.status(409).json({
        success: false,
        message: 'You already have an active paid subscription..',
      });
    }

    const existingUpcoming = await Subscription.findOne({
      hotel: hotelId,
      status: 'UPCOMING',
    });

    if (existingUpcoming) {
      return res.status(409).json({
        success: false,
        message: 'You already have a paid plan queued to start after your current trial/active period.',
      });
    }

    // 3. Handle free / trial plans without payment
    if (plan.price === 0) {
      const now = new Date();
      const endDate = calculateEndDate(now, plan.billingCycle, plan.trialDays);

      const subscription = await Subscription.create({
        hotel: hotelId,
        plan: plan._id,
        status: plan.trialDays > 0 ? 'TRIALING' : 'ACTIVE',
        startDate: now,
        endDate,
        trialEndDate: plan.trialDays > 0
          ? new Date(now.getTime() + plan.trialDays * 86400000)
          : null,
      });

      await Transaction.create({
        hotel: hotelId,
        subscription: subscription._id,
        plan: plan._id,
        amount: 0,
        currency: plan.currency,
        status: 'SUCCESS',
        type: 'NEW',
        notes: 'Free plan activation.',
      });

      return res.status(201).json({
        success: true,
        message: 'Free plan activated successfully.',
        data: subscription,
      });
    }

    // 4. Create Razorpay Order
    const orderOptions = {
      amount: Math.round(plan.price * 100), // Razorpay expects paise
      currency: plan.currency || 'INR',
      receipt: `sub_${Date.now().toString().slice(-10)}`,
      notes: {
        hotelId: hotelId.toString(),
        planId: plan._id.toString(),
        planName: plan.name,
      },
    };

    const razorpayOrder = await razorpay.orders.create(orderOptions);

    // 5. Create a PENDING transaction record
    await Transaction.create({
      hotel: hotelId,
      plan: plan._id,
      amount: plan.price,
      currency: plan.currency,
      status: 'PENDING',
      type: 'NEW',
      razorpayOrderId: razorpayOrder.id,
      notes: `Order created for plan: ${plan.name}`,
    });

    res.status(201).json({
      success: true,
      message: 'Razorpay order created. Complete payment on the frontend.',
      data: {
        orderId: razorpayOrder.id,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
        planName: plan.name,
        keyId: process.env.RAZORPAY_KEY_ID, // Frontend needs this to open checkout
      },
    });
  } catch (err) {
    console.error('createOrder error:', err);
    res.status(500).json({ success: false, message: 'Failed to create order.', error: err.message });
  }
};

/* ═══════════════════════════════════════════
   HOTEL — Verify Payment & Activate (Step 2)
   ═══════════════════════════════════════════ */

/**
 * @desc    Verify Razorpay payment signature and activate subscription
 * @route   POST /api/subscription/verify-payment
 * @access  HOTEL_ADMIN
 * @body    { razorpay_order_id, razorpay_payment_id, razorpay_signature }
 */
exports.verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    // ✅ ONLY trust user.hotel (avoid header/body tampering in prod)
    const hotelId = req.user?.hotel || null;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, message: 'All payment fields are required.' });
    }

    // 1. Verify signature
    const generatedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (generatedSignature !== razorpay_signature) {
      await Transaction.findOneAndUpdate(
        { razorpayOrderId: razorpay_order_id },
        { status: 'FAILED', notes: 'Signature verification failed.' }
      );
      return res.status(400).json({ success: false, message: 'Payment verification failed. Invalid signature.' });
    }

    // 2. Idempotency-safe fetch (process only if PENDING)
    const query = {
      razorpayOrderId: razorpay_order_id,
      status: { $ne: 'SUCCESS' }
    };
    if (hotelId) query.hotel = hotelId;

    const transaction = await Transaction.findOne(query);
    if (!transaction) {
      return res.status(200).json({ success: true, message: 'Payment already processed or not found.' });
    }

    // 2.1 Handle Pending Registration Data
    if (transaction.pendingRegistrationData && transaction.type === 'NEW') {
      const { hotel, admin } = transaction.pendingRegistrationData;

      const existingHotel = await Hotel.findById(hotel._id);
      if (!existingHotel) {
        console.log(`Creating hotel ${hotel.name} from pending registration...`);
        await Hotel.create(hotel);
        await User.create(admin);
      }
    }

    // 3. Get plan
    const plan = await Plan.findById(transaction.plan);
    if (!plan) {
      return res.status(404).json({ success: false, message: 'Associated plan not found.' });
    }

    // =========================
    // 4. RECHARGE
    // =========================
    if (transaction.type === 'RECHARGE') {
      const subscription = await Subscription.findById(transaction.subscription);

      if (!subscription || subscription.hotel.toString() !== transaction.hotel.toString()) {
        return res.status(404).json({ success: false, message: 'Invalid subscription for recharge.' });
      }

      const now = new Date();
      const baseDate = subscription.endDate > now ? subscription.endDate : now;
      const newEndDate = calculateEndDate(baseDate, plan.billingCycle, 0);

      subscription.endDate = newEndDate;
      subscription.status = 'ACTIVE';
      await subscription.save();

      transaction.status = 'SUCCESS';
      transaction.razorpayPaymentId = razorpay_payment_id;
      transaction.razorpaySignature = razorpay_signature;
      await transaction.save();

      return res.json({
        success: true,
        message: 'Subscription recharged successfully!',
        data: { subscription, newEndDate },
      });
    }

    // =========================
    // 5. UPGRADE
    // =========================
    if (transaction.type === 'UPGRADE') {
      const currentSub = await Subscription.findOne({
        hotel: transaction.hotel,
        status: { $in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] },
      });

      let subStatus = 'ACTIVE';
      let subStartDate = new Date();

      if (currentSub && currentSub.status === 'TRIALING') {
        subStatus = 'UPCOMING';
        subStartDate = currentSub.endDate;
      } else if (currentSub) {
        currentSub.status = 'CANCELED';
        currentSub.cancelledAt = new Date();
        currentSub.cancelReason = `Upgraded to ${plan.name}`;
        await currentSub.save();
      }

      const endDate = calculateEndDate(subStartDate, plan.billingCycle, 0);

      const subscription = await Subscription.create({
        hotel: transaction.hotel,
        plan: plan._id,
        status: subStatus,
        startDate: subStartDate,
        endDate,
      });

      transaction.status = 'SUCCESS';
      transaction.subscription = subscription._id;
      transaction.razorpayPaymentId = razorpay_payment_id;
      transaction.razorpaySignature = razorpay_signature;
      await transaction.save();

      return res.json({
        success: true,
        message: subStatus === 'UPCOMING'
          ? `Plan purchased! It will activate on ${subStartDate.toISOString().split('T')[0]}`
          : 'Plan upgraded successfully!',
        data: { subscription, planName: plan.name },
      });
    }

    // =========================
    // 6. NEW SUBSCRIPTION
    // =========================
    const now = new Date();
    let finalStatus = plan.trialDays > 0 ? 'TRIALING' : 'ACTIVE';
    let finalStartDate = now;

    const existingTrialSub = await Subscription.findOne({
      hotel: transaction.hotel,
      status: 'TRIALING'
    });

    if (existingTrialSub && plan.price > 0) {
      finalStatus = 'UPCOMING';
      finalStartDate = existingTrialSub.endDate;
    }

    const finalEndDate = calculateEndDate(
      finalStartDate,
      plan.billingCycle,
      finalStatus === 'UPCOMING' ? 0 : plan.trialDays
    );

    const newSubscription = await Subscription.create({
      hotel: transaction.hotel,
      plan: plan._id,
      status: finalStatus,
      startDate: finalStartDate,
      endDate: finalEndDate,
      trialEndDate: finalStatus === 'TRIALING'
        ? new Date(finalStartDate.getTime() + plan.trialDays * 86400000)
        : null,
    });

    transaction.status = 'SUCCESS';
    transaction.subscription = newSubscription._id;
    transaction.razorpayPaymentId = razorpay_payment_id;
    transaction.razorpaySignature = razorpay_signature;
    await transaction.save();

    return res.json({
      success: true,
      message: 'Payment verified and subscription activated!',
      data: {
        subscription: newSubscription,
        plan: {
          name: plan.name,
          planType: plan.planType,
        },
      },
    });

  } catch (err) {
    console.error('verifyPayment error:', err);
    return res.status(500).json({
      success: false,
      message: 'Payment verification failed.',
      error: err.message
    });
  }
};
// exports.verifyPayment = async (req, res) => {
//   try {
//     const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
//     const hotelId = req.user?.hotel || req.body.hotelId || req.headers['x-hotel-id'] || null;

//     if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
//       return res.status(400).json({ success: false, message: 'All payment fields are required.' });
//     }

//     // 1. Verify the signature
//     const generatedSignature = crypto
//       .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
//       .update(`${razorpay_order_id}|${razorpay_payment_id}`)
//       .digest('hex');

//     if (generatedSignature !== razorpay_signature) {
//       // Mark transaction as failed
//       await Transaction.findOneAndUpdate(
//         { razorpayOrderId: razorpay_order_id },
//         { status: 'FAILED', notes: 'Signature verification failed.' }
//       );
//       return res.status(400).json({ success: false, message: 'Payment verification failed. Invalid signature.' });
//     }

//     // 2. Find the pending transaction
//     const query = { razorpayOrderId: razorpay_order_id };
//     if (hotelId) query.hotel = hotelId;

//     const transaction = await Transaction.findOne(query);
//     if (!transaction) {
//       return res.status(404).json({ success: false, message: 'Transaction not found.' });
//     }
//     if (transaction.status === 'SUCCESS') {
//       return res.status(200).json({ success: true, message: 'Payment already processed.' });
//     }

//     // 2.1 Handle Pending Registration Data (Create Hotel & Admin User)
//     if (transaction.pendingRegistrationData) {
//       const { hotel, admin } = transaction.pendingRegistrationData;

//       // Double Check: Ensure hotel doesn't already exist from a previous attempt
//       const existingHotel = await Hotel.findById(hotel._id);
//       if (!existingHotel) {
//         console.log(`Creating hotel ${hotel.name} from pending registration...`);
//         await Hotel.create(hotel);
//         await User.create(admin);
//       }
//     }

//     // 3. Get the plan
//     const plan = await Plan.findById(transaction.plan);
//     if (!plan) {
//       return res.status(404).json({ success: false, message: 'Associated plan not found.' });
//     }

//     // 4. Handle based on Transaction Type
//     if (transaction.type === 'RECHARGE') {
//       // Find the subscription to recharge
//       const subscription = await Subscription.findById(transaction.subscription);
//       if (!subscription) {
//         return res.status(404).json({ success: false, message: 'Subscription to recharge not found.' });
//       }

//       // Calculate new end date (add period to current end date)
//       const now = new Date();
//       // If currently expired/past_due, start from now. If active, extend from current end date.
//       const baseDate = subscription.endDate > now ? subscription.endDate : now;
//       const newEndDate = calculateEndDate(baseDate, plan.billingCycle, 0);

//       subscription.endDate = newEndDate;
//       subscription.status = 'ACTIVE';
//       await subscription.save();

//       // Update the transaction
//       transaction.status = 'SUCCESS';
//       transaction.razorpayPaymentId = razorpay_payment_id;
//       transaction.razorpaySignature = razorpay_signature;
//       await transaction.save();

//       return res.json({
//         success: true,
//         message: 'Subscription recharged successfully!',
//         data: { subscription, newEndDate },
//       });
//     }

//     if (transaction.type === 'UPGRADE') {
//       const currentSub = await Subscription.findOne({
//         hotel: transaction.hotel,
//         status: { $in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] },
//       });

//       let subStatus = 'ACTIVE';
//       let subStartDate = new Date();

//       if (currentSub && currentSub.status === 'TRIALING') {
//         subStatus = 'UPCOMING';
//         subStartDate = currentSub.endDate;
//       } else if (currentSub) {
//         currentSub.status = 'CANCELED';
//         currentSub.cancelledAt = new Date();
//         currentSub.cancelReason = `Upgraded to ${plan.name}`;
//         await currentSub.save();
//       }

//       // Create the new subscription
//       const endDate = calculateEndDate(subStartDate, plan.billingCycle, 0);

//       const subscription = await Subscription.create({
//         hotel: transaction.hotel,
//         plan: plan._id,
//         status: subStatus,
//         startDate: subStartDate,
//         endDate,
//       });

//       // Update the transaction
//       transaction.status = 'SUCCESS';
//       transaction.subscription = subscription._id;
//       transaction.razorpayPaymentId = razorpay_payment_id;
//       transaction.razorpaySignature = razorpay_signature;
//       await transaction.save();

//       return res.json({
//         success: true,
//         message: subStatus === 'UPCOMING'
//           ? `Plan purchased! It will automatically activate when your trial ends on ${subStartDate.toISOString().split('T')[0]}.`
//           : 'Plan upgraded successfully!',
//         data: { subscription, planName: plan.name },
//       });
//     }

//     // Default: NEW subscription
//     const now = new Date();
//     let finalStatus = plan.trialDays > 0 ? 'TRIALING' : 'ACTIVE';
//     let finalStartDate = now;

//     // Check if there's an existing trialing sub to queue this new one
//     const existingTrialSub = await Subscription.findOne({
//       hotel: transaction.hotel,
//       status: 'TRIALING'
//     });

//     if (existingTrialSub && plan.price > 0) {
//       finalStatus = 'UPCOMING';
//       finalStartDate = existingTrialSub.endDate;
//     }

//     const finalEndDate = calculateEndDate(finalStartDate, plan.billingCycle, finalStatus === 'UPCOMING' ? 0 : plan.trialDays);

//     const newSubscription = await Subscription.create({
//       hotel: transaction.hotel,
//       plan: plan._id,
//       status: finalStatus,
//       startDate: finalStartDate,
//       endDate: finalEndDate,
//       trialEndDate: (finalStatus === 'TRIALING')
//         ? new Date(finalStartDate.getTime() + plan.trialDays * 86400000)
//         : null,
//     });

//     // 5. Update the transaction
//     transaction.status = 'SUCCESS';
//     transaction.subscription = newSubscription._id;
//     transaction.razorpayPaymentId = razorpay_payment_id;
//     transaction.razorpaySignature = razorpay_signature;
//     await transaction.save();

//     res.json({
//       success: true,
//       message: 'Payment verified and subscription activated!',
//       data: {
//         subscription: newSubscription,
//         plan: {
//           name: plan.name,
//           planType: plan.planType,
//         },
//       },
//     });
//   } catch (err) {
//     console.error('verifyPayment error:', err);
//     res.status(500).json({ success: false, message: 'Payment verification failed.', error: err.message });
//   }
// };

/* ═══════════════════════════════════════════
   HOTEL — Recharge Current Plan
   ═══════════════════════════════════════════ */

/**
 * @desc    Recharge current subscription (extend end date)
 * @route   POST /api/subscription/recharge
 * @access  HOTEL_ADMIN
 */
exports.rechargeSubscription = async (req, res) => {
  try {
    const { planId } = req.body; // Optional: provide to update/change plan
    const hotelId = req.user.hotel;

    // 1. Find the most recent/active subscription
    const currentSub = await Subscription.findOne({
      hotel: hotelId,
      status: { $in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] },
    }).populate('plan');

    if (!currentSub) {
      return res.status(404).json({
        success: false,
        message: 'No active/past_due subscription found. Use create-order to start a new plan.',
      });
    }

    // 2. Decide if this is a RECHARGE or an UPDATE
    let targetPlan = currentSub.plan;
    let isUpdate = false;

    if (planId && planId !== currentSub.plan._id.toString()) {
      // It's an UPDATE/CHANGE plan
      const newPlan = await Plan.findById(planId);
      if (!newPlan || !newPlan.isActive) {
        return res.status(404).json({ success: false, message: 'Target plan not found or inactive.' });
      }
      targetPlan = newPlan;
      isUpdate = true;
    }

    // 3. Handle 0-price plans (cannot recharge/update to/from free without payment if it's the same)
    if (targetPlan.price === 0 && !isUpdate) {
      return res.status(400).json({
        success: false,
        message: 'Free/Trial plans cannot be recharged. Please provide a planId for a paid plan to upgrade.',
      });
    }

    // 4. Calculate amount
    let amountDue;
    let credit = 0;

    if (isUpdate) {
      // Calculate proration credit from current plan
      const now = new Date();
      const totalDays = Math.ceil((currentSub.endDate - currentSub.startDate) / 86400000);
      const usedDays = Math.ceil((now - currentSub.startDate) / 86400000);
      const remainingDays = Math.max(0, totalDays - usedDays);
      const dailyRate = currentSub.plan.price / (totalDays || 1);
      credit = Math.max(0, Math.round(dailyRate * remainingDays * 100) / 100);

      amountDue = Math.max(0, targetPlan.price - credit);
    } else {
      // Simple recharge
      amountDue = targetPlan.price;
    }

    // 5. Handle cases where amountDue is 0 (e.g. upgrade covered by credit)
    if (amountDue === 0 && isUpdate) {
      // Process upgrade immediately
      const now = new Date();
      currentSub.status = 'CANCELED';
      currentSub.cancelledAt = now;
      currentSub.cancelReason = `Upgraded to ${targetPlan.name} (Credit covered cost)`;
      await currentSub.save();

      const { calculateEndDate } = require('../utils/subscription');
      const endDate = calculateEndDate(now, targetPlan.billingCycle, targetPlan.trialDays);
      const newSub = await Subscription.create({
        hotel: hotelId,
        plan: targetPlan._id,
        status: 'ACTIVE',
        startDate: now,
        endDate,
      });

      return res.json({
        success: true,
        message: `Plan updated to ${targetPlan.name}. Credit of ₹${credit} covered the cost.`,
        data: newSub,
      });
    }

    // 6. Create Razorpay Order
    const orderOptions = {
      amount: Math.round(amountDue * 100),
      currency: targetPlan.currency || 'INR',
      receipt: `${isUpdate ? 'upg' : 'rec'}_${Date.now().toString().slice(-10)}`,
      notes: {
        hotelId: hotelId.toString(),
        subscriptionId: currentSub._id.toString(),
        planId: targetPlan._id.toString(),
        type: isUpdate ? 'UPGRADE' : 'RECHARGE',
      },
    };

    const razorpayOrder = await razorpay.orders.create(orderOptions);

    // 7. Create Pending Transaction
    await Transaction.create({
      hotel: hotelId,
      subscription: currentSub._id,
      plan: targetPlan._id,
      amount: amountDue,
      currency: targetPlan.currency,
      status: 'PENDING',
      type: isUpdate ? 'UPGRADE' : 'RECHARGE',
      razorpayOrderId: razorpayOrder.id,
      notes: isUpdate
        ? `Upgrade to ${targetPlan.name}. Credit: ₹${credit}`
        : `Recharge for plan: ${targetPlan.name}`,
    });

    res.status(201).json({
      success: true,
      message: `${isUpdate ? 'Update' : 'Recharge'} order created.`,
      data: {
        orderId: razorpayOrder.id,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
        planName: targetPlan.name,
        credit: isUpdate ? credit : 0,
        type: isUpdate ? 'UPGRADE' : 'RECHARGE',
        keyId: process.env.RAZORPAY_KEY_ID,
      },
    });
  } catch (err) {
    console.error('Unified recharge error:', err);
    res.status(500).json({ success: false, message: 'Failed to process subscription update.', error: err.message });
  }
};

/* ═══════════════════════════════════════════
   HOTEL — Cancel Subscription
   ════════════════════════════════════ ═══════ */

/**
 * @desc    Cancel subscription at period end
 * @route   POST /api/subscription/cancel
 * @access  HOTEL_ADMIN
 * @body    { reason?: String }
 */
exports.cancelSubscription = async (req, res) => {
  try {
    const hotelId = req.user.hotel;
    const { reason } = req.body;

    const subscription = await Subscription.findOne({
      hotel: hotelId,
      status: { $in: ['ACTIVE', 'TRIALING'] },
    });

    if (!subscription) {
      return res.status(404).json({ success: false, message: 'No active subscription found.' });
    }

    subscription.cancelAtPeriodEnd = true;
    subscription.cancelledAt = new Date();
    subscription.cancelReason = reason || 'User requested cancellation';
    await subscription.save();

    res.json({
      success: true,
      message: `Subscription will be canceled at the end of the billing period (${subscription.endDate.toISOString().split('T')[0]}).`,
      data: subscription,
    });
  } catch (err) {
    console.error('cancelSubscription error:', err);
    res.status(500).json({ success: false, message: 'Failed to cancel subscription.' });
  }
};

/* ═══════════════════════════════════════════
   HOTEL — Transaction History
   ═══════════════════════════════════════════ */

/**
 * @desc    Get hotel's payment/transaction history
 * @route   GET /api/subscription/transactions
 * @access  HOTEL_ADMIN
 */
exports.getTransactionHistory = async (req, res) => {
  try {
    const transactions = await Transaction.find({ hotel: req.user.hotel })
      .populate('plan', 'name price billingCycle')
      .sort({ createdAt: -1 });

    res.json({ success: true, count: transactions.length, data: transactions });
  } catch (err) {
    console.error('getTransactionHistory error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch transactions.' });
  }
};

/* ═══════════════════════════════════════════
   SUPERADMIN — View any hotel's subscription
   ═══════════════════════════════════════════ */

/**
 * @desc    Get subscription details for a specific hotel
 * @route   GET /api/admin/subscriptions/:hotelId
 * @access  SUPER_ADMIN
 */
exports.getHotelSubscription = async (req, res) => {
  try {
    const { hotelId } = req.params;

    const subscription = await Subscription.findOne({
      hotel: hotelId,
      status: { $in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] },
    }).populate('plan');

    const upcomingSubscription = await Subscription.findOne({
      hotel: hotelId,
      status: 'UPCOMING',
    }).populate('plan');

    const history = await Subscription.find({ hotel: hotelId })
      .populate('plan', 'name price billingCycle')
      .sort({ createdAt: -1 });

    const transactions = await Transaction.find({ hotel: hotelId })
      .populate('plan', 'name')
      .sort({ createdAt: -1 })
      .limit(20);

    res.json({
      success: true,
      data: {
        currentSubscription: subscription || upcomingSubscription || null,
        upcomingSubscription,
        subscriptionHistory: history,
        recentTransactions: transactions,
      },
    });
  } catch (err) {
    console.error('getHotelSubscription error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch hotel subscription.' });
  }
};

/**
 * @desc    List all subscriptions (admin overview)
 * @route   GET /api/admin/subscriptions
 * @access  SUPER_ADMIN
 */
exports.getAllSubscriptions = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status) filter.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [subscriptions, total] = await Promise.all([
      Subscription.find(filter)
        .populate({
          path: 'hotel',
          select: 'name city admin',
          populate: {
            path: 'admin',
            select: 'profile.name',
          },
        })
        .populate('plan', 'name price billingCycle')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Subscription.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: subscriptions,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error('getAllSubscriptions error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch subscriptions.' });
  }
};
