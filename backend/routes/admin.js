// Admin routes: manage organizers, handle password reset requests

const router = require('express').Router();
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const { requireRole } = require('../middleware/auth');

// -------------------------------------------------------
// POST /api/admin/organizer
// Admin: create a new organizer account
// Auto-generates login email and a random password
// -------------------------------------------------------
router.post('/organizer', ...requireRole('admin'), async (req, res) => {
  try {
    const { organizerName, category, description, contactEmail } = req.body;

    // Generate a login email based on the organizer name
    const loginEmail = organizerName.toLowerCase().replace(/\s+/g, '') + '@felicity.org';

    // Generate a random password like "Pass@abc123"
    const rawPassword = 'Pass@' + Math.random().toString(36).slice(2, 8);
    const hashedPassword = await bcrypt.hash(rawPassword, 10);

    const user = await User.create({
      email: loginEmail,
      password: hashedPassword,
      role: 'organizer',
      organizerName, category, description, contactEmail
    });

    // Return the plain-text password so admin can share it with the organizer
    res.status(201).json({
      message: 'Organizer created',
      loginEmail,
      password: rawPassword, // admin shares this with the organizer
      id: user._id
    });
  } catch (err) {
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
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'Organizer removed' });
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
      // Generate and set a new password
      const newPassword = 'New@' + Math.random().toString(36).slice(2, 8);
      user.password = await bcrypt.hash(newPassword, 10);
      user.passwordResetRequest.status = 'approved';
      user.passwordResetRequest.adminComment = adminComment;
      await user.save();

      // Admin must manually share this with the organizer
      return res.json({ message: 'Approved', newPassword });

    } else {
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
