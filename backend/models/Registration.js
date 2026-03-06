// Defines a Registration document - one per participant per event.
// Also used for merchandise purchases.

const mongoose = require('mongoose');

const registrationSchema = new mongoose.Schema({

  // Which event and which participant
  event:       { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true },
  participant: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  // Unique ticket identifier, e.g. "TKT-A1B2C3D4"
  ticketId: { type: String, unique: true, sparse: true },

  // QR code stored as a base64 data URL (can be shown directly in an <img> tag)
  qrCode: String,

  // Registration status
  status: {
    type: String,
    enum: [
      'registered',       // normal registration complete
      'attended',         // organizer scanned their QR at the event
      'cancelled',        // participant or organizer cancelled
      'pending_payment',  // merchandise order placed, waiting for payment proof
      'payment_rejected'  // organizer rejected the payment proof
    ],
    default: 'registered'
  },

  // Answers to custom form fields (stored as a flexible object)
  formResponses: mongoose.Schema.Types.Mixed,

  // Merchandise-specific fields
  variant:      { size: String, color: String },
  quantity:     { type: Number, default: 1 },
  paymentProof: String, // path to uploaded image file

  // Attendance tracking
  attended:   { type: Boolean, default: false },
  attendedAt: Date,

  // Feedback tracking - prevents duplicate feedback submissions
  feedbackSubmitted: { type: Boolean, default: false }

}, { timestamps: true });

module.exports = mongoose.model('Registration', registrationSchema);
