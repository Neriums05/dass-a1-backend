// Organizer routes: list organizers, update profile, request password reset

const router = require('express').Router();
const User = require('../models/User');
const { requireRole } = require('../middleware/auth');

// -------------------------------------------------------
// PUT /api/organizers/profile
// Organizer: update their own profile
// NOTE: must be before /:id to avoid 'profile' being treated as an ID
// -------------------------------------------------------
router.put('/profile', ...requireRole('organizer'), async (req, res) => {
  try {
    const { organizerName, category, description, contactEmail, discordWebhook } = req.body;
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { organizerName, category, description, contactEmail, discordWebhook },
      { new: true }
    ).select('-password');
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// -------------------------------------------------------
// POST /api/organizers/request-reset
// Organizer: ask admin to reset their password
// NOTE: must be before /:id
// -------------------------------------------------------
router.post('/request-reset', ...requireRole('organizer'), async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    user.passwordResetRequest = {
      status: 'pending',
      reason: req.body.reason,
      requestedAt: new Date()
    };
    await user.save();
    res.json({ message: 'Reset request sent to admin' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// -------------------------------------------------------
// GET /api/organizers
// Public: list all organizers (for participants to browse/follow)
// -------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const organizers = await User.find({ role: 'organizer' })
      .select('organizerName category description contactEmail');
    res.json(organizers);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const organizer = await User.findById(req.params.id)
      .select('organizerName category description contactEmail');
    if (!organizer) return res.status(404).json({ message: 'Organizer not found' });
    res.json(organizer);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
