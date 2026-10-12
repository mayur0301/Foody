// utils/constants.js
exports.ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  HOTEL_ADMIN: 'HOTEL_ADMIN',
  STAFF:      'STAFF',       // receptionist, cleaner, etc.
  CUSTOMER:   'CUSTOMER'
};

// ── Subscription Feature Flags ──
// Use these as keys in Plan.features array
exports.FEATURES = {
  POS_SYSTEM:        'POS_SYSTEM',
  SALES_ANALYTICS:   'SALES_ANALYTICS',
  BULK_MENU_UPLOAD:  'BULK_MENU_UPLOAD',
  STAFF_MANAGEMENT:  'STAFF_MANAGEMENT',
  ORDER_MANAGEMENT:  'ORDER_MANAGEMENT',
  ADVANCED_REPORTS:  'ADVANCED_REPORTS',
};

// ── Subscription Statuses ──
exports.SUBSCRIPTION_STATUS = {
  TRIALING:  'TRIALING',
  UPCOMING:  'UPCOMING',
  ACTIVE:    'ACTIVE',
  PAST_DUE:  'PAST_DUE',
  CANCELED:  'CANCELED',
  EXPIRED:   'EXPIRED',
};