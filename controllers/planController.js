const Plan = require('../models/Plan');
const Subscription = require('../models/Subscription');
const { logAction } = require('../utils/logger');

/* ═══════════════════════════════════════════
   SUPERADMIN — Plan CRUD
   ═══════════════════════════════════════════ */

/**
 * @desc    Create a new subscription plan (Simplified for Trial/Main only)
 * @route   POST /api/admin/plans
 * @access  SUPER_ADMIN
 */
exports.createPlan = async (req, res) => {
  try {
    const {
      name, slug, description, price, currency,
      billingCycle, planType, trialDays,
    } = req.body;

    // Validate planType
    if (!['trial', 'main'].includes(planType)) {
      return res.status(400).json({ success: false, message: 'Invalid plan type. Must be "trial" or "main".' });
    }

    // Auto-generate slug from name if not provided
    let finalSlug = slug;
    if (!finalSlug && name) {
      finalSlug = name.toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '')
        .replace(/[\s_-]+/g, '-')
        .replace(/^-+|-+$/g, '');
    }

    if (!finalSlug) {
      return res.status(400).json({ success: false, message: 'Slug is required or name must be provided to generate one.' });
    }

    // Validate slug uniqueness
    const existing = await Plan.findOne({ slug: finalSlug });
    if (existing) {
      return res.status(409).json({ success: false, message: `Plan with slug "${finalSlug}" already exists.` });
    }

    const plan = await Plan.create({
      name, 
      slug: finalSlug, 
      description, 
      price, 
      currency: currency || 'INR',
      billingCycle: planType === 'trial' ? 'NONE' : billingCycle,
      planType, 
      trialDays,
    });

    res.status(201).json({ success: true, message: 'Plan created successfully.', data: plan });
  } catch (err) {
    console.error('createPlan error:', err);
    res.status(500).json({ success: false, message: 'Failed to create plan.', error: err.message });
  }
};

/**
 * @desc    Get all plans
 * @route   GET /api/admin/plans
 * @access  SUPER_ADMIN
 */
exports.getAllPlans = async (req, res) => {
  try {
    const { active } = req.query;
    const filter = {};
    if (active !== undefined) filter.isActive = active === 'true';

    const plans = await Plan.find(filter).sort({ createdAt: -1 });

    res.json({ success: true, count: plans.length, data: plans });
  } catch (err) {
    console.error('getAllPlans error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch plans.' });
  }
};

/**
 * @desc    Get single plan by ID
 * @route   GET /api/admin/plans/:id
 * @access  SUPER_ADMIN
 */
exports.getPlanById = async (req, res) => {
  try {
    const plan = await Plan.findById(req.params.id);
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found.' });

    // Also count subscribers
    const activeSubscribers = await Subscription.countDocuments({ plan: plan._id, status: { $in: ['ACTIVE', 'TRIALING'] } });

    res.json({ success: true, data: { ...plan.toObject(), activeSubscribers } });
  } catch (err) {
    console.error('getPlanById error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch plan.' });
  }
};

/**
 * @desc    Update a simplified plan
 * @route   PUT /api/admin/plans/:id
 * @access  SUPER_ADMIN
 */
exports.updatePlan = async (req, res) => {
  try {
    const plan = await Plan.findById(req.params.id);
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found.' });

    const updates = req.body;

    // Safety: warn if active subscribers exist and price is changing
    if (updates.price !== undefined && updates.price !== plan.price) {
      const activeSubs = await Subscription.countDocuments({ plan: plan._id, status: { $in: ['ACTIVE', 'TRIALING'] } });
      if (activeSubs > 0) {
        updates._priceChangeWarning = `${activeSubs} active subscriber(s) will NOT be affected until renewal.`;
      }
    }

    const warning = updates._priceChangeWarning;
    delete updates._priceChangeWarning;

    const oldState = plan.toObject();
    const updated = await Plan.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });

    await logAction({
        action: 'PLAN_UPDATE',
        performedBy: req.user.id,
        entityType: 'PLAN',
        entityId: updated._id,
        changes: { before: oldState, after: updated.toObject() }
    }, req);

    res.json({
      success: true,
      message: 'Plan updated successfully.',
      ...(warning && { warning }),
      data: updated,
    });
  } catch (err) {
    console.error('updatePlan error:', err);
    res.status(500).json({ success: false, message: 'Failed to update plan.', error: err.message });
  }
};

/**
 * @desc    Archive a plan
 * @route   DELETE /api/admin/plans/:id
 * @access  SUPER_ADMIN
 */
exports.archivePlan = async (req, res) => {
  try {
    const plan = await Plan.findById(req.params.id);
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found.' });

    plan.isActive = false;
    await plan.save();

    await logAction({
        action: 'PLAN_ARCHIVE',
        performedBy: req.user.id,
        entityType: 'PLAN',
        entityId: plan._id,
        changes: { before: { isActive: true }, after: { isActive: false } }
    }, req);

    res.json({ success: true, message: 'Plan archived successfully.', data: plan });
  } catch (err) {
    console.error('archivePlan error:', err);
    res.status(500).json({ success: false, message: 'Failed to archive plan.' });
  }
};

/* ═══════════════════════════════════════════
   PUBLIC — Plans listing
   ═══════════════════════════════════════════ */

/**
 * @desc    Get all active plans (Simplified)
 * @route   GET /api/plans
 * @access  Public
 */
exports.getActivePlans = async (req, res) => {
  try {
    const plans = await Plan.find({ isActive: true })
      .select('-razorpayPlanId -__v');

    res.json({ success: true, count: plans.length, data: plans });
  } catch (err) {
    console.error('getActivePlans error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch plans.' });
  }
};

/**
 * @desc    Get subscription stats
 * @route   GET /api/admin/plans/stats
 * @access  SUPER_ADMIN
 */
exports.getPlanStats = async (req, res) => {
  try {
    const totalPlans = await Plan.countDocuments();
    const activePlans = await Plan.countDocuments({ isActive: true });
    const totalActiveSubscriptions = await Subscription.countDocuments({ status: { $in: ['ACTIVE', 'TRIALING'] } });
    const totalCanceled = await Subscription.countDocuments({ status: 'CANCELED' });
    const totalExpired = await Subscription.countDocuments({ status: 'EXPIRED' });

    // Revenue by plan
    const revenueByPlan = await Subscription.aggregate([
      { $match: { status: { $in: ['ACTIVE', 'TRIALING'] } } },
      { $lookup: { from: 'plans', localField: 'plan', foreignField: '_id', as: 'planData' } },
      { $unwind: '$planData' },
      {
        $group: {
          _id: '$planData.name',
          planType: { $first: '$planData.planType' },
          subscribers: { $sum: 1 },
          monthlyRevenue: { $sum: '$planData.price' },
        },
      },
      { $sort: { subscribers: -1 } },
    ]);

    res.json({
      success: true,
      data: {
        totalPlans,
        activePlans,
        totalActiveSubscriptions,
        totalCanceled,
        totalExpired,
        revenueByPlan,
      },
    });
  } catch (err) {
    console.error('getPlanStats error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch plan stats.' });
  }
};

