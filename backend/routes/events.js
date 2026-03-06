// Event routes: browse, view, create, update, attendance tracking
//
// CRITICAL ORDERING RULE: Express matches routes top-to-bottom.
// All specific/static paths MUST come before /:id wildcards.
// Order: /trending -> /mine/all -> /by-organizer/:id -> /:id/attend -> /:id/attendance -> /:id

const router = require('express').Router();
const Event = require('../models/Event');
const { auth, requireRole } = require('../middleware/auth');

// -------------------------------------------------------
// GET /api/events — browse all visible events with filters
// -------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const { search, type, dateFrom, dateTo } = req.query;
    let query = { status: { $in: ['published', 'ongoing', 'completed'] } };

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { tags: { $regex: search, $options: 'i' } }
      ];
    }
    if (type) query.eventType = type;
    if (dateFrom || dateTo) {
      query.startDate = {};
      if (dateFrom) query.startDate.$gte = new Date(dateFrom);
      if (dateTo)   query.startDate.$lte = new Date(dateTo);
    }

    const events = await Event.find(query)
      .populate('organizer', 'organizerName category')
      .sort({ createdAt: -1 });
    res.json(events);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// -------------------------------------------------------
// GET /api/events/trending — top 5 by views in last 24h
// MUST be before /:id
// -------------------------------------------------------
router.get('/trending', async (req, res) => {
  try {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const events = await Event.find({
      status: { $in: ['published', 'ongoing'] },
      viewsDate: { $gte: yesterday }
    })
      .sort({ viewsToday: -1 })
      .limit(5)
      .populate('organizer', 'organizerName');
    res.json(events);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// -------------------------------------------------------
// GET /api/events/mine/all — organizer: all their events
// MUST be before /:id
// -------------------------------------------------------
router.get('/mine/all', ...requireRole('organizer'), async (req, res) => {
  try {
    const events = await Event.find({ organizer: req.user.id }).sort({ createdAt: -1 });
    res.json(events);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// -------------------------------------------------------
// GET /api/events/by-organizer/:organizerId — public events by one organizer
// MUST be before /:id
// -------------------------------------------------------
router.get('/by-organizer/:organizerId', async (req, res) => {
  try {
    const events = await Event.find({
      organizer: req.params.organizerId,
      status: { $in: ['published', 'ongoing', 'completed'] }
    });
    res.json(events);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// -------------------------------------------------------
// GET /api/events/:id/attendance — organizer: full attendance list
// MUST be before /:id (otherwise 'attendance' matches as event ID)
// -------------------------------------------------------
router.get('/:id/attendance', ...requireRole('organizer'), async (req, res) => {
  try {
    const Registration = require('../models/Registration');
    const regs = await Registration.find({ event: req.params.id })
      .populate('participant', 'firstName lastName email contactNumber');
    res.json(regs);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// -------------------------------------------------------
// POST /api/events/:id/attend — organizer: mark a ticket attended
// MUST be before PUT /:id
// -------------------------------------------------------
router.post('/:id/attend', ...requireRole('organizer'), async (req, res) => {
  try {
    const Registration = require('../models/Registration');
    const { ticketId } = req.body;

    if (!ticketId || !ticketId.trim()) {
      return res.status(400).json({ message: 'Ticket ID is required' });
    }

    const reg = await Registration.findOne({
      ticketId: ticketId.trim().toUpperCase(),
      event: req.params.id   // must belong to THIS event
    }).populate('participant', 'firstName lastName email');

    if (!reg) {
      return res.status(404).json({ message: 'Ticket not found for this event' });
    }
    if (reg.attended) {
      return res.status(400).json({ message: 'Already scanned', participant: reg.participant });
    }
    if (['cancelled', 'payment_rejected', 'pending_payment'].includes(reg.status)) {
      return res.status(400).json({ message: 'This registration is not active' });
    }

    reg.attended   = true;
    reg.attendedAt = new Date();
    reg.status     = 'attended';
    await reg.save();

    res.json({ message: 'Attendance marked!', participant: reg.participant });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// -------------------------------------------------------
// GET /api/events/:id — single event + increment view count
// -------------------------------------------------------
router.get('/:id', async (req, res) => {
  try {
    const event = await Event.findById(req.params.id)
      .populate('organizer', 'organizerName category contactEmail description');

    if (!event) return res.status(404).json({ message: 'Event not found' });

    const todayStr = new Date().toDateString();
    const isNewDay = !event.viewsDate || event.viewsDate.toDateString() !== todayStr;

    await Event.findByIdAndUpdate(req.params.id, {
      $inc: { viewCount: 1 },
      ...(isNewDay
        ? { $set: { viewsToday: 1, viewsDate: new Date() } }
        : { $inc: { viewsToday: 1 } })
    });

    res.json(event);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// -------------------------------------------------------
// POST /api/events — organizer: create new event
// -------------------------------------------------------
router.post('/', ...requireRole('organizer'), async (req, res) => {
  try {
    const event = await Event.create({
      ...req.body,
      organizer: req.user.id,
      status: req.body.status || 'draft'
    });
    res.status(201).json(event);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// -------------------------------------------------------
// PUT /api/events/:id — organizer: update event
// Edit rules depend on current status
// -------------------------------------------------------
router.put('/:id', ...requireRole('organizer'), async (req, res) => {
  try {
    const event = await Event.findOne({ _id: req.params.id, organizer: req.user.id });
    if (!event) return res.status(404).json({ message: 'Event not found' });

    if (event.status === 'draft') {
      // Draft: edit anything except protected fields
      const { organizer, _id, __v, ...updates } = req.body;
      Object.keys(updates).forEach(key => { event[key] = updates[key]; });

    } else if (event.status === 'published') {
      // Published: limited edits only
      const { description, registrationDeadline, registrationLimit, status } = req.body;
      if (description !== undefined) event.description = description;
      if (registrationDeadline)      event.registrationDeadline = registrationDeadline;
      if (registrationLimit && Number(registrationLimit) > (event.registrationLimit || 0)) {
        event.registrationLimit = Number(registrationLimit);
      }
      if (status === 'ongoing' || status === 'closed') event.status = status;

    } else {
      // Ongoing / Completed / Closed: status change only
      if (req.body.status) event.status = req.body.status;
    }

    await event.save();
    res.json(event);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
