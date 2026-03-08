// This runs once when the server starts.
// It checks if an admin account exists, and creates one if not.
// Admin credentials come from the .env file.

const bcrypt = require('bcryptjs');
const User = require('../models/User');

async function seedAdmin() {
  // Check if any admin already exists
  const adminExists = await User.findOne({ role: 'admin' });

  if (adminExists) {
    console.log('Admin already exists, skipping seed');
    return;
  }

  // Hash the password before storing
  const hashedPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);

  await User.create({
    email: process.env.ADMIN_EMAIL,
    password: hashedPassword,
    role: 'admin'
  });

  console.log('Admin account created:', process.env.ADMIN_EMAIL);
}

module.exports = seedAdmin;
