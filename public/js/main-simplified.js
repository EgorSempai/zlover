// Zloer Communication - SIMPLIFIED VERSION (No WebRTC P2P)
// This version focuses on basic functionality: nicknames, chat, and user presence

// Enhanced Socket Manager Class
class SocketManager {
  constructor() {
    this.socket = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;
  }

  connect() {
    this.socket = io({
      timeout: 10000,
      forceNew: true,
      transports: ['websocket', 'polling']
    });
    this.setupEventListeners();
    return this.socket;
  }

  setupEventListeners() {
    this.socket.on('connect', () => {
      this.isConnected = true;
      this.reconnectAttempts = 0;
      console.log('✅ Connected to server');
      NotificationManager.show('Connected to server', 'success');
    });

    this.socket.on('disconnect', (reason) => {
      this.isConnected = false;
      console.log('❌ Disconnected from server:', reason);
      NotificationManager.show('Connection lost', 'warning');
    });

    this.socket.on('connect_error', (error) => {
      console.error('Connection error:', error);
      NotificationManager.show(`Connection error: ${error.message}`, 'error');
    });

    this.socket.on('error', (error) => {
      console.error('Socket error:', error);
      NotificationManager.show(`Error: ${error.message || error}`, 'error');
    });

    this.socket.on('kicked', (data) => {
      const message = data?.reason || 'You have been kicked from the room';
      const hostName = data?.hostNickname || 'Room host';
      NotificationManager.show(`${message} by ${hostName}`, 'error');
      setTimeout(() => window.location.reload(), 3000);
    });
  }

  emit(event, data) {
    if (this.socket && this.isConnected) {
      this.socket.emit(event, data);
    } else {
      console.warn(`Cannot emit ${event}: socket not connected`);
      NotificationManager.show('Not connected to server', 'warning');
    }
  }

  on(event, callback) {
    if (this.socket) {
      this.socket.on(event, callback);
    }
  }
}

// SIMPLIFIED Media Manager (No WebRTC)
class MediaManager {
  constructor() {
    this.localStream = null;
    this.userInfo = new Map(); // socketId -> { nickname, isHost, etc. }
    this.isAudioMuted = false;
    this.isVideoMuted = false;
    console.log('🚀 MediaManager initialized in SIMPLIFIED mode (No WebRTC)');
  }

  // Store and retrieve user information
  storeUserInfo(socketId, userInfo) {
    this.userInfo.set(socketId, userInfo);
    console.log(`📝 Stored user info for ${socketId}:`, userInfo);
    
    // Create placeholder for remote user immediately
    if (socketId !== 'local') {
      this.createRemoteUserPlaceholder(socketId, userInfo.nickname);
    }
  }

  getStoredUserInfo(socketId) {
    return this.userInfo.get(socketId);
  }

  // Create placeholder for remote user (no real video/audio)
  createRemoteUserPlaceholder(socketId, nickname) {
    console.log(`👤 Creating placeholder for remote user: ${socketId} (${nickname})`);
    
    // Create a simple placeholder stream (static image)
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');
    
    // Draw placeholder
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = '32px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(`${nickname}`, canvas.width/2, canvas.height/2 - 30);
    ctx.font = '18px Arial';
    ctx.fillStyle = '#888';
    ctx.fillText('(Camera Off)', canvas.width/2, canvas.height/2 + 10);
    ctx.fillText('SIMPLIFIED MODE', canvas.width/2, canvas.height/2 + 40);
    
    const stream = canvas.captureStream(1); // 1 FPS
    
    // Add to UI immediately
    uiManager.addRemoteVideo(socketId, stream);
    
    // Update nickname after a short delay
    setTimeout(() => {
      uiManager.updateUserName(socketId, nickname);
    }, 100);
  }

