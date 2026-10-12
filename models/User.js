const { default: mongoose } = require("mongoose");
const { ROLES } = require("../utils/constants");

// src/models/User.js
const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  phone: {
    type: String,
    // required: true,
    // unique: true,
    // trim: true
  },
  password: {
    type: String,
    // required: true 
  },
  profile: {
    name: String,
    email: String,
    // you can keep phone here too or remove it (optional)
  },
  role: {
    type: String,
    enum: Object.values(ROLES), // 👈 roles from constants
    required: true,
    default: ROLES.STAFF    // 👈 optional but recommended
  },
  hotel: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Hotel'
  },
  status: {
    type: String,
    enum: ['active', 'blocked'],
    default: 'active'
  },
  creator: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);