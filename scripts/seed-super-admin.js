// scripts/seed-super-admin.js
require('dotenv').config();
const mongoose = require('mongoose');
// const bcrypt = require('bcryptjs');
const bcrypt = require('bcrypt');
const User = require('../models/User');           // adjust path
const { ROLES } = require('../utils/constants');

const seedSuperAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    // const existing = await User.findOne({ phone: '+10000000000' });
    // if (existing) {
    //   console.log('Super admin already exists → skipping');
    //   process.exit(0);
    // }

    const hashed = await bcrypt.hash('123456', 10);

    const superAdmin = new User({
      phone: '1234567890',
      username: 'superadmin',
      email: 'superadmin@yourcompany.com',
      password: hashed,
      role: ROLES.SUPER_ADMIN,
      profile: { name: 'Mayur DB Super Admin' },
      active: true
    });

    await superAdmin.save();
    console.log('Super admin created successfully!');
    console.table({
      phone: superAdmin.phone,
      role: superAdmin.role,
      id: superAdmin._id.toString()
    });

  } catch (err) {
    console.error('Seeding failed:', err);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
};

seedSuperAdmin();