  // Initialize local media
  async initializeMedia() {
    try {
      console.log('🎤 Initializing media (SIMPLIFIED mode)...');
      
      // Request media with both audio and video
      const constraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: {
          width: { ideal: 1280, max: 1920 },
          height: { ideal: 720, max: 1080 },
          frameRate: { ideal: 30, max: 30 }
        }
      };
      
      console.log('🎤 Requesting media with constraints:', constraints);
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      
      // Add local video to UI
      uiManager.addLocalVideo(this.localStream);
      
      // Set initial states
      this.isVideoMuted = false;
      this.isAudioMuted = false;
      uiManager.updateVideoButton(this.isVideoMuted);
      uiManager.updateMuteButton(this.isAudioMuted);
      
      console.log('✅ Media initialized successfully (SIMPLIFIED mode)');
      return true;
      
    } catch (error) {
      console.error('Error accessing media devices:', error);
      
      // Try with audio only as fallback
      try {
        console.log('🎤 Fallback: Trying audio only...');
        this.localStream = await navigator.mediaDevices.getUserMedia({
          video: false,
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
        
        uiManager.addLocalVideo(this.localStream);
        this.isVideoMuted = true;
        this.isAudioMuted = false;
        uiManager.updateVideoButton(this.isVideoMuted);
        uiManager.updateMuteButton(this.isAudioMuted);
        NotificationManager.show('Camera not available, using audio only', 'warning');
        console.log('✅ Media initialized with audio only');
        return true;
      } catch (basicError) {
        console.error('Error accessing audio:', basicError);
        NotificationManager.show('No microphone access. Please check permissions.', 'error');
        return false;
      }
    }
  }

  // Simple stubs for WebRTC methods (no actual P2P)
  createOffer(socketId) {
    console.log(`📞 SIMPLIFIED: Skipping WebRTC offer creation for ${socketId}`);
    const userInfo = this.getStoredUserInfo(socketId);
    if (userInfo) {
      this.createRemoteUserPlaceholder(socketId, userInfo.nickname);
    }
  }

  handleOffer(socketId, offer) {
    console.log(`📥 SIMPLIFIED: Skipping WebRTC offer handling from ${socketId}`);
  }

  handleAnswer(socketId, answer) {
    console.log(`📥 SIMPLIFIED: Skipping WebRTC answer handling from ${socketId}`);
  }

  handleIceCandidate(socketId, candidate) {
    console.log(`🧊 SIMPLIFIED: Skipping ICE candidate handling from ${socketId}`);
  }

  removePeer(socketId) {
    console.log(`🧹 SIMPLIFIED: Removing user ${socketId}`);
    this.userInfo.delete(socketId);
    uiManager.removeVideo(socketId);
    console.log(`✅ Cleaned up user ${socketId}`);
  }

  toggleAudio() {
    if (this.localStream) {
      const audioTrack = this.localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        this.isAudioMuted = !audioTrack.enabled;
        uiManager.updateMuteButton(this.isAudioMuted);
        return !this.isAudioMuted;
      }
    }
    return false;
  }

  toggleVideo() {
    if (this.localStream) {
      const videoTrack = this.localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        this.isVideoMuted = !videoTrack.enabled;
        uiManager.updateVideoButton(this.isVideoMuted);
        return !this.isVideoMuted;
      }
    }
    return false;
  }

  cleanup() {
    console.log('🧹 Starting cleanup...');
    
    this.userInfo.clear();

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        try {
          track.stop();
          console.log(`✅ Stopped ${track.kind} track`);
        } catch (error) {
          console.error(`❌ Error stopping ${track.kind} track:`, error);
        }
      });
      this.localStream = null;
    }
    
    console.log('🧹 Cleanup completed');
  }
}

// UI Manager Class
class UIManager {
  constructor() {
    this.currentLanguage = 'en';
    this.isHost = false;
    this.roomId = '';
    this.nickname = '';
    this.userCount = 0;
    this.layoutMode = 'grid';
    this.activeSpeaker = null;
    
    this.translations = {
      en: {
        nickname: 'Enter your nickname',
        roomId: 'Room ID (leave empty for new room)',
        joinRoom: '🚀 Join Room',
        joinedSession: 'joined the gaming session!',
        firstGamer: "Zloer: You're the first gamer here! Invite your friends!",
        foundGamers: 'Zloer found',
        gamersInRoom: 'gamer(s) in the room!',
        connected: 'Zloer: Connected to server successfully!'
      },
      ru: {
        nickname: 'Введите ваш никнейм',
        roomId: 'ID комнаты (оставьте пустым для новой комнаты)',
        joinRoom: '🚀 Войти в комнату',
        joinedSession: 'присоединился к игровой сессии!',
        firstGamer: 'Злоер: Вы первый игрок здесь! Пригласите друзей!',
        foundGamers: 'Злоер нашёл',
        gamersInRoom: 'игрок(ов) в комнате!',
        connected: 'Злоер: Успешно подключен к серверу!'
      }
    };
  }

