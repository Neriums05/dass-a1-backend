// Authentication routes: register, login, get profile, update profile, change password

const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { auth } = require('../middleware/auth');

// Helper: creates a JWT token for a user
function createToken(user) {
  return jwt.sign(
    { id: user._id, role: user.role, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: '7d' } // token is valid for 7 days
  );
}

// -------------------------------------------------------
// POST /api/auth/register
// Creates a new participant account
// -------------------------------------------------------
router.post('/register', async (req, res) => {
  try {
    const { email, password, firstName, lastName, participantType, college, contactNumber } = req.body;

    // IIIT students must use their IIIT email
    if (participantType === 'iiit') {
      const isIIITEmail = email.endsWith('@iiit.ac.in') || email.endsWith('@students.iiit.ac.in');
      if (!isIIITEmail) {
        return res.status(400).json({ message: 'IIIT participants must register with an @iiit.ac.in email' });
      }
    }

    // Check if email is already taken
    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ message: 'An account with this email already exists' });
    }

    // Hash password (never store plain text)
    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      email, password: hashedPassword, role: 'participant',
      firstName, lastName, participantType, college, contactNumber
    });

    // Send back a token so the user is immediately logged in
    const token = createToken(user);
    res.json({
      token,
      user: { id: user._id, email, role: 'participant', name: firstName + ' ' + lastName }
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// -------------------------------------------------------
// POST /api/auth/login
// Works for all roles: participant, organizer, admin
// -------------------------------------------------------
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'Invalid email or password' });
    }

    // Compare entered password with stored hash
    const passwordMatches = await bcrypt.compare(password, user.password);
    if (!passwordMatches) {
      return res.status(400).json({ message: 'Invalid email or password' });
    }

    // Build a friendly display name depending on role
    let name = 'Admin';
    if (user.role === 'participant') name = user.firstName + ' ' + user.lastName;
    if (user.role === 'organizer')  name = user.organizerName;

    const token = createToken(user);
    res.json({
      token,
      user: { id: user._id, email: user.email, role: user.role, name }
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// -------------------------------------------------------
// GET /api/auth/me
// Returns the full profile of the logged-in user
// -------------------------------------------------------
router.get('/me', auth, async (req, res) => {
  // req.user.id is set by the auth middleware after verifying the token
  const user = await User.findById(req.user.id)
    .select('-password') // never send password back
    .populate('followedOrganizers', 'organizerName category'); // replace IDs with actual organizer data
  res.json(user);
});

// -------------------------------------------------------
// PUT /api/auth/profile
// Update participant profile fields
// -------------------------------------------------------
router.put('/profile', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (user.role === 'participant') {
      // Only allow updating participant fields
      const { firstName, lastName, contactNumber, college, interests, followedOrganizers } = req.body;
      if (firstName           !== undefined) user.firstName    = firstName;
      if (lastName            !== undefined) user.lastName     = lastName;
      if (contactNumber       !== undefined) user.contactNumber = contactNumber;
      if (college             !== undefined) user.college      = college;
      if (interests           !== undefined) user.interests    = interests;
      if (followedOrganizers  !== undefined) user.followedOrganizers = followedOrganizers;
    }
    // Organizers update their profile via PUT /organizers/profile instead

    await user.save();
    const updated = await User.findById(req.user.id).select('-password').populate('followedOrganizers', 'organizerName category');
    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// -------------------------------------------------------
// PUT /api/auth/change-password
// Allows a logged-in user to change their own password
// -------------------------------------------------------
router.put('/change-password', auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters' });
    }

    const user = await User.findById(req.user.id);

    // Verify they know their current password first
    const passwordMatches = await bcrypt.compare(currentPassword, user.password);
    if (!passwordMatches) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
