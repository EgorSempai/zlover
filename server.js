const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
// FIXED: Removed unused uuidv4 import
const path = require('path');

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' ? 
      [process.env.DOMAIN, `https://${process.env.DOMAIN}`, `http://${process.env.DOMAIN}`] : 
      "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

// TURN Server Configuration
const TURN_SERVER_IP = process.env.TURN_SERVER_IP || '185.117.154.193';

// FIXED: Use static credentials matching the working configuration
function getIceServers() {
  console.log('🔄 Sending static TURN credentials (nearsnap)');
  
  return [
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    {
      urls: 'turn:185.117.154.193:3478',
      username: 'nearsnap',
      credential: 'nearsnap123'
    },
    {
      urls: 'turns:185.117.154.193:5349',
      username: 'nearsnap',
      credential: 'nearsnap123'
    }
  ];
}

// Data storage in RAM
const rooms = new Map(); // roomId -> { users: Set(socketId), host: socketId }
const userMap = new Map(); // socketId -> { roomId, nickname }
const connections = new Map(); // IP -> [timestamps]

// Rate limiting configuration
const RATE_LIMIT = 100; // connections per window
const RATE_WINDOW = 15 * 60 * 1000; // 15 minutes

// Security middleware
app.use((req, res, next) => {
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  
  next();
});

// Enhanced input validation and sanitization
function validateAndSanitizeInput(data) {
  const errors = [];
  
  // Validate room ID
  if (!data.roomId || typeof data.roomId !== 'string') {
    errors.push('Room ID is required');
  } else if (data.roomId.length > 50) {
    errors.push('Room ID too long (max 50 characters)');
  } else if (!/^[a-zA-Z0-9-_]+$/.test(data.roomId)) {
    errors.push('Room ID contains invalid characters (only letters, numbers, hyphens, underscores allowed)');
  }
  
  // Validate nickname
  if (!data.nickname || typeof data.nickname !== 'string') {
    errors.push('Nickname is required');
  } else if (data.nickname.length < 2) {
    errors.push('Nickname too short (min 2 characters)');
  } else if (data.nickname.length > 20) {
    errors.push('Nickname too long (max 20 characters)');
  } else if (!/^[\w\s-]+$/u.test(data.nickname)) {
    errors.push('Nickname contains invalid characters');
  }
  
  // Sanitize inputs
  const sanitized = {
    roomId: data.roomId.trim().toLowerCase(),
    nickname: data.nickname.trim().replace(/\s+/g, ' ')
  };
  
  return { errors, sanitized };
}

// Check for duplicate nicknames in room
function checkDuplicateNickname(roomId, nickname, excludeSocketId = null) {
  const room = rooms.get(roomId);
  if (!room) return false;
  
  for (const socketId of room.users) {
    if (socketId === excludeSocketId) continue;
    const user = userMap.get(socketId);
    if (user && user.nickname.toLowerCase() === nickname.toLowerCase()) {
      return true;
    }
  }
  return false;
}