  t(key) {
    return this.translations[this.currentLanguage][key] || key;
  }

  setLanguage(lang) {
    this.currentLanguage = lang;
    this.updateTexts();
  }

  updateTexts() {
    const nicknameInput = document.getElementById('nickname-input');
    const roomInput = document.getElementById('room-input');
    const joinBtn = document.getElementById('join-btn');

    if (nicknameInput) nicknameInput.placeholder = this.t('nickname');
    if (roomInput) roomInput.placeholder = this.t('roomId');
    if (joinBtn) joinBtn.textContent = this.t('joinRoom');
  }

  initialize() {
    this.setupEventListeners();
    this.updateTexts();
  }

  setupEventListeners() {
    // Join form
    const joinBtn = document.getElementById('join-btn');
    const nicknameInput = document.getElementById('nickname-input');
    const roomInput = document.getElementById('room-input');

    joinBtn.addEventListener('click', () => this.handleJoin());
    
    nicknameInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.handleJoin();
    });
    
    roomInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.handleJoin();
    });

    // Control buttons
    document.getElementById('mute-btn').addEventListener('click', () => {
      mediaManager.toggleAudio();
    });

    document.getElementById('video-btn').addEventListener('click', () => {
      mediaManager.toggleVideo();
    });

    document.getElementById('chat-send-btn').addEventListener('click', () => {
      this.sendChatMessage();
    });

    document.getElementById('chat-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.sendChatMessage();
    });
  }

  async handleJoin() {
    const nickname = document.getElementById('nickname-input').value.trim();
    const roomId = document.getElementById('room-input').value.trim() || this.generateRoomId();

    if (!nickname) {
      NotificationManager.show('Please enter a nickname', 'error');
      return;
    }

    console.log('Starting join process...', { nickname, roomId });
    this.nickname = nickname;
    this.roomId = roomId;

    // Update URL
    const roomUrl = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
    window.history.replaceState({}, '', roomUrl);

    // Show loading
    document.getElementById('loading-screen').style.display = 'flex';

    try {
      // Initialize media
      console.log('Initializing media...');
      const mediaInitialized = await mediaManager.initializeMedia();
      if (!mediaInitialized) {
        console.error('Media initialization failed');
        document.getElementById('loading-screen').style.display = 'none';
        return;
      }
      console.log('Media initialized successfully');

      // Connect to server
      console.log('Connecting to server...');
      socketManager.connect();
      
      // Wait for connection and join room
      setTimeout(() => {
        console.log('Joining room...', { roomId, nickname });
        socketManager.emit('join-room', { roomId, nickname });
      }, 1000);

      // Show main app
      setTimeout(() => {
        console.log('Showing main app...');
        document.getElementById('loading-screen').style.display = 'none';
        document.getElementById('join-screen').style.display = 'none';
        document.getElementById('app').classList.remove('hidden');
        
        // Update UI
        document.getElementById('room-id-display').textContent = `Room: ${roomId}`;
      }, 2000);

    } catch (error) {
      console.error('Error during join process:', error);
      document.getElementById('loading-screen').style.display = 'none';
      NotificationManager.show('Failed to join room', 'error');
    }
  }

  generateRoomId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  addLocalVideo(stream) {
    console.log('🎥 Adding local video');
    const videoGrid = document.getElementById('video-grid');
    
    // Remove existing container if present
    const existingContainer = document.getElementById('local-container');
    if (existingContainer) existingContainer.remove();
    
    const videoContainer = document.createElement('div');
    videoContainer.className = 'video-container';
    videoContainer.id = 'local-container';
    videoContainer.dataset.socketId = 'local';
    
    const video = document.createElement('video');
    video.id = 'local-video';
    video.srcObject = stream;
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true; // Prevent echo
    video.volume = 0;
    
    const overlay = document.createElement('div');
    overlay.className = 'video-overlay';
    
    const nameSpan = document.createElement('span');
    nameSpan.className = 'user-name';
    nameSpan.id = 'name-local';
    nameSpan.textContent = this.nickname ? `${this.nickname} (You)` : 'You';
    
    const controlsDiv = document.createElement('div');
    controlsDiv.className = 'video-controls'; 
    
    const hostBadge = document.createElement('span');
    hostBadge.className = 'host-badge';
    hostBadge.textContent = '👑';
    hostBadge.style.display = this.isHost ? 'inline' : 'none';
    hostBadge.title = 'Owner';
    
    controlsDiv.appendChild(hostBadge);
    overlay.appendChild(nameSpan);
    overlay.appendChild(controlsDiv);
    
    videoContainer.appendChild(video);
    videoContainer.appendChild(overlay);
    
    // Prepend to show local video first
    videoGrid.prepend(videoContainer);
    
    this.updateLayout();
    console.log('✅ Local video added with nickname:', this.nickname);
  }

  addRemoteVideo(socketId, stream) {
    console.log(`🎥 Adding remote video for ${socketId}`);
    const videoGrid = document.getElementById('video-grid');
    
    // Remove existing video if any
    this.removeVideo(socketId);
    
    const videoContainer = document.createElement('div');
    videoContainer.className = 'video-container';
    videoContainer.id = `video-${socketId}`;
    videoContainer.dataset.socketId = socketId;
    
    const video = document.createElement('video');
    video.id = `remote-video-${socketId}`;
    video.srcObject = stream;
    video.autoplay = true;
    video.playsInline = true;
    video.muted = false;
    video.volume = 1.0;
    
    const overlay = document.createElement('div');
    overlay.className = 'video-overlay';
    overlay.innerHTML = `
      <span class="user-name" id="name-${socketId}">User</span>
      <div class="video-controls">
        <span class="host-badge" id="host-${socketId}" style="display: none" title="Host">👑</span>
        <button class="kick-btn" id="kick-${socketId}" style="display: none" title="Kick User">❌</button>
      </div>
    `;
    
    videoContainer.appendChild(video);
    videoContainer.appendChild(overlay);
    videoGrid.appendChild(videoContainer);
    
    this.updateLayout();
    console.log(`✅ Remote video added for ${socketId}`);
  }

  removeVideo(socketId) {
    const videoContainer = document.getElementById(`video-${socketId}`);
    if (videoContainer) {
      videoContainer.remove();
      this.updateLayout();
      console.log(`✅ Removed video for ${socketId}`);
    }
  }

  updateUserName(socketId, nickname) {
    console.log(`📝 Updating name for ${socketId}: ${nickname}`);
    const nameElement = document.getElementById(`name-${socketId}`);
    if (nameElement) {
      nameElement.textContent = socketId === 'local' ? `${nickname} (You)` : nickname;
      console.log(`✅ Name updated for ${socketId}: ${nickname}`);
    } else {
      console.warn(`❌ Name element not found for ${socketId}`);
    }
  }

  setHost(isHost) {
    this.isHost = isHost;
    console.log(`👑 Host status: ${isHost}`);
  }

  updateUserCount(count) {
    this.userCount = count;
    const userCountElement = document.getElementById('user-count');
    if (userCountElement) {
      userCountElement.textContent = `${count} users`;
    }
  }

  updateLayout() {
    const videoGrid = document.getElementById('video-grid');
    const containers = videoGrid.querySelectorAll('.video-container');
    
    // Simple grid layout
    videoGrid.classList.add('grid-layout');
    containers.forEach(container => {
      container.classList.add('grid-item');
    });
  }

  updateMuteButton(isMuted) {
    const muteBtn = document.getElementById('mute-btn');
    if (muteBtn) {
      muteBtn.textContent = isMuted ? '🔇' : '🎤';
      muteBtn.classList.toggle('muted', isMuted);
    }
  }

  updateVideoButton(isVideoOff) {
    const videoBtn = document.getElementById('video-btn');
    if (videoBtn) {
      videoBtn.textContent = isVideoOff ? '📹' : '🎥';
      videoBtn.classList.toggle('video-off', isVideoOff);
    }
  }

  sendChatMessage() {
    const chatInput = document.getElementById('chat-input');
    const message = chatInput.value.trim();
    
    if (message) {
      socketManager.emit('chat-message', { message });
      chatInput.value = '';
    }
  }

  addChatMessage(data) {
    const chatMessages = document.getElementById('chat-messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'chat-message';
    
    const timestamp = new Date(data.timestamp).toLocaleTimeString();
    messageDiv.innerHTML = `
      <div class="chat-message-header">
        <span class="chat-nickname">${data.nickname}</span>
        <span class="chat-timestamp">${timestamp}</span>
      </div>
      <div class="chat-message-content">${data.message}</div>
    `;
    
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}

// Notification Manager
class NotificationManager {
  static show(message, type = 'info', duration = 5000) {
    console.log(`[${type.toUpperCase()}] ${message}`);
    
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    // Auto remove
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, duration);
  }
}

