// scripts/seed-plans.js
require('dotenv').config();
const mongoose = require('mongoose');
const Plan = require('../models/Plan');

const seedPlans = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    // Clear existing plans (optional, but requested for simplicity)
    await Plan.deleteMany({});

    const plans = [
      {
        name: 'Trial Plan',
        slug: 'trial-plan',
        planType: 'trial',
        description: '30 days free trial to explore all features.',
        price: 0,
        currency: 'INR',
        billingCycle: 'NONE',
        trialDays: 30,
        isActive: true,
      },
      {
        name: 'Whole Working Plan',
        slug: 'whole-working-plan',
        planType: 'main',
        description: 'Complete access to the entire system.',
        price: 999, // Example price
        currency: 'INR',
        billingCycle: 'MONTHLY',
        trialDays: 0,
        isActive: true,
      },
    ];

    await Plan.insertMany(plans);
    console.log('Successfully seeded 2 plans: Trial Plan and Whole Working Plan.');
    console.table(plans.map(p => ({ name: p.name, type: p.planType, price: p.price, cycle: p.billingCycle })));

  } catch (err) {
    console.error('Seeding plans failed:', err);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
};

seedPlans();
