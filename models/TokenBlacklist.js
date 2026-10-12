const mongoose = require('mongoose');

const tokenBlacklistSchema = new mongoose.Schema({
  token: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expires: 0 } // TTL Index: automatically delete document at this date
  }
}, { timestamps: true });

module.exports = mongoose.model('TokenBlacklist', tokenBlacklistSchema);
