const router = require('express').Router();
const User = require('../models/User');
const Event = require('../models/Event');
const Registration = require('../models/Registration');
const { sendEmail } = require('../utils/email');
const bcrypt = require('bcryptjs');
const { requireRole } = require('../middleware/auth');

function buildOrganizerLoginEmail(organizerName) {
  return organizerName
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9]/g, '') + '@felicity.org';
}

function generatePassword(prefix) {
  return prefix + Math.random().toString(36).slice(2, 8);
}

function buildResetHistoryEntry(user, status, adminComment) {
  return {
    status,
    reason: user.passwordResetRequest.reason,
    requestedAt: user.passwordResetRequest.requestedAt,
    resolvedAt: new Date(),
    adminComment
  };
}

router.post('/organizer', ...requireRole('admin'), async (req, res) => {
  try {
    const { organizerName, category, description, contactEmail } = req.body;

    if (!organizerName || !organizerName.trim()) {
      return res.status(400).json({ message: 'Organizer name is required' });
    }
    if (!category || !category.trim()) return res.status(400).json({ message: 'Category is required' });
    if (!contactEmail || !contactEmail.trim()) return res.status(400).json({ message: 'Contact email is required' });

    const loginEmail = buildOrganizerLoginEmail(organizerName);

    const existing = await User.findOne({ email: loginEmail });
    if (existing) {
      return res.status(400).json({ message: 'An organizer with this name already exists (email conflict: ' + loginEmail + ')' });
    }

    const rawPassword = generatePassword('Pass@');
    const hashedPassword = await bcrypt.hash(rawPassword, 10);

    const user = await User.create({
      email: loginEmail, password: hashedPassword, role: 'organizer',
      organizerName, category, description, contactEmail
    });

    res.status(201).json({ message: 'Organizer created', loginEmail, password: rawPassword, id: user._id });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ message: 'An organizer with that login email already exists' });
    }
    res.status(500).json({ message: err.message });
  }
});

router.get('/organizers', ...requireRole('admin'), async (req, res) => {
  try {
    const organizers = await User.find({ role: 'organizer' }).select('-password').lean();
    res.json(organizers);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete('/organizer/:id', ...requireRole('admin'), async (req, res) => {
  try {
    const organizer = await User.findById(req.params.id);
    if (!organizer || organizer.role !== 'organizer') {
      return res.status(404).json({ message: 'Organizer not found' });
    }

    const events = await Event.find({ organizer: req.params.id }).lean();
    const eventIds = events.map(e => e._id);

    if (eventIds.length > 0) {
      await Registration.deleteMany({ event: { $in: eventIds } });
      await Event.deleteMany({ organizer: req.params.id });
    }

    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'Organizer and all their events removed' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/reset-requests', ...requireRole('admin'), async (req, res) => {
  try {
    const requests = await User.find({
      role: 'organizer',
      'passwordResetRequest.status': 'pending'
    }).select('organizerName email passwordResetRequest').lean();
    res.json(requests);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put('/reset-requests/:id', ...requireRole('admin'), async (req, res) => {
  try {
    const { action, adminComment } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (action === 'approve') {
      const newPassword = generatePassword('New@');
      user.password = await bcrypt.hash(newPassword, 10);

      user.passwordResetHistory.push(buildResetHistoryEntry(user, 'approved', adminComment));
      user.passwordResetRequest.status = 'approved';
      user.passwordResetRequest.tempPasswordExpiresAt = undefined;
      user.passwordResetRequest.adminComment = adminComment;
      await user.save();

      const emailHtml = `
        <h2>Password Reset Approved</h2>
        <p>Your password has been reset by the admin.</p>
        <p>Your new temporary password is: <strong>${newPassword}</strong></p>
        <p>Please log in and change your password immediately.</p>
        ${adminComment ? `<p>Admin Note: ${adminComment}</p>` : ''}
      `;
      await sendEmail(user.email, 'Felicity - Password Reset Approved', emailHtml);

      return res.json({ message: 'Approved', newPassword });

    } else {
      user.passwordResetHistory.push(buildResetHistoryEntry(user, 'rejected', adminComment));
      user.passwordResetRequest.status = 'rejected';
      user.passwordResetRequest.adminComment = adminComment;
      await user.save();
      const emailHtml = `
        <h2>Password Reset Rejected</h2>
        <p>Your password reset request has been rejected by the admin.</p>
        ${adminComment ? `<p>Reason/Note: ${adminComment}</p>` : ''}
        <p>If you believe this is an error, please contact the admin directly.</p>
      `;
      await sendEmail(user.email, 'Felicity - Password Reset Rejected', emailHtml);

      return res.json({ message: 'Rejected' });
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
