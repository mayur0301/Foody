// scripts/seed-test-notifications.js
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Hotel = require('../models/Hotel');
const Plan = require('../models/Plan');
const Subscription = require('../models/Subscription');

/**
 * Seed data for manual email/notification testing.
 */
async function seedTestData() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB.');

    // 1. Get or Create a Plan
    let plan = await Plan.findOne({ planType: 'trial' });
    if (!plan) {
      plan = await Plan.create({
        name: 'Test Trial',
        slug: 'test-trial',
        planType: 'trial',
        price: 0,
        billingCycle: 'NONE',
        trialDays: 30
      });
    }

    // 2. Create Test Admin
    const user = await User.findOneAndUpdate(
      { phone: '7979797979' },
      {
        username: 'testadmin',
        phone: '7979797979',
        role: 'HOTEL_ADMIN',
        profile: { name: 'Onkar D' }
      },
      { upsert: true, new: true }
    );

    // 3. Cleanup existing test data
    await Hotel.deleteMany({ email: 'onkarmadane79@gmail.com' });
    await Subscription.deleteMany({ hotel: { $in: await Hotel.find({ email: 'onkarmadane79@gmail.com' }).distinct('_id') } });

    const now = new Date();

    // ─── TEST CASE 1: Expiring in 3 Days ───
    const hotel1 = await Hotel.create({
      name: 'Expiring Hotel Test',
      email: 'onkarmadane79@gmail.com',
      admin: user._id,
      status: 'active'
    });

    await Subscription.create({
      hotel: hotel1._id,
      plan: plan._id,
      status: 'TRIALING',
      startDate: now,
      endDate: new Date(now.getTime() + 3 * 86400000 + 10000), // ~3 days, slightly more to be in range
      trialEndDate: new Date(now.getTime() + 3 * 86400000 + 10000)
    });

    // ─── TEST CASE 2: Already Expired ───
    const hotel2 = await Hotel.create({
      name: 'Expired Hotel Test',
      email: 'onkarmadane79@gmail.com',
      admin: user._id,
      status: 'active'
    });

    await Subscription.create({
      hotel: hotel2._id,
      plan: plan._id,
      status: 'ACTIVE',
      startDate: new Date(now.getTime() - 30 * 86400000),
      endDate: new Date(now.getTime() - 1 * 86400000), // Expired 1 day ago
      cancelAtPeriodEnd: false
    });

    console.log('SUCCESS: Seeded 2 Test Hotels using email: onkarmadane79@gmail.com');
    console.log('1. "Expiring Hotel Test" (Should trigger 3-day warning)');
    console.log('2. "Expired Hotel Test" (Should trigger immediate expiry notice)');

    console.log('\nNow run: node scripts/test-cron.js');

  } catch (err) {
    console.error('Seeding failed:', err);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

seedTestData();
