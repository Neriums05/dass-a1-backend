const router = require('express').Router();
const User = require('../models/User');
const { requireRole } = require('../middleware/auth');

// Must be before /:id
router.put('/profile', ...requireRole('organizer'), async (req, res) => {
  try {
    const { organizerName, category, description, contactEmail, discordWebhook, contactNumber } = req.body;

    if (contactNumber && contactNumber.length !== 10) {
      return res.status(400).json({ message: 'Contact Number must be exactly 10 digits' });
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { organizerName, category, description, contactEmail, discordWebhook, contactNumber },
      { new: true }
    ).select('-password');
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Must be before /:id
router.post('/request-reset', ...requireRole('organizer'), async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    if (user.passwordResetRequest?.status === 'pending') {
      return res.status(400).json({ message: 'You already have a pending reset request. Please wait for admin review.' });
    }

    if (!req.body.reason || !req.body.reason.trim()) {
      return res.status(400).json({ message: 'Please provide a reason for the reset request.' });
    }

    user.passwordResetRequest = {
      status: 'pending',
      reason: req.body.reason.trim(),
      requestedAt: new Date()
    };
    await user.save();
    res.json({ message: 'Reset request sent to admin' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

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
