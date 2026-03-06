// Registration routes: register for events, buy merchandise, upload payment proof, approve payments

const router = require('express').Router();
const Registration = require('../models/Registration');
const Event = require('../models/Event');
const { auth, requireRole } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const { sendEmail } = require('../utils/email');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Make sure the uploads folder exists
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

// Multer saves uploaded files to the 'uploads/' folder
const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (req, file, cb) => {
    // Use timestamp to avoid filename collisions
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// -------------------------------------------------------
// GET /api/registrations/mine
// Participant: get all their own registrations
// NOTE: must be before /event/:eventId to avoid route conflict
// -------------------------------------------------------
router.get('/mine', ...requireRole('participant'), async (req, res) => {
  try {
    const registrations = await Registration.find({ participant: req.user.id })
      .populate({
        path: 'event',
        select: 'name eventType startDate endDate status',
        populate: { path: 'organizer', select: 'organizerName' }
      })
      .sort({ createdAt: -1 });
    res.json(registrations);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// -------------------------------------------------------
// POST /api/registrations/register/:eventId
// Participant registers for a normal event
// -------------------------------------------------------
router.post('/register/:eventId', ...requireRole('participant'), async (req, res) => {
  try {
    const event = await Event.findById(req.params.eventId);
    if (!event) return res.status(404).json({ message: 'Event not found' });

    // Participants should use /merch/:eventId for merchandise events
    if (event.eventType === 'merchandise') {
      return res.status(400).json({ message: 'Use the merchandise endpoint to purchase this item' });
    }

    // Validation checks
    if (!['published', 'ongoing'].includes(event.status)) {
      return res.status(400).json({ message: 'Event is not open for registration' });
    }
    if (event.registrationDeadline && new Date() > event.registrationDeadline) {
      return res.status(400).json({ message: 'Registration deadline has passed' });
    }

    // Check if registration limit is reached
    const totalRegistered = await Registration.countDocuments({
      event: event._id,
      status: { $ne: 'cancelled' }
    });
    if (event.registrationLimit && totalRegistered >= event.registrationLimit) {
      return res.status(400).json({ message: 'This event is full' });
    }

    // Check if this participant already registered (and didn't cancel)
    const alreadyRegistered = await Registration.findOne({
      event: event._id,
      participant: req.user.id,
      status: { $ne: 'cancelled' }
    });
    if (alreadyRegistered) {
      return res.status(400).json({ message: 'You have already registered for this event' });
    }

    // Lock the custom form once the first registration comes in
    // (so organizer can't change questions after people have answered)
    if (!event.formLocked && event.eventType === 'normal') {
      event.formLocked = true;
      await event.save();
    }

    // Generate a unique ticket ID
    const ticketId = 'TKT-' + uuidv4().slice(0, 8).toUpperCase();

    // Generate QR code containing the ticket ID
    // This base64 string can be used directly as <img src="...">
    const qrData = JSON.stringify({ ticketId, eventId: event._id });
    const qrCode = await QRCode.toDataURL(qrData);

    const registration = await Registration.create({
      event: event._id,
      participant: req.user.id,
      ticketId,
      qrCode,
      formResponses: req.body.formResponses || {}
    });

    // Send confirmation email with QR code
    const emailHtml = `
      <h2>You're registered for ${event.name}!</h2>
      <p>Your Ticket ID: <strong>${ticketId}</strong></p>
      <p>Show this QR code at the event:</p>
      <img src="${qrCode}" alt="QR Code" style="width:200px" />
    `;
    sendEmail(req.user.email, 'Your Felicity Ticket - ' + event.name, emailHtml);

    res.status(201).json(registration);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// -------------------------------------------------------
// POST /api/registrations/merch/:eventId
// Participant places a merchandise order (status = pending_payment)
// -------------------------------------------------------
router.post('/merch/:eventId', ...requireRole('participant'), async (req, res) => {
  try {
    const event = await Event.findById(req.params.eventId);
    if (!event || event.eventType !== 'merchandise') {
      return res.status(400).json({ message: 'Not a merchandise event' });
    }

    if (!['published', 'ongoing'].includes(event.status)) {
      return res.status(400).json({ message: 'This event is not open for orders' });
    }

    if (event.registrationDeadline && new Date() > event.registrationDeadline) {
      return res.status(400).json({ message: 'Order deadline has passed' });
    }

    if (!event.variants || event.variants.length === 0) {
      return res.status(400).json({ message: 'This event has no product variants configured' });
    }

    const { variant, quantity } = req.body;

    if (!variant || !variant.size || !variant.color) {
      return res.status(400).json({ message: 'Please select a valid size and colour' });
    }

    if (!quantity || quantity < 1) {
      return res.status(400).json({ message: 'Quantity must be at least 1' });
    }

    // Check stock for the chosen variant
    const variantData = event.variants.find(
      v => v.size === variant.size && v.color === variant.color
    );
    if (!variantData || variantData.stock < quantity) {
      return res.status(400).json({ message: 'Out of stock' });
    }

    // Check how many this participant has already bought
    const existingOrders = await Registration.find({
      event: event._id,
      participant: req.user.id,
      status: { $ne: 'cancelled' }
    });
    const alreadyBought = existingOrders.reduce((sum, r) => sum + (r.quantity || 1), 0);
    if (alreadyBought + quantity > event.purchaseLimitPerParticipant) {
      return res.status(400).json({ message: 'Purchase limit exceeded' });
    }

    const ticketId = 'MERCH-' + uuidv4().slice(0, 8).toUpperCase();

    const registration = await Registration.create({
      event: event._id,
      participant: req.user.id,
      ticketId,
      status: 'pending_payment', // wait for payment proof upload
      variant,
      quantity
    });

    res.status(201).json({
      message: 'Order placed! Please upload your payment proof.',
      registrationId: registration._id
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// -------------------------------------------------------
// POST /api/registrations/payment-proof/:regId
// Participant uploads payment screenshot for a merch order
// -------------------------------------------------------
router.post('/payment-proof/:regId', ...requireRole('participant'), upload.single('proof'), async (req, res) => {
  try {
    const reg = await Registration.findOne({ _id: req.params.regId, participant: req.user.id });
    if (!reg) return res.status(404).json({ message: 'Registration not found' });

    if (!['pending_payment', 'payment_rejected'].includes(reg.status)) {
      return res.status(400).json({ message: 'Payment proof can only be uploaded for pending or rejected orders' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    reg.paymentProof = req.file.path;
    // Reset status to pending_payment if it was rejected (re-submission)
    if (reg.status === 'payment_rejected') {
      reg.status = 'pending_payment';
    }
    await reg.save();

    res.json({ message: 'Payment proof uploaded. Awaiting organizer approval.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// -------------------------------------------------------
// PUT /api/registrations/approve/:regId
// Organizer approves or rejects a merchandise payment
// -------------------------------------------------------
router.put('/approve/:regId', ...requireRole('organizer'), async (req, res) => {
  try {
    const reg = await Registration.findById(req.params.regId)
      .populate('event')
      .populate('participant', 'email firstName lastName');

    if (!reg) return res.status(404).json({ message: 'Registration not found' });

    // Ensure this organizer owns the event being approved
    if (reg.event.organizer.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Access denied: not your event' });
    }

    const { action } = req.body; // 'approve' or 'reject'

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ message: 'Invalid action. Must be "approve" or "reject"' });
    }

    if (action === 'approve') {
      // Decrement stock for the purchased variant
      const event = reg.event;
      const variant = event.variants.find(
        v => v.size === reg.variant?.size && v.color === reg.variant?.color
      );
      if (variant) {
        variant.stock -= reg.quantity;
        await event.save();
      }

      // Generate QR code now that payment is confirmed
      const qrData = JSON.stringify({ ticketId: reg.ticketId });
      reg.qrCode = await QRCode.toDataURL(qrData);
      reg.status = 'registered';

      // Send confirmation email
      const emailHtml = `
        <h2>Your order has been approved!</h2>
        <p>Ticket ID: <strong>${reg.ticketId}</strong></p>
        <img src="${reg.qrCode}" alt="QR Code" style="width:200px" />
      `;
      sendEmail(reg.participant.email, 'Order Approved!', emailHtml);

    } else if (action === 'reject') {
      reg.status = 'payment_rejected';
    }

    await reg.save();
    res.json({ message: 'Updated successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// -------------------------------------------------------
// GET /api/registrations/event/:eventId
// Organizer: get all registrations for one of their events
// -------------------------------------------------------
router.get('/event/:eventId', ...requireRole('organizer'), async (req, res) => {
  try {
    // Verify ownership
    const event = await Event.findOne({ _id: req.params.eventId, organizer: req.user.id });
    if (!event) return res.status(403).json({ message: 'Access denied: not your event' });

    const registrations = await Registration.find({ event: req.params.eventId })
      .populate('participant', 'firstName lastName email contactNumber');
    res.json(registrations);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
