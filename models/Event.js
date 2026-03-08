// Defines the structure of an Event document in MongoDB.

const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema({

  name:        { type: String, required: true },
  description: String,
  eventType:   { type: String, enum: ['normal', 'merchandise'], required: true },
  eligibility: String, // e.g. "Open to all", "IIIT only"
  venue:       String,
  prizePool:   String,

  registrationDeadline: Date,
  startDate:            Date,
  endDate:              Date,
  registrationLimit:    Number, // max number of registrations allowed
  registrationFee:      { type: Number, default: 0 },

  // Reference to the organizer (User with role='organizer')
  organizer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  tags: [String], // e.g. ['workshop', 'coding']

  // Workflow: draft -> published -> ongoing -> completed (or closed)
  status: {
    type: String,
    enum: ['draft', 'published', 'ongoing', 'completed', 'closed'],
    default: 'draft'
  },

  // --- Normal event: custom registration form ---
  // Array of form fields the organizer creates
  customForm: [{
    label:     String,                  // question text
    fieldType: { type: String, enum: ['text', 'dropdown', 'checkbox', 'file'] },
    options:   [String],                // choices for dropdown/checkbox
    required:  Boolean,
    order:     Number                   // display order
  }],
  formLocked: { type: Boolean, default: false }, // locked after first registration

  // --- Merchandise event: product variants ---
  variants: [{
    size:  String,
    color: String,
    stock: Number
  }],
  purchaseLimitPerParticipant: { type: Number, default: 1 },

  // View tracking (for trending feature)
  viewCount:  { type: Number, default: 0 },
  viewsToday: { type: Number, default: 0 },
  viewsDate:  Date // the date viewsToday was last reset

}, { timestamps: true });

module.exports = mongoose.model('Event', eventSchema);
