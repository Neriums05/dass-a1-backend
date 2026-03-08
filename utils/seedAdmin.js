const bcrypt = require('bcryptjs');
const User = require('../models/User');

async function seedAdmin() {
  try {
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;

    if (!email || !password) {
      console.warn('ADMIN_EMAIL or ADMIN_PASSWORD not set. Skipping admin seed.');
      return;
    }

    const adminExists = await User.findOne({ role: 'admin' });

    if (adminExists) {
      console.log('Admin already exists, skipping seed');
      return;
    }

    console.log('Creating admin account...');
    const hashedPassword = await bcrypt.hash(password, 10);

    await User.create({
      email,
      password: hashedPassword,
      role: 'admin'
    });

    console.log('Admin account created:', email);
  } catch (err) {
    console.error('Error during admin seeding:', err.message);
  }
}

module.exports = seedAdmin;
