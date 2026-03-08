const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { auth } = require('../middleware/auth');

function createToken(user) {
  return jwt.sign(
    { id: user._id, role: user.role, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
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

router.post('/register', async (req, res) => {
  try {
    let { email, password, firstName, lastName, participantType, college, contactNumber, securityQuestion, securityAnswer } = req.body;

    if (!email || !password || !firstName || !lastName || !participantType || !contactNumber || !securityQuestion || !securityAnswer) {
      return res.status(400).json({ message: 'All required fields must be provided' });
    }

    if (contactNumber.length !== 10) {
      return res.status(400).json({ message: 'Contact Number must be exactly 10 digits' });
    }

    if (participantType === 'iiit') {
      if (!isIIITEmail(email)) {
        return res.status(400).json({ message: 'IIIT students must use their institutional email' });
      }
      college = 'IIIT';
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ message: 'An account with this email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const hashedAnswer = await bcrypt.hash(securityAnswer.toLowerCase().trim(), 10);

    const user = await User.create({
      email, password: hashedPassword, role: 'participant',
      firstName, lastName, participantType, college, contactNumber,
      securityQuestion, securityAnswer: hashedAnswer
    });

    const token = createToken(user);
    res.json({
      token,
      user: { id: user._id, email, role: 'participant', name: firstName + ' ' + lastName }
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'Invalid email or password' });
    }

    const passwordMatches = await bcrypt.compare(password, user.password);
    if (!passwordMatches) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

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

router.get('/me', auth, async (req, res) => {
  const user = await User.findById(req.user.id)
    .select('-password')
    .populate('followedOrganizers', 'organizerName category');
  res.json(user);
});

router.put('/profile', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (user.role === 'participant') {
      if (req.body.contactNumber !== undefined && (!req.body.contactNumber || !req.body.contactNumber.trim())) {
        return res.status(400).json({ message: 'Contact Number is required' });
      }

      if (req.body.contactNumber !== undefined && req.body.contactNumber.length !== 10) {
        return res.status(400).json({ message: 'Contact Number must be exactly 10 digits' });
      }

      assignIfDefined(user, req.body, [
        'firstName',
        'lastName',
        'college',
        'interests',
        'contactNumber',
        'followedOrganizers',
        'hasCompletedOnboarding'
      ]);

      if (user.participantType === 'iiit') {
        user.college = 'IIIT';
      }
    }

    await user.save();
    const updated = await User.findById(req.user.id).select('-password').populate('followedOrganizers', 'organizerName category');
    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put('/change-password', auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters' });
    }

    const user = await User.findById(req.user.id);

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
