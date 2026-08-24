const jwt = require('jsonwebtoken');
const connectedClients = new Map();

function initWebSocket(server) {
  const { Server } = require('socket.io');
  const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ['websocket', 'polling']
  });

  io.use((socket, next) => {
    let token = socket.handshake.auth.token;
    if (!token && socket.handshake.query && socket.handshake.query.token) {
      token = socket.handshake.query.token;
    }
    if (!token) return next(new Error('Authentication required'));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'mep_proj_jwt_s3cr3t_k3y_2026_powertech');
      socket.user = decoded;
      socket.userId = decoded.id || decoded.un;
      socket.userCo = decoded.co;
      socket.userRole = decoded.role;
      next();
    } catch (err) {
      console.error('[WebSocket Auth Error]:', err.message);
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`[WebSocket] Client connected: ${socket.userId} (${socket.userRole}) - Company: ${socket.userCo}`);
    connectedClients.set(socket.id, { socket, user: socket.user, co: socket.userCo, role: socket.userRole, userId: socket.userId });
    socket.emit('connected', { clientId: socket.id, user: socket.user, timestamp: new Date().toISOString() });
    const roomName = `company:${socket.userCo}`;
    socket.join(roomName);
    console.log(`[WebSocket] Client joined room: ${roomName}`);
    socket.on('disconnect', () => { connectedClients.delete(socket.id); console.log(`[WebSocket] Client disconnected: ${socket.userId}`); });
    socket.on('ping', () => { socket.emit('pong', { timestamp: new Date().toISOString() }); });
    socket.on('sync:request', (callback) => { callback({ received: true }); });
    socket.on('error', (error) => { console.error(`[WebSocket] Socket error for ${socket.userId}:`, error); });
  });

  return io;
}

function broadcastUpdate(io, companyId, role, entityType, entityData) {
  if (!io) { console.warn('[WebSocket] IO not initialized'); return; }
  const roomName = `company:${companyId}`;
  io.to(roomName).emit('data:update', { type: 'update', entityType, entity: entityData, timestamp: new Date().toISOString(), role });
  console.log(`[WebSocket] Broadcasted ${entityType} update to ${roomName}`);
}

function broadcastBulkData(io, companyId, bulkData) {
  if (!io) return;
  const roomName = `company:${companyId}`;
  io.to(roomName).emit('data:bulk', { type: 'bulk', data: bulkData, timestamp: new Date().toISOString() });
  console.log(`[WebSocket] Broadcasted bulk data to ${roomName}`);
}

function broadcastDelete(io, companyId, role, entityType, entityId) {
  if (!io) return;
  const roomName = `company:${companyId}`;
  io.to(roomName).emit('data:delete', { type: 'delete', entityType, entityId, timestamp: new Date().toISOString(), role });
  console.log(`[WebSocket] Broadcasted ${entityType} deletion to ${roomName}`);
}

function getConnectedClients(companyId) {
  let count = 0;
  connectedClients.forEach(client => { if (client.co === companyId) count++; });
  return count;
}

function getConnectedUsers(companyId) {
  const users = [];
  connectedClients.forEach(client => {
    if (client.co === companyId) {
      users.push({ userId: client.userId, name: client.user.name, role: client.userRole, lastSeen: new Date().toISOString() });
    }
  });
  return users;
}

module.exports = { initWebSocket, broadcastUpdate, broadcastBulkData, broadcastDelete, getConnectedClients, getConnectedUsers };
