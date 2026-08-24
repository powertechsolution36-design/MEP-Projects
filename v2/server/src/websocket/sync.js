const jwt = require('jsonwebtoken');
const { SECRET } = require('../middleware/auth');
const User = require('../models/User');

function room(coId) { return `co:${coId}`; }

function initSocket(io) {
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error('No token'));
      const decoded = jwt.verify(token, SECRET);
      const user = await User.findById(decoded.id).select('-pw').lean();
      if (!user || user.disabled) return next(new Error('Invalid user'));
      socket.user = user;
      next();
    } catch (err) { next(new Error('Auth failed')); }
  });

  io.on('connection', (socket) => {
    const u = socket.user;
    const r = room(u.co);
    socket.join(r);
    if (u.role === 'super') socket.join('super');
    socket.emit('ready', { user: { id: u._id, name: u.name, role: u.role, co: u.co } });
    socket.on('ping', () => socket.emit('pong', Date.now()));
    socket.on('disconnect', () => {});
  });

  return io;
}

function emit(io, coId, event, payload) {
  if (!io) return;
  io.to(room(coId)).emit(event, payload);
  io.to('super').emit(event, payload);
}

function broadcastUpdate(io, coId, resource, doc) {
  emit(io, coId, `${resource}:update`, doc);
}

function broadcastDelete(io, coId, resource, id) {
  emit(io, coId, `${resource}:delete`, { _id: id });
}

module.exports = { initSocket, broadcastUpdate, broadcastDelete, emit };
