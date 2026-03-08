const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const Event = require('./models/Event');
const ForumMessage = require('./models/ForumMessage');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || '*',
    methods: ['GET', 'POST']
  }
});

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error('Authentication error: No token provided'));
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = decoded;
    next();
  } catch (err) {
    next(new Error('Authentication error: Invalid token'));
  }
});

io.on('connection', (socket) => {
  const sendSocketError = (message) => socket.emit('error', { message });

  async function verifyOrganizerOwnership(eventId) {
    if (socket.user.role !== 'organizer') {
      sendSocketError('Only organizers can perform this action');
      return false;
    }

    const event = await Event.findOne({ _id: eventId, organizer: socket.user.id });
    if (!event) {
      sendSocketError('Access denied: Not your event');
      return false;
    }

    return true;
  }

  socket.on('joinRoom', async (eventId) => {
    let authorized = false;
    if (socket.user.role === 'admin') authorized = true;
    else if (socket.user.role === 'organizer') {
      const e = await Event.findOne({ _id: eventId, organizer: socket.user.id });
      if (e) authorized = true;
    } else {
      const Registration = require('./models/Registration');
      const r = await Registration.findOne({ event: eventId, participant: socket.user.id, status: { $ne: 'cancelled' } }).lean();
      if (r) {
        authorized = true;
      }
    }

    if (authorized) {
      socket.join(eventId);
    } else {
      sendSocketError('Access denied: You are not involved in this event');
    }
  });

  socket.on('sendMessage', async (data) => {
    const { eventId, text } = data;
    if (!text || !text.trim()) return;

    try {
      if (!socket.rooms.has(eventId)) {
        sendSocketError('You must join the event forum before sending messages');
        return;
      }

      const User = require('./models/User');
      const sender = await User.findById(socket.user.id);
      if (!sender) return sendSocketError('User not found');

      const senderName = sender.role === 'admin' ? 'Admin' : (sender.role === 'organizer' ? sender.organizerName : (sender.firstName + ' ' + sender.lastName));
      const senderRole = sender.role === 'admin' ? 'Admin' : (sender.role === 'organizer' ? 'Organizer' : 'Participant');

      const newMessage = await ForumMessage.create({
        event: eventId,
        senderName,
        senderRole,
        text: text.trim().slice(0, 1000)
      });
      io.to(eventId).emit('messageReceived', newMessage);
    } catch (err) {
      console.error('Error saving message:', err);
      sendSocketError('Failed to send message');
    }
  });

  socket.on('pinMessage', async ({ eventId, messageId }) => {
    try {
      if (!(await verifyOrganizerOwnership(eventId))) return;

      const message = await ForumMessage.findById(messageId);
      if (message && message.event.toString() === eventId) {
        message.isPinned = !message.isPinned;
        await message.save();
        io.to(eventId).emit('messagePinned', { messageId, isPinned: message.isPinned });
      } else {
        sendSocketError('Message not found in this event');
      }
    } catch (err) {
      console.error('Error pinning message:', err);
      sendSocketError('Failed to pin message');
    }
  });

  socket.on('deleteMessage', async ({ eventId, messageId }) => {
    try {
      if (!(await verifyOrganizerOwnership(eventId))) return;

      const message = await ForumMessage.findOne({ _id: messageId, event: eventId });
      if (message) {
        await message.deleteOne();
        io.to(eventId).emit('messageDeleted', messageId);
      } else {
        sendSocketError('Message not found in this event');
      }
    } catch (err) {
      console.error('Error deleting message:', err);
      sendSocketError('Failed to delete message');
    }
  });
});

app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());
app.use('/uploads', express.static('uploads'));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/events', require('./routes/events'));
app.use('/api/registrations', require('./routes/registrations'));
app.use('/api/organizers', require('./routes/organizers'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/feedback', require('./routes/feedback'));
app.use('/api/forum', require('./routes/forum'));

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log('Connected to MongoDB');
    await require('./utils/seedAdmin')();
    const PORT = process.env.PORT || 5000;
    server.listen(PORT, () => console.log('Server running on port ' + PORT));
  })
  .catch(err => console.error('MongoDB connection error:', err));