// Global instances
const socketManager = new SocketManager();
const mediaManager = new MediaManager();
const uiManager = new UIManager();

// Socket event handlers
const setupSocketEvents = () => {
  socketManager.on('existing-users', (data) => {
    console.log('✅ Existing users received:', data);
    
    uiManager.setHost(data.isHost);
    uiManager.updateUserCount(data.users.length + 1);
    
    if (data.users.length > 0) {
      NotificationManager.show(`🎮 ${uiManager.t('foundGamers')} ${data.users.length} ${uiManager.t('gamersInRoom')}`, 'success');
    } else {
      NotificationManager.show(`🎮 ${uiManager.t('firstGamer')}`, 'info');
    }
    
    // Handle existing users
    data.users.forEach(user => {
      console.log('👤 Processing existing user:', user.socketId, 'nickname:', user.nickname);
      mediaManager.storeUserInfo(user.socketId, { nickname: user.nickname });
      mediaManager.createOffer(user.socketId);
    });
  });
  
  socketManager.on('user-joined', (data) => {
    console.log('👋 User joined:', data);
    
    mediaManager.storeUserInfo(data.socketId, { nickname: data.nickname });
    uiManager.updateUserCount(uiManager.userCount + 1);
    NotificationManager.show(`🎮 ${data.nickname} ${uiManager.t('joinedSession')}`, 'success');
  });
  
  socketManager.on('user-left', (data) => {
    console.log('👋 User left:', data);
    mediaManager.removePeer(data.socketId);
    uiManager.updateUserCount(uiManager.userCount - 1);
  });
  
  socketManager.on('room-joined', (data) => {
    console.log('🏠 Room joined successfully:', data);
    uiManager.setHost(data.isHost);
    uiManager.updateUserCount(data.userCount);
    
    // Update local user nickname
    if (data.nickname) {
      uiManager.updateUserName('local', data.nickname);
    }
  });
  
  socketManager.on('signal', async (data) => {
    console.log('📡 Signal received (SIMPLIFIED - ignoring):', data.signal.type, 'from:', data.from);
    // In simplified mode, we ignore all WebRTC signals
  });
  
  socketManager.on('chat-message', (data) => {
    console.log('💬 Chat message received:', data);
    uiManager.addChatMessage(data);
  });
};

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
  console.log('🚀 Zloer Communication - SIMPLIFIED MODE');
  console.log('📝 WebRTC P2P disabled - using placeholders only');
  
  // Show simplified mode notification
  setTimeout(() => {
    NotificationManager.show('🔧 Running in SIMPLIFIED mode - WebRTC P2P disabled. You can see nicknames and chat, but no real video/audio streaming.', 'info', 10000);
  }, 2000);
  
  uiManager.initialize();
  setupSocketEvents();
  
  // Check for room ID in URL
  const urlParams = new URLSearchParams(window.location.search);
  const roomId = urlParams.get('room');
  if (roomId) {
    document.getElementById('room-input').value = roomId;
  }
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  mediaManager.cleanup();
});