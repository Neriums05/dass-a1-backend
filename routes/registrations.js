const router = require('express').Router();
const Registration = require('../models/Registration');
const Event = require('../models/Event');
const { requireRole } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const { sendEmail } = require('../utils/email');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// Must be before /event/:eventId to avoid route conflict
router.get('/mine', ...requireRole('participant'), async (req, res) => {
  try {
    const registrations = await Registration.find({ participant: req.user.id })
      .populate({
        path: 'event',
        select: 'name eventType startDate endDate status',
        populate: { path: 'organizer', select: 'organizerName' }
      })
      .sort({ createdAt: -1 })
      .lean();
    res.json(registrations);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/register/:eventId', ...requireRole('participant'), async (req, res) => {
  try {
    const event = await Event.findById(req.params.eventId);
    if (!event) return res.status(404).json({ message: 'Event not found' });

    if (event.eventType === 'merchandise') {
      return res.status(400).json({ message: 'Use the merchandise endpoint to purchase this item' });
    }

    if (!['published', 'ongoing'].includes(event.status)) {
      return res.status(400).json({ message: 'Event is not open for registration' });
    }
    if (event.registrationDeadline && new Date() > event.registrationDeadline) {
      return res.status(400).json({ message: 'Registration deadline has passed' });
    }
    if (event.startDate && new Date() > event.startDate) {
      return res.status(400).json({ message: 'Event has already started' });
    }

    const totalRegistered = await Registration.countDocuments({
      event: event._id,
      status: { $ne: 'cancelled' }
    });
    if (event.registrationLimit && totalRegistered >= event.registrationLimit) {
      return res.status(400).json({ message: 'This event is full' });
    }

    const alreadyRegistered = await Registration.findOne({
      event: event._id,
      participant: req.user.id,
      status: { $ne: 'cancelled' }
    });
    if (alreadyRegistered) {
      return res.status(400).json({ message: 'You have already registered for this event' });
    }

    if (!event.formLocked && event.eventType === 'normal') {
      event.formLocked = true;
      await event.save();
    }

    const ticketId = 'TKT-' + uuidv4().slice(0, 8).toUpperCase();

    const qrData = JSON.stringify({ ticketId, eventId: event._id });
    const qrCode = await QRCode.toDataURL(qrData);

    const registration = await Registration.create({
      event: event._id,
      participant: req.user.id,
      ticketId,
      qrCode,
      formResponses: req.body.formResponses || {}
    });

    const emailHtml = `
      <h2>You're registered for ${event.name}!</h2>
      <p>Your Ticket ID: <strong>${ticketId}</strong></p>
      <p>Show this QR code at the event:</p>
      <img src="${qrCode}" alt="QR Code" style="width:200px" />
    `;
    await sendEmail(req.user.email, 'Your Felicity Ticket - ' + event.name, emailHtml);

    res.status(201).json(registration);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

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
    if (event.startDate && new Date() > event.startDate) {
      return res.status(400).json({ message: 'Event has already occurred' });
    }

    if (!event.variants || event.variants.length === 0) {
      return res.status(400).json({ message: 'This event has no product variants configured' });
    }

    const { variant, quantity, productDetails } = req.body;

    if (!variant || !variant.size || !variant.color) {
      return res.status(400).json({ message: 'Please select a valid size and colour' });
    }

    if (!productDetails || !productDetails.trim()) {
      return res.status(400).json({ message: 'Product details are required' });
    }

    const orderQuantity = Number(quantity);
    if (!orderQuantity || !Number.isInteger(orderQuantity) || orderQuantity < 1) {
      return res.status(400).json({ message: 'Quantity must be a whole number greater than 0' });
    }

    const variantData = event.variants.find(
      v => v.size === variant.size && v.color === variant.color
    );
    if (!variantData || variantData.stock < orderQuantity) {
      return res.status(400).json({ message: 'Out of stock' });
    }

    const existingOrders = await Registration.find({
      event: event._id,
      participant: req.user.id,
      status: { $ne: 'cancelled' }
    });
    const alreadyBought = existingOrders.reduce((sum, r) => sum + (r.quantity || 1), 0);
    if (alreadyBought + orderQuantity > event.purchaseLimitPerParticipant) {
      return res.status(400).json({ message: 'Purchase limit exceeded' });
    }

    const ticketId = 'MERCH-' + uuidv4().slice(0, 8).toUpperCase();

    const registration = await Registration.create({
      event: event._id,
      participant: req.user.id,
      ticketId,
      status: 'pending_payment',
      variant,
      quantity: orderQuantity,
      productDetails
    });

    res.status(201).json({
      message: 'Order placed! Please upload your payment proof.',
      registrationId: registration._id
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

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
    if (reg.status === 'payment_rejected') {
      reg.status = 'pending_payment';
    }
    await reg.save();

    res.json({ message: 'Payment proof uploaded. Awaiting organizer approval.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put('/approve/:regId', ...requireRole('organizer'), async (req, res) => {
  try {
    const reg = await Registration.findById(req.params.regId)
      .populate('event')
      .populate('participant', 'email firstName lastName');

    if (!reg) return res.status(404).json({ message: 'Registration not found' });

    if (reg.event.organizer.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Access denied: not your event' });
    }

    const { action } = req.body;

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ message: 'Invalid action. Must be "approve" or "reject"' });
    }

    if (action === 'approve') {
      if (reg.event?.eventType !== 'merchandise') {
        return res.status(400).json({ message: 'This approval endpoint is only for merchandise orders' });
      }
      if (!['pending_payment', 'payment_rejected'].includes(reg.status)) {
        return res.status(400).json({ message: 'This order is not pending approval' });
      }
      if (!reg.paymentProof) {
        return res.status(400).json({ message: 'Payment proof not uploaded yet' });
      }

      const event = reg.event;
      const variant = event.variants.find(
        v => v.size === reg.variant?.size && v.color === reg.variant?.color
      );
      if (!variant) {
        reg.status = 'payment_rejected';
        await reg.save();
        return res.status(400).json({ message: 'Variant not found. Order rejected.' });
      }
      if (variant.stock < reg.quantity) {
        reg.status = 'payment_rejected';
        await reg.save();
        return res.status(400).json({ message: 'Insufficient stock to approve. Order rejected.' });
      }

      variant.stock -= reg.quantity;
      await event.save();

      const qrData = JSON.stringify({ ticketId: reg.ticketId });
      reg.qrCode = await QRCode.toDataURL(qrData);
      reg.status = 'registered';

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

router.get('/event/:eventId', ...requireRole('organizer'), async (req, res) => {
  try {
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
