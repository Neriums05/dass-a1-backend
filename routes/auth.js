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

function isIIITEmail(email) {
  return email.endsWith('@iiit.ac.in') ||
    email.endsWith('@students.iiit.ac.in') ||
    email.endsWith('@research.iiit.ac.in');
}

function getDisplayName(user) {
  if (user.role === 'participant') return user.firstName + ' ' + user.lastName;
  if (user.role === 'organizer') return user.organizerName;
  return 'Admin';
}

function assignIfDefined(target, source, fields) {
  for (const field of fields) {
    if (source[field] !== undefined) target[field] = source[field];
  }
}

// -------------------------------------------------------
// POST /api/auth/register
// Creates a new participant account
// -------------------------------------------------------
router.post('/register', async (req, res) => {
  try {
    let { email, password, firstName, lastName, participantType, college, contactNumber, securityQuestion, securityAnswer } = req.body;

    if (!email || !password || !firstName || !lastName || !participantType || !contactNumber || !securityQuestion || !securityAnswer) {
      return res.status(400).json({ message: 'All required fields must be provided' });
    }

    if (contactNumber.length !== 10) {
      return res.status(400).json({ message: 'Contact Number must be exactly 10 digits' });
    }

    // IIIT students must use their IIIT email and have college set to IIIT
    if (participantType === 'iiit') {
      if (!isIIITEmail(email)) {
        return res.status(400).json({ message: 'IIIT students must use their institutional email' });
      }
      college = 'IIIT'; // Set college to 'IIIT' if participantType is 'iiit'
    }

    // Check if email is already taken
    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ message: 'An account with this email already exists' });
    }

    // Hash password (never store plain text)
    const hashedPassword = await bcrypt.hash(password, 10);
    const hashedAnswer = await bcrypt.hash(securityAnswer.toLowerCase().trim(), 10);

    const user = await User.create({
      email, password: hashedPassword, role: 'participant',
      firstName, lastName, participantType, college, contactNumber,
      securityQuestion, securityAnswer: hashedAnswer
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
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'Invalid email or password' });
    }

    // Compare entered password with stored hash
    const passwordMatches = await bcrypt.compare(password, user.password);
    if (!passwordMatches) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Build a friendly display name depending on role
    const name = getDisplayName(user);

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
      // Ensure contactNumber is provided
      if (req.body.contactNumber !== undefined && (!req.body.contactNumber || !req.body.contactNumber.trim())) {
        return res.status(400).json({ message: 'Contact Number is required' });
      }

      if (req.body.contactNumber !== undefined && req.body.contactNumber.length !== 10) {
        return res.status(400).json({ message: 'Contact Number must be exactly 10 digits' });
      }

      // Only allow updating participant fields
      assignIfDefined(user, req.body, [
        'firstName',
        'lastName',
        'college',
        'interests',
        'contactNumber',
        'followedOrganizers',
        'hasCompletedOnboarding'
      ]);

      // If they switched to IIIT type or are IIIT, ensure college is IIIT
      if (user.participantType === 'iiit') {
        user.college = 'IIIT';
      }
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

// -------------------------------------------------------
// POST /api/auth/forgot-password - Step 1: Get Question
// -------------------------------------------------------
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email is required' });

    const user = await User.findOne({ email: email.toLowerCase() }).select('securityQuestion').lean();
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (!user.securityQuestion) return res.status(400).json({ message: 'No security question set for this account' });

    res.json({ question: user.securityQuestion });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// -------------------------------------------------------
// POST /api/auth/reset-password - Step 2: Verify & Reset
// -------------------------------------------------------
router.post('/reset-password', async (req, res) => {
  try {
    const { email, securityAnswer, newPassword } = req.body;
    if (!email || !securityAnswer || !newPassword) {
      return res.status(400).json({ message: 'Email, answer and new password are required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (!user.securityAnswer) return res.status(400).json({ message: 'Account recovery not possible via this method' });

    const isMatch = await bcrypt.compare(securityAnswer.toLowerCase().trim(), user.securityAnswer);
    if (!isMatch) return res.status(400).json({ message: 'Incorrect security answer' });

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    res.json({ message: 'Password reset successful. You can now login.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
