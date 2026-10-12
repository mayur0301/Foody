// scripts/test-cron.js
require('dotenv').config();
const mongoose = require('mongoose');
const { checkSubscriptions } = require('./subscriptionCron');

/**
 * Manual Test Script: Triggers the subscription check logic immediately.
 */
async function runTest() {
  try {
    console.log('--- MANUAL CRON TEST START ---');
    
    // 1. Connect to DB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB.');

    // 2. Trigger Logic
    await checkSubscriptions();

    console.log('--- MANUAL CRON TEST COMPLETED ---');
  } catch (err) {
    console.error('Test failed:', err);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

runTest();
