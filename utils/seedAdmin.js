// This runs once when the server starts.
// It checks if an admin account exists, and creates one if not.
// Admin credentials come from the .env file.

const bcrypt = require('bcryptjs');
const User = require('../models/User');

async function seedAdmin() {
  try {
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;

    if (!email || !password) {
      console.warn('⚠️ ADMIN_EMAIL or ADMIN_PASSWORD not set in environment. Skipping auto-creation.');
      return;
    }

    // Check if any admin already exists
    const adminExists = await User.findOne({ role: 'admin' });

    if (adminExists) {
      console.log('✅ Admin already exists, skipping seed');
      return;
    }

    console.log('🚀 Attempting to create admin account...');

    // Hash the password before storing
    const hashedPassword = await bcrypt.hash(password, 10);

    await User.create({
      email: email,
      password: hashedPassword,
      role: 'admin'
    });

    console.log('✨ Admin account created successfully:', email);
  } catch (err) {
    console.error('❌ Error during admin seeding:', err.message);
  }
}

module.exports = seedAdmin;
