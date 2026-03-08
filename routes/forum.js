const express = require('express');
const router = express.Router();
const ForumMessage = require('../models/ForumMessage');
const { auth } = require('../middleware/auth');

// Get chat history for an event
router.get('/:eventId', auth, async (req, res) => {
  try {
    const messages = await ForumMessage.find({ event: req.params.eventId }).sort('createdAt');
    res.json(messages);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
