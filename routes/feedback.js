const router = require('express').Router();
const Feedback = require('../models/Feedback');
const Registration = require('../models/Registration');
const Event = require('../models/Event');
const { auth, requireRole } = require('../middleware/auth');

router.post('/:eventId', ...requireRole('participant'), async (req, res) => {
  try {
    const attendance = await Registration.findOne({
      event: req.params.eventId,
      participant: req.user.id,
      attended: true
    });

    if (!attendance) {
      return res.status(403).json({ message: 'You can only leave feedback for events you attended' });
    }

    if (attendance.feedbackSubmitted) {
      return res.status(400).json({ message: 'You have already submitted feedback for this event' });
    }

    const rating = Number(req.body.rating);
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ message: 'Rating must be between 1 and 5' });
    }

    const { comment } = req.body;

    await Feedback.create({ event: req.params.eventId, rating, comment });

    attendance.feedbackSubmitted = true;
    await attendance.save();

    res.status(201).json({ message: 'Feedback submitted anonymously!' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/:eventId', ...requireRole('organizer'), async (req, res) => {
  try {
    const event = await Event.findOne({ _id: req.params.eventId, organizer: req.user.id });
    if (!event) return res.status(403).json({ message: 'Access denied: not your event' });

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
