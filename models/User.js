const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({


  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['participant', 'organizer', 'admin'], required: true },

  firstName: String,
  lastName: String,
  participantType: { type: String, enum: ['iiit', 'non-iiit'] },
  college: String,
  contactNumber: String,
  interests: [String],

  followedOrganizers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  hasCompletedOnboarding: { type: Boolean, default: false },


  organizerName: String,
  category: String,
  description: String,
  contactEmail: String,
  discordWebhook: String,

  passwordResetRequest: {
    status: { type: String, enum: ['none', 'pending', 'approved', 'rejected'], default: 'none' },
    reason: String,
    requestedAt: Date,
    adminComment: String
  },


  passwordResetHistory: [{
    status: { type: String, enum: ['approved', 'rejected'] },
    reason: String,
    requestedAt: Date,
    resolvedAt: Date,
    adminComment: String
  }],

  securityQuestion: String,
  securityAnswer: String

}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
