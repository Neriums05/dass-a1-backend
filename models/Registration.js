const mongoose = require('mongoose');

const registrationSchema = new mongoose.Schema({


  event: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true },
  participant: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },


  ticketId: { type: String, unique: true, sparse: true },

  qrCode: String,

  status: {
    type: String,
    enum: [
      'registered',
      'attended',
      'cancelled',
      'pending_payment',
      'payment_rejected'
    ],
    default: 'registered'
  },


  formResponses: mongoose.Schema.Types.Mixed,


  variant: { size: String, color: String },
  quantity: { type: Number, default: 1 },
  productDetails: String,
  paymentProof: String,

  attended: { type: Boolean, default: false },
  attendedAt: Date,
  attendanceMethod: { type: String, enum: ['scan', 'manual'] },


  feedbackSubmitted: { type: Boolean, default: false }

}, { timestamps: true });

module.exports = mongoose.model('Registration', registrationSchema);
