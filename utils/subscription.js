// utils/subscription.js

/**
 * Calculate subscription end date based on billing cycle and trial days
 */
exports.calculateEndDate = (startDate, billingCycle, trialDays = 0) => {
  const end = new Date(startDate);
  if (billingCycle === 'NONE' && trialDays > 0) {
    end.setDate(end.getDate() + trialDays);
  } else if (billingCycle === 'YEARLY') {
    end.setFullYear(end.getFullYear() + 1);
  } else if (billingCycle === 'HALF_YEARLY') {
    end.setMonth(end.getMonth() + 6);
  } else if (billingCycle === 'QUARTERLY') {
    end.setMonth(end.getMonth() + 3);
  } else {
    // Default to monthly for 'MONTHLY' or any other paid plan
    end.setMonth(end.getMonth() + 1);
  }
  return end;
};

