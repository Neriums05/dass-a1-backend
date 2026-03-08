// Admin routes: manage organizers, handle password reset requests

const router = require('express').Router();
const User = require('../models/User');
const Event = require('../models/Event');
const Registration = require('../models/Registration');
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

// -------------------------------------------------------
// POST /api/admin/organizer
// Admin: create a new organizer account
// Auto-generates login email and a random password
// -------------------------------------------------------
router.post('/organizer', ...requireRole('admin'), async (req, res) => {
  try {
    const { organizerName, category, description, contactEmail } = req.body;

    if (!organizerName || !organizerName.trim()) {
      return res.status(400).json({ message: 'Organizer name is required' });
    }
    if (!category || !category.trim()) return res.status(400).json({ message: 'Category is required' });
    if (!contactEmail || !contactEmail.trim()) return res.status(400).json({ message: 'Contact email is required' });

    // Generate a login email based on the organizer name
    const loginEmail = buildOrganizerLoginEmail(organizerName);

    // Check for duplicate email
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

// -------------------------------------------------------
// GET /api/admin/organizers
// Admin: list all organizer accounts
// -------------------------------------------------------
router.get('/organizers', ...requireRole('admin'), async (req, res) => {
  try {
    const organizers = await User.find({ role: 'organizer' }).select('-password');
    res.json(organizers);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// -------------------------------------------------------
// DELETE /api/admin/organizer/:id
// Admin: remove an organizer account
// -------------------------------------------------------
router.delete('/organizer/:id', ...requireRole('admin'), async (req, res) => {
  try {
    const organizer = await User.findById(req.params.id);
    if (!organizer || organizer.role !== 'organizer') {
      return res.status(404).json({ message: 'Organizer not found' });
    }

    // Clean up all events and their registrations before deleting the organizer
    const events = await Event.find({ organizer: req.params.id });
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

// -------------------------------------------------------
// GET /api/admin/reset-requests
// Admin: get all pending password reset requests from organizers
// -------------------------------------------------------
router.get('/reset-requests', ...requireRole('admin'), async (req, res) => {
  try {
    const requests = await User.find({
      role: 'organizer',
      'passwordResetRequest.status': 'pending'
    }).select('organizerName email passwordResetRequest');
    res.json(requests);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// -------------------------------------------------------
// PUT /api/admin/reset-requests/:id
// Admin: approve or reject a password reset request
// If approved, generates a new password and returns it to admin
// -------------------------------------------------------
router.put('/reset-requests/:id', ...requireRole('admin'), async (req, res) => {
  try {
    const { action, adminComment } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (action === 'approve') {
      const newPassword = generatePassword('New@');
      user.password = await bcrypt.hash(newPassword, 10);

      // Push to history before updating status
      user.passwordResetHistory.push(buildResetHistoryEntry(user, 'approved', adminComment));
      user.passwordResetRequest.status = 'approved';
      user.passwordResetRequest.tempPasswordExpiresAt = undefined; // Ensure it's cleared if it existed
      user.passwordResetRequest.adminComment = adminComment;
      await user.save();

      return res.json({ message: 'Approved', newPassword });

    } else {
      // Push rejected entry to history too
      user.passwordResetHistory.push(buildResetHistoryEntry(user, 'rejected', adminComment));
      user.passwordResetRequest.status = 'rejected';
      user.passwordResetRequest.adminComment = adminComment;
      await user.save();
      return res.json({ message: 'Rejected' });
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