// Enhanced rate limiting with progressive penalties and cleanup
function checkEnhancedRateLimit(ip) { // FIXED: Removed unused socketId parameter
  if (process.env.NODE_ENV !== 'production') return { allowed: true };
  
  const now = Date.now();
  const userConnections = connections.get(ip) || [];
  
  // FIXED: Clean up old connections to prevent memory leak
  const recentConnections = userConnections.filter(time => now - time < RATE_WINDOW);
  
  // Progressive rate limiting
  let limit = RATE_LIMIT;
  if (recentConnections.length > 50) limit = 20; // Reduce limit for heavy users
  if (recentConnections.length > 80) limit = 5;  // Severe limit for abusers
  
  if (recentConnections.length >= limit) {
    console.log(`Rate limit exceeded for IP: ${ip.substring(0, 8)}... (${recentConnections.length}/${limit})`); // FIXED: Don't log full IP
    return { 
      allowed: false, 
      reason: 'Rate limit exceeded',
      retryAfter: Math.ceil((RATE_WINDOW - (now - Math.min(...recentConnections))) / 1000)
    };
  }
  
  recentConnections.push(now);
  // FIXED: Update with cleaned connections to prevent memory leak
  connections.set(ip, recentConnections);
  return { allowed: true };
}

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Enhanced health check endpoint with detailed metrics
app.get('/health', (req, res) => { // FIXED: Added req parameter back for consistency
  try { // FIXED: Added error handling
    const uptime = process.uptime();
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    // Calculate room statistics
    let totalUsers = 0;
    let activeRooms = 0;
    let largestRoom = 0;
    
    for (const [roomId, room] of rooms.entries()) {
      if (room.users.size > 0) {
        activeRooms++;
        totalUsers += room.users.size;
        largestRoom = Math.max(largestRoom, room.users.size);
      }
    }
    
    const healthData = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: {
        seconds: Math.floor(uptime),
        human: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`
      },
      memory: {
        used: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
        total: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB',
        external: Math.round(memUsage.external / 1024 / 1024) + 'MB'
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system
      },
      rooms: {
        total: rooms.size,
        active: activeRooms,
        empty: rooms.size - activeRooms
      },
      users: {
        total: totalUsers,
        connected: userMap.size,
        largestRoom: largestRoom
      },
      environment: process.env.NODE_ENV || 'development',
      nodeVersion: process.version,
      platform: process.platform,
      turnServer: {
        ip: TURN_SERVER_IP,
        hasSecret: true // Using static credentials
      }
    };
    
    res.json(healthData);
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Health check failed',
      timestamp: new Date().toISOString()
    });
  }
});

// Detailed metrics endpoint (protected in production)
app.get('/metrics', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Metrics endpoint disabled in production' });
  }
  
  const metrics = {
    timestamp: new Date().toISOString(),
    connections: connections.size,
    rooms: Array.from(rooms.entries()).map(([id, room]) => ({
      id,
      users: room.users.size,
      host: room.host,
      created: new Date(room.created).toISOString(),
      age: Date.now() - room.created
    })),
    users: Array.from(userMap.entries()).map(([socketId, user]) => ({
      socketId,
      roomId: user.roomId,
      nickname: user.nickname
    })),
    rateLimiting: Array.from(connections.entries()).map(([ip, timestamps]) => ({
      ip,
      connections: timestamps.length,
      lastConnection: new Date(Math.max(...timestamps)).toISOString()
    }))
  };
  
  res.json(metrics);
});

// Routes
app.get('/', (_req, res) => { // FIXED: Use underscore prefix for unused parameter
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/room/:roomId', (req, res) => { // FIXED: roomId is used in the route parameter
  // FIXED: Added basic validation for room ID from URL
  const { roomId } = req.params;
  if (!roomId || !/^[a-zA-Z0-9-_]+$/.test(roomId)) {
    return res.status(400).send('Invalid room ID');
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  const clientIP = socket.handshake.address;
  
  // Enhanced rate limiting check
  const rateLimitResult = checkEnhancedRateLimit(clientIP); // FIXED: Removed unused socketId parameter
  if (!rateLimitResult.allowed) {
    console.log(`Connection rejected for IP: ${clientIP.substring(0, 8)}... - ${rateLimitResult.reason}`); // FIXED: Don't log full IP
    socket.emit('error', {
      type: 'RATE_LIMIT',
      message: rateLimitResult.reason,
      retryAfter: rateLimitResult.retryAfter
    });
    socket.disconnect();
    return;
  }
  
  console.log(`User connected: ${socket.id} from ${clientIP.substring(0, 8)}...`); // FIXED: Don't log full IP for privacy

  // Enhanced join room event with validation
  socket.on('join-room', (data) => {
    try {
      // Validate and sanitize input
      const validation = validateAndSanitizeInput(data);
      if (validation.errors.length > 0) {
        socket.emit('error', {
          type: 'VALIDATION_ERROR',
          message: 'Invalid input',
          details: validation.errors
        });
        return;
      }
      
      const { roomId, nickname } = validation.sanitized;
      
      console.log(`Join room request: ${socket.id} wants to join ${roomId} as ${nickname}`);
      
      // Check if user is already in a room
      const existingUser = userMap.get(socket.id);
      if (existingUser) {
        socket.emit('error', {
          type: 'ALREADY_IN_ROOM',
          message: 'You are already in a room',
          currentRoom: existingUser.roomId
        });
        return;
      }
      
      // Create room if it doesn't exist
      if (!rooms.has(roomId)) {
        rooms.set(roomId, {
          users: new Set(),
          host: socket.id,
          created: Date.now(),
          maxUsers: 10
        });
        console.log(`Created new room: ${roomId} with host ${socket.id}`);
      }

      const room = rooms.get(roomId);
      
      // Check room size limit
      if (room.users.size >= room.maxUsers) {
        socket.emit('error', {
          type: 'ROOM_FULL',
          message: 'Room is full',
          maxUsers: room.maxUsers,
          currentUsers: room.users.size
        });
        return;
      }
      
      // Check for duplicate nickname
      if (checkDuplicateNickname(roomId, nickname, socket.id)) {
        socket.emit('error', {
          type: 'NICKNAME_TAKEN',
          message: 'Nickname is already taken in this room',
          suggestion: `${nickname}_${Math.floor(Math.random() * 100)}`
        });
        return;
      }
      
      // Add user to room
      room.users.add(socket.id);
      userMap.set(socket.id, { roomId, nickname, joinedAt: Date.now() });
      
      // Join socket room
      socket.join(roomId);
      
      // Get existing users in room (excluding current user)
      const existingUsers = Array.from(room.users).filter(id => id !== socket.id);
      
      console.log(`Existing users in room ${roomId}:`, existingUsers);
      
      // Generate fresh ICE servers for this connection
      const iceServers = getIceServers();
      
      // Send existing users to new user
      socket.emit('existing-users', {
        users: existingUsers,
        isHost: room.host === socket.id,
        iceServers: iceServers, // Send dynamic TURN credentials
        roomInfo: {
          id: roomId,
          created: room.created,
          userCount: room.users.size,
          maxUsers: room.maxUsers
        }
      });
      
      // Notify existing users about new user
      socket.to(roomId).emit('user-joined', {
        socketId: socket.id,
        nickname: nickname,
        iceServers: iceServers, // Send dynamic TURN credentials to existing users
        joinedAt: Date.now()
      });
      
      console.log(`User ${socket.id} (${nickname}) joined room ${roomId}`);
      console.log(`Room ${roomId} now has ${room.users.size} users`);
      
      // Send welcome message
      socket.emit('room-joined', {
        roomId,
        nickname,
        isHost: room.host === socket.id,
        iceServers: iceServers, // Send dynamic TURN credentials
        userCount: room.users.size
      });
      
    } catch (error) {
      console.error('Error in join-room:', error);
      socket.emit('error', {
        type: 'SERVER_ERROR',
        message: 'Internal server error',
        code: 'JOIN_ROOM_ERROR'
      });
    }
  });

  // Enhanced WebRTC signal handling with validation and logging
  socket.on('signal', (data) => {
    try {
      const { to, signal } = data;
      
      // Validate signal data
      if (!to || !signal) {
        socket.emit('error', {
          type: 'INVALID_SIGNAL',
          message: 'Invalid signal data'
        });
        return;
      }
      
      // Check if target user exists
      const targetUser = userMap.get(to);
      const currentUser = userMap.get(socket.id);
      
      if (!targetUser || !currentUser) {
        socket.emit('error', {
          type: 'USER_NOT_FOUND',
          message: 'Target user not found'
        });
        return;
      }
      
      // Check if users are in the same room
      if (targetUser.roomId !== currentUser.roomId) {
        socket.emit('error', {
          type: 'ROOM_MISMATCH',
          message: 'Users not in same room'
        });
        return;
      }
      
      console.log(`Signal ${signal.type} from ${socket.id} to ${to} in room ${currentUser.roomId}`);
      
      // Forward signal to target user with additional metadata
      socket.to(to).emit('signal', {
        from: socket.id,
        signal: signal,
        timestamp: Date.now(),
        roomId: currentUser.roomId
      });
      
      // Log WebRTC connection attempts for diagnostics
      if (signal.type === 'offer') {
        console.log(`📞 WebRTC offer: ${socket.id} → ${to}`);
      } else if (signal.type === 'answer') {
        console.log(`📞 WebRTC answer: ${socket.id} → ${to}`);
      } else if (signal.type === 'candidate') {
        console.log(`🔗 ICE candidate: ${socket.id} → ${to}`);
      }
      
    } catch (error) {
      console.error('Error in signal handling:', error);
      socket.emit('error', {
        type: 'SIGNAL_ERROR',
        message: 'Error processing WebRTC signal',
        details: error.message
      });
    }
  });

  // Enhanced chat message with security and validation
  socket.on('chat-message', (data) => {
    try {
      const user = userMap.get(socket.id);
      if (!user) {
        socket.emit('error', {
          type: 'USER_NOT_FOUND',
          message: 'User not found'
        });
        return;
      }
      
      // Validate message
      if (!data.message || typeof data.message !== 'string') {
        socket.emit('error', {
          type: 'INVALID_MESSAGE',
          message: 'Invalid message format'
        });
        return;
      }
      
      // Security: limit message length and sanitize
      const sanitizedMessage = data.message
        .substring(0, 500)
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove script tags
        .replace(/javascript:/gi, '') // Remove javascript: URLs
        .trim();
      
      if (!sanitizedMessage) {
        socket.emit('error', {
          type: 'EMPTY_MESSAGE',
          message: 'Message cannot be empty'
        });
        return;
      }
      
      const messageData = {
        socketId: socket.id,
        nickname: user.nickname,
        message: sanitizedMessage,
        timestamp: Date.now(),
        roomId: user.roomId
      };
      
      // Send message to all users in room
      io.to(user.roomId).emit('chat-message', messageData);
      
      console.log(`💬 Chat message in room ${user.roomId}: ${user.nickname}: ${sanitizedMessage.substring(0, 50)}...`);
      
    } catch (error) {
      console.error('Error in chat-message:', error);
      socket.emit('error', {
        type: 'CHAT_ERROR',
        message: 'Error sending message',
        details: error.message
      });
    }
  });

  // Connection diagnostics and monitoring
  socket.on('connection-diagnostic', (data) => {
    try {
      const user = userMap.get(socket.id);
      if (!user) return;
      
      const diagnosticData = {
        socketId: socket.id,
        roomId: user.roomId,
        nickname: user.nickname,
        timestamp: Date.now(),
        clientData: data,
        serverInfo: {
          uptime: process.uptime(),
          memoryUsage: process.memoryUsage(),
          roomUsers: rooms.get(user.roomId)?.users.size || 0
        }
      };
      
      console.log(`🔍 Connection diagnostic from ${socket.id}:`, diagnosticData);
      
      // Send diagnostic response
      socket.emit('diagnostic-response', diagnosticData);
      
    } catch (error) {
      console.error('Error in connection-diagnostic:', error);
    }
  });

  // WebRTC connection quality reporting
  socket.on('webrtc-stats', (data) => {
    try {
      const user = userMap.get(socket.id);
      if (!user) return;
      
      console.log(`📊 WebRTC stats from ${user.nickname} (${socket.id}):`, {
        roomId: user.roomId,
        peersCount: data.peersCount || 0,
        avgBitrate: data.avgBitrate || 0,
        avgPacketLoss: data.avgPacketLoss || 0,
        avgRTT: data.avgRTT || 0,
        timestamp: Date.now()
      });
      
      // Could store these stats for monitoring/analytics
      
    } catch (error) {
      console.error('Error in webrtc-stats:', error);
    }
  });

  // TURN connection verification
  socket.on('turn-verification', (data) => {
    const user = userMap.get(socket.id);
    if (!user) return;
    
    console.log(`🔄 TURN verification from ${user.nickname}:`, data);
    
    if (data.usingTurn) {
      console.log(`✅ ${user.nickname} successfully using TURN relay`);
    } else {
      console.warn(`⚠️ ${user.nickname} not using TURN relay - connection type: ${data.connectionType}`);
    }
  });

  // Connection quality monitoring
  socket.on('connection-quality', (data) => {
    try {
      const user = userMap.get(socket.id);
      if (!user) return;
      
      // Log connection quality issues
      if (data.quality === 'poor' || data.packetLoss > 5) {
        console.log(`⚠️ Poor connection quality for ${user.nickname} (${socket.id}):`, data);
      }
      
      // Broadcast quality info to room (for adaptive streaming)
      socket.to(user.roomId).emit('peer-quality-update', {
        socketId: socket.id,
        quality: data.quality,
        timestamp: Date.now()
      });
      
    } catch (error) {
      console.error('Error in connection-quality:', error);
    }
  });

  // Enhanced kick user with security checks
  socket.on('kick-user', (data) => {
    try {
      const { targetSocketId, reason } = data;
      const user = userMap.get(socket.id);
      
      if (!user || !targetSocketId) {
        socket.emit('error', {
          type: 'INVALID_KICK_REQUEST',
          message: 'Invalid kick request'
        });
        return;
      }
      
      const room = rooms.get(user.roomId);
      if (!room || room.host !== socket.id) {
        socket.emit('error', {
          type: 'UNAUTHORIZED',
          message: 'Only room host can kick users'
        });
        return;
      }
      
      // Prevent self-kick
      if (targetSocketId === socket.id) {
        socket.emit('error', {
          type: 'SELF_KICK',
          message: 'Cannot kick yourself'
        });
        return;
      }
      
      // Check if target user exists and is in same room
      const targetUser = userMap.get(targetSocketId);
      if (!targetUser || targetUser.roomId !== user.roomId) {
        socket.emit('error', {
          type: 'USER_NOT_IN_ROOM',
          message: 'User not found in room'
        });
        return;
      }
      
      console.log(`👮 Host ${socket.id} kicking user ${targetSocketId} from room ${user.roomId}. Reason: ${reason || 'No reason provided'}`);
      
      // Kick the target user
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket) {
        targetSocket.emit('kicked', {
          reason: reason || 'Kicked by room host',
          hostNickname: user.nickname,
          timestamp: Date.now()
        });
        
        // Give user time to see the message before disconnect
        setTimeout(() => {
          targetSocket.disconnect();
        }, 2000);
      }
      
      // Notify other users
      socket.to(user.roomId).emit('user-kicked', {
        kickedUser: targetUser.nickname,
        hostNickname: user.nickname,
        reason: reason || 'No reason provided',
        timestamp: Date.now()
      });
      
    } catch (error) {
      console.error('Error in kick-user:', error);
      socket.emit('error', {
        type: 'KICK_ERROR',
        message: 'Error kicking user',
        details: error.message
      });
    }
  });

  // Mute user event (only host can mute others)
  socket.on('mute-user', (data) => {
    const { targetSocketId } = data;
    const user = userMap.get(socket.id);
    
    if (!user || !targetSocketId) return;
    
    const room = rooms.get(user.roomId);
    if (!room || room.host !== socket.id) return; // Only host can mute
    
    // Send mute command to target user
    socket.to(targetSocketId).emit('force-mute');
  });

  // Enhanced ping/pong with connection quality metrics
  socket.on('ping', (data) => {
    const user = userMap.get(socket.id);
    const responseData = {
      ...data,
      serverTimestamp: Date.now(),
      roomId: user?.roomId,
      serverUptime: process.uptime(),
      roomUserCount: user ? (rooms.get(user.roomId)?.users.size || 0) : 0
    };
    
    socket.emit('pong', responseData);
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    const user = userMap.get(socket.id);
    
    if (user) {
      const { roomId } = user;
      const room = rooms.get(roomId);
      
      if (room) {
        // Remove user from room
        room.users.delete(socket.id);
        
        // If user was host, transfer host rights to next user
        if (room.host === socket.id && room.users.size > 0) {
          const newHost = Array.from(room.users)[0];
          room.host = newHost;
          
          // Notify new host
          socket.to(newHost).emit('host-transferred');
          
          // Notify all users about new host
          socket.to(roomId).emit('new-host', { hostId: newHost });
        }
        
        // If room is empty, delete it
        if (room.users.size === 0) {
          rooms.delete(roomId);
          console.log(`Deleted empty room: ${roomId}`);
        } else {
          // Notify remaining users about user leaving
          socket.to(roomId).emit('user-left', { socketId: socket.id });
        }
      }
      
      // Remove user from userMap
      userMap.delete(socket.id);
    }
    
    console.log(`User disconnected: ${socket.id}`);
  });
});

// FIXED: Added periodic cleanup for rate limiting data to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  
  // Clean up old rate limiting data
  for (const [ip, timestamps] of connections.entries()) {
    const recentConnections = timestamps.filter(time => now - time < RATE_WINDOW);
    if (recentConnections.length === 0) {
      connections.delete(ip);
    } else {
      connections.set(ip, recentConnections);
    }
  }
  
  // Clean up old rooms
  const ROOM_TIMEOUT = 24 * 60 * 60 * 1000; // 24 hours
  for (const [roomId, room] of rooms.entries()) {
    if (room.users.size === 0 && (now - room.created) > ROOM_TIMEOUT) {
      rooms.delete(roomId);
      console.log(`Cleaned up old room: ${roomId}`);
    }
  }
}, 60 * 60 * 1000); // Run every hour

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Zloer Communication Server running on port ${PORT}`);
  console.log(`📱 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🌐 Domain: ${process.env.DOMAIN || 'localhost'}`);
  console.log(`🔄 TURN Server: ${TURN_SERVER_IP}`);
  // FIXED: Using static credentials
  console.log(`🔐 TURN Credentials: Static (nearsnap) ✅`);
  if (process.env.NODE_ENV === 'production') {
    console.log(`🔒 Production mode with enhanced security`);
  }
});
