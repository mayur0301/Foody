const jwt = require('jsonwebtoken');
const Hotel = require('../models/Hotel');
const TokenBlacklist = require('../models/TokenBlacklist');
const { ROLES } = require('../utils/constants');

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key';

const authenticate = async (req, res, next) => {
  const authHeader = req.header('Authorization');
  const token = authHeader?.replace('Bearer ', '');
  const isLogoutRoute = req.path.includes('/logout');

  // ── Step 1: Token presence check ──
  if (!token) {
    // For logout, even without a token the frontend should be allowed to clear state
    if (isLogoutRoute) {
      req.token = null;
      req.user = null;
      return next();
    }
    return res.status(401).json({ success: false, message: 'No token provided' });
  }

  // ── Step 2: Blacklist check ──
  try {
    const isBlacklisted = await TokenBlacklist.findOne({ token });
    if (isBlacklisted && !isLogoutRoute) {
      return res.status(401).json({
        success: false,
        message: 'Token has been invalidated. Please log in again.',
        code: 'TOKEN_BLACKLISTED'
      });
    }
  } catch (dbErr) {
    // If DB check fails, don't block logout — let it through
    if (!isLogoutRoute) {
      console.error('Blacklist check failed:', dbErr.message);
      return res.status(500).json({ success: false, message: 'Authentication service error' });
    }
  }

  // ── Step 3: JWT verification ──
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = {
      id: decoded.id,
      role: decoded.role,
      phone: decoded.phone,
      hotel: decoded.hotel
    };
    req.token = token;
  } catch (err) {
    // For logout: allow expired/invalid tokens through so the controller can blacklist & clear
    if (isLogoutRoute) {
      req.token = token;
      req.user = null;
      return next();
    }
    console.error('JWT verify error:', err.name, err.message);
    return res.status(401).json({
      success: false,
      message: err.name === 'TokenExpiredError'
        ? 'Token has expired. Please log in again.'
        : 'Invalid token',
      code: err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID'
    });
  }

  // ── Step 4: Real-time Hotel Status Check (skip for logout) ──
  if (!isLogoutRoute && (req.user.role === ROLES.HOTEL_ADMIN || req.user.role === ROLES.STAFF)) {
    if (!req.user.hotel) {
      return res.status(403).json({ success: false, message: 'Access denied: No hotel associated' });
    }

    try {
      const hotel = await Hotel.findById(req.user.hotel).select('status');
      if (!hotel || hotel.status !== 'active') {
        return res.status(403).json({
          success: false,
          message: hotel?.status === 'pending'
            ? 'Your hotel is pending approval'
            : 'Your hotel account is suspended'
        });
      }
    } catch (hotelErr) {
      console.error('Hotel status check failed:', hotelErr.message);
      return res.status(500).json({ success: false, message: 'Unable to verify hotel status' });
    }
  }

  next();
};

module.exports = authenticate;