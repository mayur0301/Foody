// scripts/subscriptionCron.js
const cron = require('node-cron');
const Subscription = require('../models/Subscription');
const Usage = require('../models/Usage');
const Hotel = require('../models/Hotel');
const Notification = require('../models/Notification');
const { sendExpiryWarningEmail, sendExpiredNotificationEmail } = require('../utils/emailService');

/**
 * Subscription Expiry & Renewal Cron Job
 *
 * Runs every day at midnight (00:00).
 */
/**
 * The core logic for checking expiries and sending notifications.
 * Extracted so it can be called manually for testing.
 */
async function checkSubscriptions() {
    console.log('[CRON] Running subscription check...');
    const now = new Date();

    try {
      // 1. ⚠️ NOTIFY: Subscriptions expiring in EXACTLY 3 days
      const threeDaysFromNow = new Date(now.getTime() + 3 * 86400000);
      const fourDaysFromNow = new Date(now.getTime() + 4 * 86400000);

      const expiringSoon = await Subscription.find({
        status: { $in: ['ACTIVE', 'TRIALING'] },
        endDate: { $gte: threeDaysFromNow, $lt: fourDaysFromNow }
      }).populate('hotel');

      for (const sub of expiringSoon) {
        if (sub.hotel && sub.hotel.email) {
          await sendExpiryWarningEmail(sub.hotel.email, sub.hotel.name, sub.endDate);
        }

        // Create in-app notification
        await Notification.create({
          title: 'Subscription Expiring Soon',
          message: `Your subscription for ${sub.hotel?.name || 'your hotel'} will expire in 3 days. Please renew soon.`,
          type: 'WARNING',
          target: 'SPECIFIC_HOTEL',
          targetHotel: sub.hotel?._id,
          createdBy: sub.hotel?.admin || sub.creator
        }).catch(err => console.error('[CRON] Failed to create warning notification:', err));
      }

      // 2. ❌ EXPIRE: Active → Canceled (cancelAtPeriodEnd)
      const expiredActive = await Subscription.updateMany(
        {
          status: 'ACTIVE',
          endDate: { $lte: now },
          cancelAtPeriodEnd: true,
        },
        {
          $set: { status: 'CANCELED', cancelledAt: now },
        }
      );
      if (expiredActive.modifiedCount > 0) {
        console.log(`[CRON] Canceled ${expiredActive.modifiedCount} subscription(s) at period end.`);
      }

      // 3. ⚠️ EXPIRE: Active → PAST_DUE (no auto-cancel)
      const activeToExpire = await Subscription.find({
        status: 'ACTIVE',
        endDate: { $lte: now },
        cancelAtPeriodEnd: false,
      }).populate('hotel');

      if (activeToExpire.length > 0) {
        for (const sub of activeToExpire) {
          sub.status = 'PAST_DUE';
          await sub.save();
          
          if (sub.hotel && sub.hotel.email) {
            await sendExpiredNotificationEmail(sub.hotel.email, sub.hotel.name);
          }

          // Create in-app notification
          await Notification.create({
            title: 'Subscription Expired',
            message: `Your subscription for ${sub.hotel?.name || 'your hotel'} has expired. Access is limited until renewal.`,
            type: 'ALERT',
            target: 'SPECIFIC_HOTEL',
            targetHotel: sub.hotel?._id,
            createdBy: sub.hotel?.admin || sub.creator
          }).catch(err => console.error('[CRON] Failed to create expiry notification:', err));
        }
        console.log(`[CRON] Moved ${activeToExpire.length} subscription(s) to PAST_DUE and notified admins.`);
      }

      // 4. Transition: TRIALING → ACTIVE
      const trialEnded = await Subscription.updateMany(
        {
          status: 'TRIALING',
          trialEndDate: { $lte: now },
          endDate: { $gt: now },
        },
        {
          $set: { status: 'ACTIVE' },
        }
      );
      if (trialEnded.modifiedCount > 0) {
        console.log(`[CRON] Activated ${trialEnded.modifiedCount} trial subscription(s).`);
      }

      // 5. Activate UPCOMING subscriptions
      const activatedUpcoming = await Subscription.updateMany(
        {
          status: 'UPCOMING',
          startDate: { $lte: now },
        },
        {
          $set: { status: 'ACTIVE' },
        }
      );
      if (activatedUpcoming.modifiedCount > 0) {
        console.log(`[CRON] Activated ${activatedUpcoming.modifiedCount} upcoming subscription(s).`);
      }

      // 6. Expire PAST_DUE after 7 days grace
      const gracePeriodEnd = new Date(now.getTime() - 7 * 86400000);
      await Subscription.updateMany(
        {
          status: 'PAST_DUE',
          endDate: { $lte: gracePeriodEnd },
        },
        {
          $set: { status: 'EXPIRED' },
        }
      );

      // 6. Usage Reset Logic
      const usagesToReset = await Usage.find({ resetDate: { $lte: now } });
      for (const usage of usagesToReset) {
        usage.count = 0;
        usage.resetDate = new Date(usage.resetDate.getTime() + 30 * 86400000);
        await usage.save();
      }

      console.log('[CRON] Subscription check completed.');
    } catch (err) {
      console.error('[CRON] Subscription cron error:', err);
    }
}

function startSubscriptionCron() {
  cron.schedule('0 0 * * *', checkSubscriptions);
  console.log('[CRON] Subscription expiry cron job scheduled (daily at midnight).');
}

module.exports = { startSubscriptionCron, checkSubscriptions };


