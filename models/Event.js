const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema({

  name: { type: String, required: true },
  description: String,
  eventType: { type: String, enum: ['normal', 'merchandise'], required: true },
  eligibility: String,
  venue: String,
  prizePool: String,

  registrationDeadline: Date,
  startDate: Date,
  endDate: Date,
  registrationLimit: Number,
  registrationFee: { type: Number, default: 0 },

  organizer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  tags: [String],

  status: {
    type: String,
    enum: ['draft', 'published', 'ongoing', 'completed', 'closed'],
    default: 'draft'
  },

  customForm: [{
    label: String,                  
    fieldType: { type: String, enum: ['text', 'dropdown', 'checkbox', 'file'] },
    options: [String],
    required: Boolean,
    order: Number
  }],
  formLocked: { type: Boolean, default: false }, 

  variants: [{
    size: String,
    color: String,
    stock: Number
  }],
  purchaseLimitPerParticipant: { type: Number, default: 1 },

  viewCount: { type: Number, default: 0 },
  viewsToday: { type: Number, default: 0 },
  viewsDate: Date 

}, { timestamps: true });

module.exports = mongoose.model('Event', eventSchema);
