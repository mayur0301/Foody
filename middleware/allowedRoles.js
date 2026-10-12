const { ROLES } = require("../utils/constants");

const allowRoles = (...roles) => {
  return (req, res, next) => {
    if (req.user.role === ROLES.SUPER_ADMIN) {
      return next(); // 👑 bypass
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    next();
  };
};

module.exports = allowRoles;
