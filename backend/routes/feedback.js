// Feedback routes: submit anonymous feedback, view aggregated feedback

const router = require('express').Router();
const Feedback = require('../models/Feedback');
const Registration = require('../models/Registration');
const { auth, requireRole } = require('../middleware/auth');

// -------------------------------------------------------
// POST /api/feedback/:eventId
// Participant: submit anonymous feedback for an event
// Only allowed if they actually attended the event
// -------------------------------------------------------
router.post('/:eventId', ...requireRole('participant'), async (req, res) => {
  try {
    const attendance = await Registration.findOne({
      event:       req.params.eventId,
      participant: req.user.id,
      attended:    true
    });

    if (!attendance) {
      return res.status(403).json({ message: 'You can only leave feedback for events you attended' });
    }

    // Prevent duplicate feedback using a flag on the registration
    if (attendance.feedbackSubmitted) {
      return res.status(400).json({ message: 'You have already submitted feedback for this event' });
    }

    const rating = Number(req.body.rating);
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ message: 'Rating must be between 1 and 5' });
    }

    const { comment } = req.body;

    // Note: we do NOT store req.user.id in Feedback - that's what makes it anonymous
    await Feedback.create({ event: req.params.eventId, rating, comment });

    // Mark feedback as submitted on the registration (prevents duplicates)
    attendance.feedbackSubmitted = true;
    await attendance.save();

    res.status(201).json({ message: 'Feedback submitted anonymously!' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/:eventId', ...requireRole('organizer'), async (req, res) => {
  try {
    const feedbackList = await Feedback.find({ event: req.params.eventId }).sort({ createdAt: -1 });

    const average = feedbackList.length
      ? feedbackList.reduce((sum, f) => sum + f.rating, 0) / feedbackList.length
      : 0;

    res.json({
      feedbackList,
      averageRating: average.toFixed(1),
      total: feedbackList.length
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
