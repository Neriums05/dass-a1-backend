// Event routes: browse, view, create, update, attendance tracking
//
// CRITICAL ORDERING RULE: Express matches routes top-to-bottom.
// All specific/static paths MUST come before /:id wildcards.
// Order: /trending -> /mine/all -> /by-organizer/:id -> /:id/attend -> /:id/attendance -> /:id

const router = require('express').Router();
const Event = require('../models/Event');
const User = require('../models/User');
const Registration = require('../models/Registration');
const { auth, requireRole } = require('../middleware/auth');

// Helper: post a new event notification to Discord via webhook
// Uses the built-in fetch (Node 18+). Silently fails if no webhook configured.
async function fireDiscordWebhook(webhookUrl, event) {
  if (!webhookUrl) return;
  try {
    const message = '🎉 **New Event Published: ' + event.name + '**\n' +
      '📅 ' + (event.startDate ? new Date(event.startDate).toDateString() : 'TBD') + '\n' +
      (event.description ? event.description.slice(0, 200) : '');
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message })
    });
  } catch {
    // Never crash the app if Discord webhook fails
  }
}

// -------------------------------------------------------
// GET /api/events — browse all visible events with filters
// -------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const { search, type, dateFrom, dateTo, eligibility } = req.query;
    let query = { status: { $in: ['published', 'ongoing', 'completed'] } };

    if (type)        query.eventType  = type;
    if (eligibility) query.eligibility = { $regex: eligibility, $options: 'i' };

    if (dateFrom || dateTo) {
      query.startDate = {};
      if (dateFrom) query.startDate.$gte = new Date(dateFrom);
      if (dateTo)   query.startDate.$lte = new Date(dateTo);
    }

    // Fetch all matching events first, then filter by search (including organizer name)
    let events = await Event.find(query)
      .populate('organizer', 'organizerName category')
      .sort({ createdAt: -1 });

    // If search term given, filter client-side so we can match organizer name too
    if (search) {
      const re = new RegExp(search, 'i');
      events = events.filter(e =>
        re.test(e.name) ||
        e.tags?.some(t => re.test(t)) ||
        re.test(e.organizer?.organizerName || '')
      );
    }

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
    // Verify this organizer owns the event before returning attendance data
    const event = await Event.findOne({ _id: req.params.id, organizer: req.user.id });
    if (!event) return res.status(403).json({ message: 'Access denied: not your event' });

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
    // Verify this organizer owns the event
    const event = await Event.findOne({ _id: req.params.id, organizer: req.user.id });
    if (!event) return res.status(403).json({ message: 'Access denied: not your event' });

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

    // Increment view count. If it's a new day, also reset the daily counter.
    // Two separate update ops are needed: $inc viewCount always, plus either
    // $set viewsToday=1 (new day) or $inc viewsToday (same day).
    if (isNewDay) {
      await Event.findByIdAndUpdate(req.params.id, {
        $inc: { viewCount: 1 },
        $set: { viewsToday: 1, viewsDate: new Date() }
      });
    } else {
      await Event.findByIdAndUpdate(req.params.id, {
        $inc: { viewCount: 1, viewsToday: 1 }
      });
    }

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

    // If published immediately, fire Discord webhook
    if (event.status === 'published') {
      const organizer = await User.findById(req.user.id);
      fireDiscordWebhook(organizer?.discordWebhook, event);
    }

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

    // Remember the old status so we know if it just became published
    const oldStatus = event.status;

    if (event.status === 'draft') {
      // Draft events can be fully edited - update any field that was sent
      if (req.body.name !== undefined)                 event.name = req.body.name;
      if (req.body.description !== undefined)          event.description = req.body.description;
      if (req.body.eventType !== undefined)            event.eventType = req.body.eventType;
      if (req.body.eligibility !== undefined)          event.eligibility = req.body.eligibility;
      if (req.body.startDate !== undefined)            event.startDate = req.body.startDate;
      if (req.body.endDate !== undefined)              event.endDate = req.body.endDate;
      if (req.body.registrationDeadline !== undefined) event.registrationDeadline = req.body.registrationDeadline;
      if (req.body.registrationLimit !== undefined)    event.registrationLimit = req.body.registrationLimit;
      if (req.body.registrationFee !== undefined)      event.registrationFee = req.body.registrationFee;
      if (req.body.tags !== undefined)                 event.tags = req.body.tags;
      if (req.body.customForm !== undefined)           event.customForm = req.body.customForm;
      if (req.body.variants !== undefined)             event.variants = req.body.variants;
      if (req.body.purchaseLimitPerParticipant !== undefined) event.purchaseLimitPerParticipant = req.body.purchaseLimitPerParticipant;
      if (req.body.status !== undefined)               event.status = req.body.status;
    } else if (event.status === 'published') {
      // Published events: only limited fields can change
      if (req.body.description !== undefined)          event.description = req.body.description;
      if (req.body.registrationDeadline)               event.registrationDeadline = req.body.registrationDeadline;
      if (req.body.registrationLimit && Number(req.body.registrationLimit) > (event.registrationLimit || 0)) {
        event.registrationLimit = Number(req.body.registrationLimit);
      }
      if (req.body.status === 'ongoing' || req.body.status === 'closed') {
        event.status = req.body.status;
      }
    } else {
      // ongoing / completed / closed: only status changes allowed
      if (req.body.status) event.status = req.body.status;
    }

    await event.save();

    // Fire Discord webhook if event just became published
    if (oldStatus !== 'published' && event.status === 'published') {
      const organizer = await User.findById(req.user.id);
      fireDiscordWebhook(organizer?.discordWebhook, event);
    }

    res.json(event);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
