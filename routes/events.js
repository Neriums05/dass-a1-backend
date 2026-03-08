const router = require('express').Router();
const Event = require('../models/Event');
const User = require('../models/User');
const Registration = require('../models/Registration');
const { requireRole } = require('../middleware/auth');

async function fireDiscordWebhook(webhookUrl, event) {
  if (!webhookUrl) return;
  try {
    const message = '**New Event Published: ' + event.name + '**\n' +
      (event.startDate ? new Date(event.startDate).toDateString() : 'TBD') + '\n' +
      (event.description ? event.description.slice(0, 200) : '');
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message })
    });
  } catch {
  }
}

async function findOwnedEvent(eventId, organizerId) {
  return Event.findOne({ _id: eventId, organizer: organizerId });
}

router.get('/', async (req, res) => {
  try {
    const { search, type, dateFrom, dateTo, eligibility } = req.query;
    let query = { status: { $in: ['published', 'ongoing', 'completed'] } };

    if (type) query.eventType = type;
    if (eligibility) query.eligibility = { $regex: eligibility, $options: 'i' };

    if (dateFrom || dateTo) {
      query.startDate = {};
      if (dateFrom) query.startDate.$gte = new Date(dateFrom);
      if (dateTo) query.startDate.$lte = new Date(dateTo);
    }

    let events = await Event.find(query)
      .populate('organizer', 'organizerName category')
      .sort({ createdAt: -1 })
      .lean();

    if (search && search.trim()) {
      const terms = search.trim().split(/\s+/).filter(Boolean);
      const regexes = terms.map(t => new RegExp(t, 'i'));

      events = events.filter(e => {
        const textToMatch = [
          e.name,
          ...(e.tags || []),
          e.organizer?.organizerName || ''
        ].join(' ');

        return regexes.every(re => re.test(textToMatch));
      });
    }

    res.json(events);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/trending', async (req, res) => {
  try {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const events = await Event.find({
      status: { $in: ['published', 'ongoing'] },
      viewsDate: { $gte: yesterday }
    })
      .sort({ viewsToday: -1 })
      .limit(5)
      .populate('organizer', 'organizerName')
      .lean();
    res.json(events);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/mine/all', ...requireRole('organizer'), async (req, res) => {
  try {
    const events = await Event.find({ organizer: req.user.id }).sort({ createdAt: -1 }).lean();
    res.json(events);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/by-organizer/:organizerId', async (req, res) => {
  try {
    const events = await Event.find({
      organizer: req.params.organizerId,
      status: { $in: ['published', 'ongoing', 'completed'] }
    }).lean();
    res.json(events);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/:id/export-csv', ...requireRole('organizer'), async (req, res) => {
  try {
    const event = await findOwnedEvent(req.params.id, req.user.id);
    if (!event) return res.status(403).json({ message: 'Access denied' });

    const regs = await Registration.find({ event: req.params.id })
      .populate('participant', 'firstName lastName email contactNumber')
      .lean();

    const headers = ['Name', 'Email', 'Contact', 'Ticket ID', 'Status', 'Attended', 'Attended At'];
    const rows = regs.map(r => [
      ((r.participant?.firstName || '') + ' ' + (r.participant?.lastName || '')).trim(),
      r.participant?.email || '',
      r.participant?.contactNumber || '',
      r.ticketId || '',
      r.status,
      r.attended ? 'Yes' : 'No',
      r.attendedAt ? new Date(r.attendedAt).toISOString() : ''
    ]);

    const csv = [headers, ...rows].map(row =>
      row.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')
    ).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="event-${req.params.id}-participants.csv"`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/:id/attendance', ...requireRole('organizer'), async (req, res) => {
  try {
    const event = await findOwnedEvent(req.params.id, req.user.id);
    if (!event) return res.status(403).json({ message: 'Access denied: not your event' });

    const regs = await Registration.find({ event: req.params.id })
      .populate('participant', 'firstName lastName email contactNumber')
      .lean();
    res.json(regs);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/:id/attend', ...requireRole('organizer'), async (req, res) => {
  try {
    const event = await findOwnedEvent(req.params.id, req.user.id);
    if (!event) return res.status(403).json({ message: 'Access denied: not your event' });

    const { ticketId, method } = req.body;

    if (!ticketId || !ticketId.trim()) {
      return res.status(400).json({ message: 'Ticket ID is required' });
    }

    const reg = await Registration.findOne({
      ticketId: ticketId.trim().toUpperCase(),
      event: req.params.id
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

    reg.attended = true;
    reg.attendedAt = new Date();
    reg.status = 'attended';
    reg.attendanceMethod = method || 'manual';
    await reg.save();

    res.json({ message: 'Attendance marked!', participant: reg.participant });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const event = await Event.findById(req.params.id)
      .populate('organizer', 'organizerName category contactEmail description')
      .lean();

    if (!event) return res.status(404).json({ message: 'Event not found' });

    const todayStr = new Date().toDateString();
    const isNewDay = !event.viewsDate || event.viewsDate.toDateString() !== todayStr;

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

router.post('/', ...requireRole('organizer'), async (req, res) => {
  try {
    const { name, eventType, startDate, endDate, registrationDeadline } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ message: 'Event name is required' });
    if (!eventType) return res.status(400).json({ message: 'Event type is required' });

    if (startDate && endDate && new Date(endDate) < new Date(startDate)) {
      return res.status(400).json({ message: 'End date cannot be before start date' });
    }
    if (registrationDeadline && startDate && new Date(registrationDeadline) > new Date(startDate)) {
      return res.status(400).json({ message: 'Registration deadline cannot be after start date' });
    }

    let { tags, customForm, variants } = req.body;
    if (tags && typeof tags === 'string') tags = tags.split(',').map(t => t.trim()).filter(Boolean);
    if (!Array.isArray(tags)) tags = [];
    if (!Array.isArray(customForm)) customForm = [];
    if (!Array.isArray(variants)) variants = [];

    const event = await Event.create({
      ...req.body,
      tags, customForm, variants,
      venue: req.body.venue,
      prizePool: req.body.prizePool,
      organizer: req.user.id,
      status: req.body.status || 'draft'
    });

    if (event.status === 'published') {
      const organizer = await User.findById(req.user.id);
      fireDiscordWebhook(organizer?.discordWebhook, event);
    }

    res.status(201).json(event);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put('/:id', ...requireRole('organizer'), async (req, res) => {
  try {
    const event = await Event.findOne({ _id: req.params.id, organizer: req.user.id });
    if (!event) return res.status(404).json({ message: 'Event not found' });

    const oldStatus = event.status;

    if (event.status === 'draft') {
      const sDate = req.body.startDate !== undefined ? req.body.startDate : event.startDate;
      const eDate = req.body.endDate !== undefined ? req.body.endDate : event.endDate;
      const rDead = req.body.registrationDeadline !== undefined ? req.body.registrationDeadline : event.registrationDeadline;

      if (sDate && eDate && new Date(eDate) < new Date(sDate)) {
        return res.status(400).json({ message: 'End date cannot be before start date' });
      }
      if (rDead && sDate && new Date(rDead) > new Date(sDate)) {
        return res.status(400).json({ message: 'Registration deadline cannot be after start date' });
      }

      if (req.body.name !== undefined) event.name = req.body.name;
      if (req.body.description !== undefined) event.description = req.body.description;
      if (req.body.eventType !== undefined) event.eventType = req.body.eventType;
      if (req.body.eligibility !== undefined) event.eligibility = req.body.eligibility;
      if (req.body.startDate !== undefined) event.startDate = req.body.startDate;
      if (req.body.endDate !== undefined) event.endDate = req.body.endDate;
      if (req.body.registrationDeadline !== undefined) event.registrationDeadline = req.body.registrationDeadline;
      if (req.body.venue !== undefined) event.venue = req.body.venue;
      if (req.body.prizePool !== undefined) event.prizePool = req.body.prizePool;
      if (req.body.registrationLimit !== undefined) event.registrationLimit = req.body.registrationLimit;
      if (req.body.registrationFee !== undefined) event.registrationFee = req.body.registrationFee;
      if (req.body.tags !== undefined) event.tags = req.body.tags;
      if (req.body.customForm !== undefined && !event.formLocked) event.customForm = req.body.customForm;
      if (req.body.variants !== undefined) event.variants = req.body.variants;
      if (req.body.purchaseLimitPerParticipant !== undefined) event.purchaseLimitPerParticipant = req.body.purchaseLimitPerParticipant;
      if (req.body.status !== undefined) event.status = req.body.status;
    } else if (event.status === 'published') {
      if (req.body.registrationDeadline) {
        const sDate = event.startDate;
        if (sDate && new Date(req.body.registrationDeadline) > new Date(sDate)) {
          return res.status(400).json({ message: 'Registration deadline cannot be after start date' });
        }
        event.registrationDeadline = req.body.registrationDeadline;
      }
      if (req.body.description !== undefined) event.description = req.body.description;
      if (req.body.registrationLimit && Number(req.body.registrationLimit) > (event.registrationLimit || 0)) {
        event.registrationLimit = Number(req.body.registrationLimit);
      }
      if (req.body.venue !== undefined) event.venue = req.body.venue;
      if (req.body.prizePool !== undefined) event.prizePool = req.body.prizePool;
      if (req.body.status === 'ongoing' || req.body.status === 'closed') {
        event.status = req.body.status;
      }
    } else {
      if (req.body.status) event.status = req.body.status;
    }

    await event.save();

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
