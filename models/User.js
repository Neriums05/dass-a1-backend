// This defines the structure of a User document in MongoDB.
// All three roles (participant, organizer, admin) share this single collection.
// Fields that don't apply to a role are simply left empty.

const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({

  // --- Shared fields (all roles) ---
  email:    { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true }, // always stored hashed
  role:     { type: String, enum: ['participant', 'organizer', 'admin'], required: true },

  // --- Participant-only fields ---
  firstName:       String,
  lastName:        String,
  participantType: { type: String, enum: ['iiit', 'non-iiit'] },
  college:         String,
  contactNumber:   { type: String, required: true },
  interests:       [String], // e.g. ['Music', 'Tech']
  // Array of organizer IDs this participant follows
  followedOrganizers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  hasCompletedOnboarding: { type: Boolean, default: false },

  // --- Organizer-only fields ---
  organizerName:  String,
  category:       String,
  description:    String,
  contactEmail:   String,
  discordWebhook: String, // optional Discord webhook URL

  // Password reset request (organizer asks admin to reset their password)
  // Single latest request — for pending/approved/rejected workflow
  passwordResetRequest: {
    status:      { type: String, enum: ['none', 'pending', 'approved', 'rejected'], default: 'none' },
    reason:      String,
    requestedAt: Date,
    adminComment: String
  },

  // Full history of all past reset requests (Issue 10 fix)
  passwordResetHistory: [{
    status:      { type: String, enum: ['approved', 'rejected'] },
    reason:      String,
    requestedAt: Date,
    resolvedAt:  Date,
    adminComment: String
  }]

}, { timestamps: true }); // adds createdAt and updatedAt automatically

module.exports = mongoose.model('User', userSchema);
