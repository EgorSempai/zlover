// Zloer Communication - Main Application
// Connect. Play. Zloer

// Enhanced Socket Manager Class with comprehensive error handling
class SocketManager {
  constructor() {
    this.socket = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;
    this.connectionQuality = 'unknown';
    this.lastPingTime = 0;
    this.serverLatency = 0;
  }

  connect() {
    this.socket = io({
      timeout: 10000,
      forceNew: true,
      transports: ['websocket', 'polling']
    });
    this.setupEventListeners();
    this.startConnectionMonitoring();
    return this.socket;
  }

  setupEventListeners() {
    this.socket.on('connect', () => {
      this.isConnected = true;
      this.reconnectAttempts = 0;
      console.log('✅ Connected to server');
      NotificationManager.show('Connected to server', 'success');
      this.sendConnectionDiagnostic();
    });

    this.socket.on('disconnect', (reason) => {
      this.isConnected = false;
      console.log('❌ Disconnected from server:', reason);
      
      if (reason === 'io server disconnect') {
        // Server disconnected us, don't reconnect automatically
        NotificationManager.show('Disconnected by server', 'error');
      } else {
        // Network issue, attempt reconnection
        NotificationManager.show('Connection lost, attempting to reconnect...', 'warning');
        this.attemptReconnection();
      }
    });

    // FIXED: Enhanced connect_error handling for WebRTC signaling
    this.socket.on('connect_error', (error) => {
      console.error('Connection error:', error);
      NotificationManager.show(`Connection error: ${error.message}`, 'error');
      
      // Clean up WebRTC connections on socket error
      if (rtcManager) {
        rtcManager.cleanup();
      }
      
      this.attemptReconnection();
    });

    // Enhanced error handling
    this.socket.on('error', (error) => {
      console.error('Socket error:', error);
      
      if (typeof error === 'object' && error.type) {
        this.handleStructuredError(error);
      } else {
        NotificationManager.show(`Error: ${error}`, 'error');
      }
    });

    this.socket.on('kicked', (data) => {
      const message = data?.reason || 'You have been kicked from the room';
      const hostName = data?.hostNickname || 'Room host';
      
      NotificationManager.show(`${message} by ${hostName}`, 'error');
      setTimeout(() => {
        window.location.reload();
      }, 3000);
    });

    this.socket.on('force-mute', () => {
      rtcManager.muteAudio();
      NotificationManager.show('You have been muted by the host', 'info');
    });

    // Connection quality monitoring
    this.socket.on('peer-quality-update', (data) => {
      console.log(`📊 Peer quality update:`, data);
      // Could update UI to show peer connection quality
    });

    this.socket.on('pong', (data) => {
      const now = Date.now();
      this.serverLatency = now - this.lastPingTime;
      console.log(`🏓 Server latency: ${this.serverLatency}ms`);
      
      // Update connection quality based on latency
      if (this.serverLatency < 100) {
        this.connectionQuality = 'excellent';
      } else if (this.serverLatency < 200) {
        this.connectionQuality = 'good';
      } else if (this.serverLatency < 500) {
        this.connectionQuality = 'fair';
      } else {
        this.connectionQuality = 'poor';
      }
    });
  }

  handleStructuredError(error) {
    switch (error.type) {
      case 'RATE_LIMIT':
        NotificationManager.show(`Rate limit exceeded. Try again in ${error.retryAfter} seconds.`, 'error');
        break;
      case 'VALIDATION_ERROR':
        NotificationManager.show(`Validation error: ${error.details?.join(', ') || error.message}`, 'error');
        break;
      case 'ROOM_FULL':
        NotificationManager.show(`Room is full (${error.currentUsers}/${error.maxUsers} users)`, 'error');
        break;
      case 'NICKNAME_TAKEN':
        NotificationManager.show(`Nickname taken. Try: ${error.suggestion}`, 'error');
        break;
      case 'UNAUTHORIZED':
        NotificationManager.show('Unauthorized action', 'error');
        break;
      default:
        NotificationManager.show(`Error: ${error.message}`, 'error');
    }
  }

  attemptReconnection() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      NotificationManager.show('Failed to reconnect. Please refresh the page.', 'error');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1); // Exponential backoff
    
    console.log(`Attempting reconnection ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`);
    
    setTimeout(() => {
      if (!this.isConnected) {
        this.socket.connect();
      }
    }, delay);
  }

  startConnectionMonitoring() {
    // Ping server every 30 seconds
    setInterval(() => {
      if (this.isConnected) {
        this.lastPingTime = Date.now();
        this.socket.emit('ping', { timestamp: this.lastPingTime });
      }
    }, 30000);

    // Send connection quality updates every 60 seconds
    setInterval(() => {
      if (this.isConnected && rtcManager) {
        this.sendConnectionQuality();
      }
    }, 60000);
  }

  sendConnectionDiagnostic() {
    const diagnosticData = {
      userAgent: navigator.userAgent,
      language: navigator.language,
      platform: navigator.platform,
      cookieEnabled: navigator.cookieEnabled,
      onLine: navigator.onLine,
      connection: navigator.connection ? {
        effectiveType: navigator.connection.effectiveType,
        downlink: navigator.connection.downlink,
        rtt: navigator.connection.rtt
      } : null,
      timestamp: Date.now()
    };

    this.socket.emit('connection-diagnostic', diagnosticData);
  }

  sendConnectionQuality() {
    const qualityData = {
      quality: this.connectionQuality,
      latency: this.serverLatency,
      webrtcStats: rtcManager.getConnectionStats(),
      timestamp: Date.now()
    };

    this.socket.emit('connection-quality', qualityData);
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

// Enhanced WebRTC Manager with Full P2P Support and High-Quality Codecs
class RTCManager {
  constructor() {
    this.localStream = null;
    this.remoteStreams = new Map(); // socketId -> MediaStream
    this.userInfo = new Map(); // socketId -> { nickname, isHost, etc. }
    this.peers = new Map(); // socketId -> RTCPeerConnection
    this.pendingCandidates = new Map(); // socketId -> [candidates]
    this.isAudioMuted = false;
    this.isVideoMuted = false;
    this.isScreenSharing = false;
    this.audioContext = null;
    this.analyser = null;
    this.audioVisualizer = null;
    this.activeSpeaker = null;
    this.availableDevices = { audioInputs: [], videoInputs: [] };
    this.initialized = false;
    this.connectionErrors = [];
    this.statsInterval = null;
    this.pongListenerSet = false;
    
    // ICE servers configuration (will be updated from server)
    this.iceServers = [
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    ];
    
    // ENHANCED: High-quality codec settings for better audio
    this.currentSettings = {
      audioCodec: 'opus',
      videoCodec: 'vp9',
      audioBitrate: 256000, // Increased from 128k to 256k for better quality
      videoBitrate: 2000000,
      audioChannels: 2,
      sampleRate: 48000,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      stereoEnabled: true,
      dtxEnabled: false, // Disable DTX for better quality
      selectedMicrophone: '',
      selectedCamera: '',
      videoResolution: '1280x720',
      videoFramerate: 30,
      audioVisualizerEnabled: true,
      // ENHANCED: Advanced audio settings for high quality
      opusComplexity: 10, // Maximum complexity for best quality
      opusFec: true, // Forward Error Correction
      opusUseDtx: false, // Disable DTX for consistent quality
      opusMaxPlaybackRate: 48000
    };
    
    console.log('🚀 RTCManager initialized with FULL WebRTC P2P support and enhanced codecs');
    this.initialized = true;
  }

  // Store and retrieve user information
  storeUserInfo(socketId, userInfo) {
    if (!this.initialized) {
      console.warn('⚠️ RTCManager not initialized yet, queuing user info storage');
      setTimeout(() => this.storeUserInfo(socketId, userInfo), 100);
      return;
    }
    
    this.userInfo.set(socketId, userInfo);
    console.log(`📝 Stored user info for ${socketId}:`, userInfo);
    
    // Update nickname in UI when user info is stored
    setTimeout(() => {
      if (uiManager && uiManager.updateUserName) {
        uiManager.updateUserName(socketId, userInfo.nickname);
      }
    }, 200);
  }

  getStoredUserInfo(socketId) {
    return this.userInfo.get(socketId);
  }

  // Full WebRTC media initialization
  async initializeMedia() {
    try {
      console.log('🎤 Initializing media with timeout protection...');
      
      // Load saved settings
      this.loadSettings();
      
      // Enumerate devices first
      await this.enumerateDevices();
      
      // Add timeout to prevent hanging
      const mediaPromise = this.requestMediaWithFallback();
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Media access timeout')), 10000);
      });
      
      this.localStream = await Promise.race([mediaPromise, timeoutPromise]);
      
      // Initialize audio visualizer
      await this.initializeAudioVisualizer();
      
      // Add local video to UI
      uiManager.addLocalVideo(this.localStream);
      
      // Set initial states - CAMERA OFF by default, audio on
      this.isVideoMuted = true;  // Camera starts OFF
      this.isAudioMuted = false; // Audio starts ON
      uiManager.updateVideoButton(this.isVideoMuted);
      uiManager.updateMuteButton(this.isAudioMuted);
      uiManager.updateLocalVideoDisplay(this.isVideoMuted); // Show camera off overlay
      
      console.log('✅ Media initialized successfully - Camera OFF by default');
      return true;
      
    } catch (error) {
      console.error('Error accessing media devices:', error);
      
      // Create dummy stream as final fallback
      console.log('🎤 Creating dummy stream for fallback...');
      this.localStream = this.createDummyStream();
      
      uiManager.addLocalVideo(this.localStream);
      this.isVideoMuted = true;
      this.isAudioMuted = true;
      uiManager.updateVideoButton(this.isVideoMuted);
      uiManager.updateMuteButton(this.isAudioMuted);
      NotificationManager.show('Using fallback mode without camera/microphone', 'warning');
      console.log('✅ Media initialized with dummy stream');
      return true;
    }
  }

  async requestMediaWithFallback() {
    // Start with AUDIO ONLY - camera will be enabled manually by user
    try {
      const constraints = {
        audio: {
          echoCancellation: this.currentSettings.echoCancellation,
          noiseSuppression: this.currentSettings.noiseSuppression,
          autoGainControl: this.currentSettings.autoGainControl,
          sampleRate: { ideal: this.currentSettings.sampleRate, min: 44100 },
          channelCount: { ideal: this.currentSettings.audioChannels },
          // ENHANCED: Advanced audio constraints for better quality
          latency: { ideal: 0.01 }, // Low latency for real-time communication
          volume: { ideal: 1.0 },
          deviceId: this.currentSettings.selectedMicrophone ? 
            { exact: this.currentSettings.selectedMicrophone } : undefined
        },
        video: false // Start with camera OFF - user will enable manually
      };
      
      console.log('🎤 Requesting AUDIO ONLY (camera disabled by default):', constraints);
      return await navigator.mediaDevices.getUserMedia(constraints);
      
    } catch (error) {
      console.log('🎤 Fallback: Trying basic audio only...');
      
      // Try basic audio only
      try {
        return await navigator.mediaDevices.getUserMedia({
          video: false,
          audio: {
            echoCancellation: this.currentSettings.echoCancellation,
            noiseSuppression: this.currentSettings.noiseSuppression,
            autoGainControl: this.currentSettings.autoGainControl,
            sampleRate: { ideal: this.currentSettings.sampleRate, min: 44100 },
            channelCount: { ideal: this.currentSettings.audioChannels },
            latency: { ideal: 0.01 },
            volume: { ideal: 1.0 }
          }
        });
      } catch (audioError) {
        console.log('🎤 Fallback: Trying most basic audio...');
        
        // Final fallback with basic audio
        try {
          return await navigator.mediaDevices.getUserMedia({
            video: false,
            audio: true
          });
        } catch (basicError) {
          console.log('🎤 No media access, will use dummy stream');
          throw basicError;
        }
      }
    }
  }

  createDummyStream() {
    // Create a canvas with a camera-off placeholder
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');
    
    // Draw camera-off placeholder
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = '24px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('📷 CAMERA OFF', canvas.width/2, canvas.height/2 - 20);
    ctx.font = '16px Arial';
    ctx.fillStyle = '#888';
    ctx.fillText('Click camera button to enable', canvas.width/2, canvas.height/2 + 20);
    
    return canvas.captureStream(1); // 1 FPS
  }

  async enumerateDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      
      this.availableDevices.audioInputs = devices.filter(device => device.kind === 'audioinput');
      this.availableDevices.videoInputs = devices.filter(device => device.kind === 'videoinput');
      
      console.log('Available devices:', this.availableDevices);
      return this.availableDevices;
    } catch (error) {
      console.error('Error enumerating devices:', error);
      return { audioInputs: [], videoInputs: [] };
    }
  }

  loadSettings() {
    try {
      const savedSettings = localStorage.getItem('zloer-settings');
      if (savedSettings) {
        this.currentSettings = { ...this.currentSettings, ...JSON.parse(savedSettings) };
        console.log('Settings loaded:', this.currentSettings);
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  }

  async initializeAudioVisualizer() {
    try {
      // Create audio context and analyser
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      
      // Resume audio context if it's suspended (required by some browsers)
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      
      this.analyser = this.audioContext.createAnalyser();
      
      // Configure analyser for smooth visualization
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.8;
      
      // Connect audio stream to analyser
      const audioTracks = this.localStream.getAudioTracks();
      if (audioTracks.length > 0) {
        const source = this.audioContext.createMediaStreamSource(this.localStream);
        source.connect(this.analyser);
        
        console.log('✅ Audio visualizer initialized');
      }
    } catch (error) {
      console.error('Error initializing audio visualizer:', error);
      // Continue without visualizer if it fails
    }
  }

  // Device switching functionality
  async switchDevice(deviceType, deviceId) {
    console.log(`🔄 Switching ${deviceType} to device: ${deviceId}`);
    
    try {
      if (deviceType === 'microphone') {
        this.currentSettings.selectedMicrophone = deviceId;
      } else if (deviceType === 'camera') {
        this.currentSettings.selectedCamera = deviceId;
      }
      
      // Reinitialize media with new device
      await this.initializeMedia();
      
      // Update all peer connections with new stream
      if (this.localStream) {
        this.peers.forEach(async (pc, socketId) => {
          const senders = pc.getSenders();
          
          for (const sender of senders) {
            if (sender.track) {
              const newTrack = this.localStream.getTracks().find(
                track => track.kind === sender.track.kind
              );
              
              if (newTrack) {
                await sender.replaceTrack(newTrack);
                console.log(`✅ Replaced ${sender.track.kind} track for ${socketId}`);
              }
            }
          }
        });
      }
      
      NotificationManager.show(`${deviceType} switched successfully`, 'success');
      return true;
      
    } catch (error) {
      console.error(`Error switching ${deviceType}:`, error);
      NotificationManager.show(`Failed to switch ${deviceType}`, 'error');
      return false;
    }
  }

  // Device testing functionality
  async testDevice(deviceType, deviceId) {
    console.log(`🧪 Testing ${deviceType}: ${deviceId}`);
    
    try {
      const constraints = {};
      
      if (deviceType === 'microphone') {
        constraints.audio = {
          deviceId: { exact: deviceId },
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        };
      } else if (deviceType === 'camera') {
        constraints.video = {
          deviceId: { exact: deviceId },
          width: { ideal: 640 },
          height: { ideal: 480 }
        };
      }
      
      const testStream = await navigator.mediaDevices.getUserMedia(constraints);
      
      // Test successful, stop the test stream
      testStream.getTracks().forEach(track => track.stop());
      
      NotificationManager.show(`${deviceType} test successful`, 'success');
      return true;
      
    } catch (error) {
      console.error(`Error testing ${deviceType}:`, error);
      NotificationManager.show(`${deviceType} test failed: ${error.message}`, 'error');
      return false;
    }
  }

  async initializeAudioVisualizer() {
    try {
      // Create audio context and analyser
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      
      // Resume audio context if it's suspended (required by some browsers)
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      
      this.analyser = this.audioContext.createAnalyser();
      
      // Configure analyser for smooth visualization
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.8;
      
      // Connect audio stream to analyser
      const audioTracks = this.localStream.getAudioTracks();
      if (audioTracks.length > 0) {
        const source = this.audioContext.createMediaStreamSource(this.localStream);
        source.connect(this.analyser);
        
        // Start visualization
        this.startAudioVisualization();
      }
    } catch (error) {
      console.error('Error initializing audio visualizer:', error);
      // Continue without visualizer if it fails
    }
  }

  startAudioVisualization() {
    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    const visualize = () => {
      if (!this.analyser) return;
      
      requestAnimationFrame(visualize);
      this.analyser.getByteFrequencyData(dataArray);
      
      // Calculate average volume
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const average = sum / bufferLength;
      
      // Update visualizer
      uiManager.updateAudioVisualizer(average, dataArray);
      
      // Detect active speaker
      if (average > 30) { // Threshold for speaking
        this.activeSpeaker = 'local';
        uiManager.setActiveSpeaker('local');
      }
    };
    
    visualize();
  }

  // Update ICE servers configuration from server
  updateIceServers(iceServers) {
    // FIXED: Add initialization check
    if (!this.initialized) {
      console.warn('⚠️ RTCManager not initialized yet, queuing ICE servers update');
      setTimeout(() => this.updateIceServers(iceServers), 100);
      return;
    }
    
    if (iceServers && Array.isArray(iceServers)) {
      this.iceServers = iceServers;
      console.log('🔄 Updated ICE servers configuration:', iceServers);
      
      // Log TURN server details for debugging
      iceServers.forEach((server, index) => {
        if (server.urls && (server.urls.includes('turn:') || server.urls.includes('turns:'))) {
          console.log(`🔄 TURN Server ${index + 1}:`, {
            url: server.urls,
            username: server.username,
            hasCredential: !!server.credential,
            credentialLength: server.credential ? server.credential.length : 0
          });
        }
      });
    } else {
      console.warn('⚠️ Invalid ICE servers received, keeping current configuration');
    }
  }

  // ENHANCED: Full WebRTC peer connection creation with high-quality codecs
  async createOffer(socketId) {
    console.log(`📞 Creating WebRTC offer for ${socketId}`);
    const pc = this.createPeerConnection(socketId);
    
    try {
      // Ensure local stream is available
      if (!this.localStream) {
        console.error(`❌ No local stream available when creating offer for ${socketId}`);
        return;
      }
      
      console.log(`🎥 Local stream tracks for ${socketId}:`, this.localStream.getTracks().map(t => `${t.kind}: ${t.enabled}`));
      
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      
      // ENHANCED: Apply high-quality codec settings to SDP
      offer.sdp = this.enhanceAudioSDP(offer.sdp);
      offer.sdp = this.enhanceVideoSDP(offer.sdp);
      
      await pc.setLocalDescription(offer);
      
      console.log(`📤 Sending enhanced offer to ${socketId}`);
      socketManager.emit('signal', {
        to: socketId,
        signal: {
          type: 'offer',
          offer: offer
        }
      });
    } catch (error) {
      console.error(`❌ Error creating offer for ${socketId}:`, error);
      this.removePeer(socketId);
    }
  }

  async handleOffer(socketId, offer) {
    console.log(`📥 Handling WebRTC offer from ${socketId}`);
    const pc = this.createPeerConnection(socketId);
    
    try {
      // Ensure local stream is available
      if (!this.localStream) {
        console.error(`❌ No local stream available when handling offer from ${socketId}`);
        return;
      }
      
      console.log(`🎥 Local stream tracks for ${socketId}:`, this.localStream.getTracks().map(t => `${t.kind}: ${t.enabled}`));
      
      // ENHANCED: Apply codec enhancements to incoming offer
      offer.sdp = this.enhanceAudioSDP(offer.sdp);
      offer.sdp = this.enhanceVideoSDP(offer.sdp);
      
      await pc.setRemoteDescription(offer);
      
      // Process pending candidates after setting remote description
      this.processPendingCandidates(socketId);
      
      const answer = await pc.createAnswer();
      
      // ENHANCED: Apply codec enhancements to answer
      answer.sdp = this.enhanceAudioSDP(answer.sdp);
      answer.sdp = this.enhanceVideoSDP(answer.sdp);
      
      await pc.setLocalDescription(answer);
      
      console.log(`📤 Sending enhanced answer to ${socketId}`);
      socketManager.emit('signal', {
        to: socketId,
        signal: {
          type: 'answer',
          answer: answer
        }
      });
    } catch (error) {
      console.error(`❌ Error handling offer from ${socketId}:`, error);
      this.removePeer(socketId);
    }
  }

  async handleAnswer(socketId, answer) {
    console.log(`📥 Handling WebRTC answer from ${socketId}`);
    const pc = this.peers.get(socketId);
    if (pc) {
      try {
        // ENHANCED: Apply codec enhancements to incoming answer
        answer.sdp = this.enhanceAudioSDP(answer.sdp);
        answer.sdp = this.enhanceVideoSDP(answer.sdp);
        
        await pc.setRemoteDescription(answer);
        
        // Process pending candidates after setting remote description
        this.processPendingCandidates(socketId);
      } catch (error) {
        console.error('Error handling answer:', error);
        this.removePeer(socketId);
      }
    }
  }

  async handleIceCandidate(socketId, candidate) {
    console.log(`🧊 Handling ICE candidate from ${socketId}`);
    const pc = this.peers.get(socketId);
    if (pc) {
      try {
        // Check if remote description is set before adding candidate
        if (pc.remoteDescription && pc.remoteDescription.type) {
          await pc.addIceCandidate(candidate);
          console.log(`✅ Added ICE candidate for ${socketId}`);
        } else {
          // Queue candidate if remote description not set yet
          console.log(`📦 Queuing ICE candidate for ${socketId} (remote description not set)`);
          const pendingCandidates = this.pendingCandidates.get(socketId) || [];
          pendingCandidates.push(candidate);
          this.pendingCandidates.set(socketId, pendingCandidates);
        }
      } catch (error) {
        console.error('Error adding ICE candidate:', error);
      }
    }
  }

  removePeer(socketId) {
    console.log(`🧹 Removing user ${socketId}`);
    this.userInfo.delete(socketId);
    uiManager.removeVideo(socketId);
    console.log(`✅ Cleaned up user ${socketId}`);
  }

  // Get RTC configuration for WebRTC connections
  getRTCConfiguration() {
    // Add fallback ICE servers in case primary TURN server fails
    const fallbackIceServers = [
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
      // Backup TURN servers for reliability
      {
        urls: 'turn:openrelay.metered.ca:80',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      },
      {
        urls: 'turn:openrelay.metered.ca:443',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      }
    ];
    
    // Combine primary ICE servers with fallbacks
    const allIceServers = [...this.iceServers, ...fallbackIceServers];
    
    return {
      iceServers: allIceServers,
      iceTransportPolicy: 'all',
      iceCandidatePoolSize: 2,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require'
    };
  }

  // Setup remote audio analysis for active speaker detection
  setupRemoteAudioAnalysis(socketId, stream) {
    console.log(`🎵 Setting up remote audio analysis for ${socketId}`);
    try {
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length > 0 && this.audioContext) {
        const source = this.audioContext.createMediaStreamSource(stream);
        const analyser = this.audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;
        source.connect(analyser);
        
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        
        const analyze = () => {
          if (!this.peers.has(socketId)) return;
          
          requestAnimationFrame(analyze);
          analyser.getByteFrequencyData(dataArray);
          
          let sum = 0;
          for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
          }
          const average = sum / bufferLength;
          
          // Update remote user's audio visualizer
          if (uiManager.updateRemoteAudioVisualizer) {
            uiManager.updateRemoteAudioVisualizer(socketId, average, dataArray);
          }
          
          // Detect active speaker
          if (average > 30) {
            this.activeSpeaker = socketId;
            if (uiManager.setActiveSpeaker) {
              uiManager.setActiveSpeaker(socketId);
            }
          }
        };
        
        analyze();
      }
    } catch (error) {
      console.error('Error setting up remote audio analysis:', error);
    }
  }

  updateSettings(newSettings) {
    this.currentSettings = { ...this.currentSettings, ...newSettings };
    console.log('Settings updated:', this.currentSettings);
    
    // Save settings to localStorage
    localStorage.setItem('zloer-settings', JSON.stringify(this.currentSettings));
  }

  // Get connection statistics for monitoring codec performance
  getConnectionStats() {
    const stats = {
      totalPeers: this.peers.size,
      connectedPeers: 0,
      audioCodec: this.currentSettings.audioCodec,
      videoCodec: this.currentSettings.videoCodec,
      audioBitrate: this.currentSettings.audioBitrate,
      videoBitrate: this.currentSettings.videoBitrate,
      connectionStates: {}
    };
    
    this.peers.forEach((pc, socketId) => {
      const state = pc.connectionState;
      stats.connectionStates[socketId] = state;
      if (state === 'connected') {
        stats.connectedPeers++;
      }
    });
    
    return stats;
  }

  // Debug method to log transceiver states
  logTransceiverStates() {
    console.log('🔍 === TRANSCEIVER DEBUG INFO ===');
    this.peers.forEach((pc, socketId) => {
      console.log(`📡 Peer ${socketId}:`);
      const transceivers = pc.getTransceivers();
      transceivers.forEach((transceiver, index) => {
        console.log(`  Transceiver ${index}:`, {
          kind: transceiver.receiver.track?.kind || 'unknown',
          direction: transceiver.direction,
          mid: transceiver.mid,
          senderTrack: !!transceiver.sender.track,
          receiverTrack: !!transceiver.receiver.track,
          senderTrackEnabled: transceiver.sender.track?.enabled,
          receiverTrackEnabled: transceiver.receiver.track?.enabled,
          senderTrackId: transceiver.sender.track?.id,
          receiverTrackId: transceiver.receiver.track?.id
        });
      });
      
      // Also log connection state
      console.log(`  Connection state: ${pc.connectionState}`);
      console.log(`  ICE state: ${pc.iceConnectionState}`);
      console.log(`  Signaling state: ${pc.signalingState}`);
    });
    console.log('🔍 === END TRANSCEIVER DEBUG ===');
  }

  // Method to manually debug camera issues
  debugCameraVisibility() {
    console.log('🐛 === CAMERA VISIBILITY DEBUG ===');
    console.log('Local stream tracks:', this.localStream ? this.localStream.getTracks().map(t => `${t.kind}: ${t.enabled}`) : 'No local stream');
    console.log('Video muted state:', this.isVideoMuted);
    
    this.logTransceiverStates();
    
    // Check if local video element is working
    const localVideo = document.getElementById('local-video');
    if (localVideo) {
      console.log('Local video element:', {
        srcObject: !!localVideo.srcObject,
        videoTracks: localVideo.srcObject ? localVideo.srcObject.getVideoTracks().length : 0,
        paused: localVideo.paused,
        muted: localVideo.muted
      });
    }
    
    console.log('🐛 === END CAMERA DEBUG ===');
  }

  // Emergency method to restore all connections when they break
  async emergencyRestoreConnections() {
    console.log('🚨 === EMERGENCY CONNECTION RESTORE ===');
    
    if (!this.localStream) {
      console.error('❌ No local stream to restore');
      return;
    }
    
    console.log('🔄 Restoring all peer connections...');
    
    for (const [socketId, pc] of this.peers.entries()) {
      try {
        console.log(`🔄 Restoring connection for ${socketId}`);
        
        // Get all senders
        const senders = pc.getSenders();
        console.log(`📡 Current senders for ${socketId}:`, senders.map(s => s.track?.kind || 'null'));
        
        // Replace all tracks with current local stream tracks
        for (const track of this.localStream.getTracks()) {
          const sender = senders.find(s => s.track?.kind === track.kind || s.track === null);
          if (sender) {
            await sender.replaceTrack(track);
            console.log(`✅ Restored ${track.kind} track for ${socketId}`);
          } else {
            console.warn(`⚠️ No sender found for ${track.kind} track for ${socketId}`);
          }
        }
        
      } catch (error) {
        console.error(`❌ Error restoring connection for ${socketId}:`, error);
      }
    }
    
    console.log('🚨 === EMERGENCY RESTORE COMPLETE ===');
    NotificationManager.show('Attempted to restore all connections', 'info');
  }

  // Nuclear option: Force refresh all video tracks
  async forceRefreshVideoTracks() {
    console.log('🔄 === FORCE REFRESHING ALL VIDEO TRACKS ===');
    
    if (!this.localStream) {
      console.error('❌ No local stream available');
      return;
    }
    
    const videoTrack = this.localStream.getVideoTracks()[0];
    if (!videoTrack) {
      console.log('ℹ️ No video track to refresh');
      return;
    }
    
    console.log('🔄 Force refreshing video track for all peers...');
    
    for (const [socketId, pc] of this.peers.entries()) {
      try {
        console.log(`🔄 Force refreshing video for ${socketId}`);
        
        // Find ALL transceivers and log them
        const transceivers = pc.getTransceivers();
        console.log(`📡 Transceivers for ${socketId}:`, transceivers.map(t => ({
          mid: t.mid,
          direction: t.direction,
          senderTrack: t.sender.track?.kind,
          receiverTrack: t.receiver.track?.kind
        })));
        
        // Find video transceiver
        const videoTransceiver = transceivers.find(t => 
          t.receiver.track?.kind === 'video' || 
          t.sender.track?.kind === 'video' ||
          (t.sender.track === null && t.receiver.track === null)
        );
        
        if (videoTransceiver) {
          console.log(`📹 Found video transceiver for ${socketId}, replacing track...`);
          await videoTransceiver.sender.replaceTrack(videoTrack.enabled ? videoTrack : null);
          console.log(`✅ Force refreshed video track for ${socketId}`);
        } else {
          console.error(`❌ No video transceiver found for ${socketId}`);
        }
        
      } catch (error) {
        console.error(`❌ Error force refreshing video for ${socketId}:`, error);
      }
    }
    
    console.log('🔄 === FORCE REFRESH COMPLETE ===');
    NotificationManager.show('Force refreshed all video tracks', 'info');
  }

  muteAudio() {
    const config = this.getRTCConfiguration();
    const pc = new RTCPeerConnection(config);
    
    console.log('🔗 Creating peer connection with config:', config);
    
    // FIXED: Initialize pending candidates queue for this peer
    this.pendingCandidates.set(socketId, []);
    
    // SIMPLIFIED: Add local stream tracks directly (if available)
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        console.log(`🔄 Adding ${track.kind} track to ${socketId}`);
        pc.addTrack(track, this.localStream);
      });
    }
    
    // ALWAYS add video transceiver for future video (if no video track exists)
    const hasVideoTrack = this.localStream && this.localStream.getVideoTracks().length > 0;
    if (!hasVideoTrack) {
      console.log(`📹 Adding video transceiver for future video track to ${socketId}`);
      pc.addTransceiver('video', { direction: 'sendrecv' });
    }

    // Handle incoming tracks
    pc.ontrack = (event) => {
      console.log(`🎥 Received remote stream from ${socketId}`);
      console.log(`📹 Track details:`, {
        trackCount: event.streams?.length || 0,
        trackKind: event.track?.kind,
        trackEnabled: event.track?.enabled,
        trackReadyState: event.track?.readyState,
        trackId: event.track?.id
      });
      
      // FIXED: Add null checks for event.streams
      if (!event.streams || event.streams.length === 0) {
        console.warn(`⚠️ No streams in ontrack event for ${socketId}, creating new stream`);
        // Create a new MediaStream and add the track
        const remoteStream = new MediaStream();
        if (event.track) {
          remoteStream.addTrack(event.track);
          console.log(`✅ Added ${event.track.kind} track to new stream for ${socketId}`);
        }
        uiManager.addRemoteVideo(socketId, remoteStream);
      } else {
        const [remoteStream] = event.streams;
        
        // Log track details for debugging
        if (remoteStream && remoteStream.getTracks) {
          console.log(`📹 Remote stream tracks for ${socketId}:`);
          remoteStream.getTracks().forEach((track, index) => {
            console.log(`  Track ${index}: ${track.kind} - enabled: ${track.enabled}, readyState: ${track.readyState}, id: ${track.id}`);
          });
        }
        
        uiManager.addRemoteVideo(socketId, remoteStream);
        
        // Set up remote audio analysis for active speaker detection
        this.setupRemoteAudioAnalysis(socketId, remoteStream);
      }
      
      // FIXED: Update nickname after video element is created
      setTimeout(() => {
        const user = this.getStoredUserInfo(socketId);
        if (user && user.nickname) {
          uiManager.updateUserName(socketId, user.nickname);
        }
      }, 100);
    };

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        // FIXED: Log ICE candidate details for debugging
        console.log(`🧊 ICE candidate for ${socketId}:`, {
          type: event.candidate.type,
          protocol: event.candidate.protocol,
          address: event.candidate.address,
          port: event.candidate.port,
          foundation: event.candidate.foundation
        });
        
        socketManager.emit('signal', {
          to: socketId,
          signal: {
            type: 'ice-candidate',
            candidate: event.candidate
          }
        });
      } else {
        console.log(`🏁 ICE gathering complete for ${socketId}`);
      }
    };

    // FIXED: Enhanced connection state monitoring with reconnection logic
    pc.onconnectionstatechange = () => {
      console.log(`Connection state with ${socketId}:`, pc.connectionState);
      
      if (pc.connectionState === 'failed') {
        console.error(`❌ Connection failed with ${socketId}`);
        // Don't immediately restart ICE - give it time to recover
        setTimeout(() => {
          if (pc.connectionState === 'failed') {
            console.log(`🔄 Attempting ICE restart for ${socketId} after delay`);
            this.handleConnectionFailure(socketId);
          }
        }, 5000); // Wait 5 seconds before attempting restart
      } else if (pc.connectionState === 'disconnected') {
        console.warn(`⚠️ Connection disconnected with ${socketId}, monitoring for recovery`);
        // Give it more time to recover before attempting restart
        setTimeout(() => {
          if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
            console.log(`🔄 Attempting recovery for ${socketId} after timeout`);
            this.handleConnectionFailure(socketId);
          }
        }, 15000); // Increased from 10s to 15s
      } else if (pc.connectionState === 'connected') {
        console.log(`✅ Connection established with ${socketId}`);
        NotificationManager.show('Peer connected successfully', 'success');
        // FIXED: Process any pending candidates now that connection is established
        this.processPendingCandidates(socketId);
        
        // Debug: Log transceiver states when connection is established
        setTimeout(() => this.logTransceiverStates(), 500);
      }
    };

    // FIXED: Added ICE connection state monitoring for better diagnostics
    pc.oniceconnectionstatechange = () => {
      console.log(`ICE connection state with ${socketId}:`, pc.iceConnectionState);
      this.handleIceStateChange(socketId, pc.iceConnectionState);
    };

    // FIXED: Added signaling state monitoring to handle race conditions
    pc.onsignalingstatechange = () => {
      console.log(`Signaling state with ${socketId}:`, pc.signalingState);
      
      // Process pending candidates when remote description is set
      if (pc.signalingState === 'stable' || pc.signalingState === 'have-remote-offer') {
        this.processPendingCandidates(socketId);
      }
    };

    this.peers.set(socketId, pc);
    return pc;
  }

  setupRemoteAudioAnalysis(socketId, stream) {
    console.log(`🎵 Setting up remote audio analysis for ${socketId}`);
    try {
      // FIXED: Add null checks for stream
      if (!stream || !stream.getAudioTracks) {
        console.warn(`⚠️ Invalid stream for audio analysis: ${socketId}`);
        return;
      }
      
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length > 0 && this.audioContext) {
        const source = this.audioContext.createMediaStreamSource(stream);
        const analyser = this.audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;
        source.connect(analyser);
        
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        
        const analyze = () => {
          if (!this.peers.has(socketId)) return;
          
          requestAnimationFrame(analyze);
          analyser.getByteFrequencyData(dataArray);
          
          let sum = 0;
          for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
          }
          const average = sum / bufferLength;
          
          // Update remote user's audio visualizer
          if (uiManager && uiManager.updateRemoteAudioVisualizer) {
            uiManager.updateRemoteAudioVisualizer(socketId, average, dataArray);
          }
          
          // Detect active speaker
          if (average > 30) {
            this.activeSpeaker = socketId;
            if (uiManager && uiManager.setActiveSpeaker) {
              uiManager.setActiveSpeaker(socketId);
            }
          }
        };
        
        analyze();
        console.log(`✅ Audio analysis setup complete for ${socketId}`);
      } else {
        console.log(`ℹ️ No audio tracks or audio context for ${socketId}`);
      }
    } catch (error) {
      console.error(`❌ Error setting up remote audio analysis for ${socketId}:`, error);
    }
  }

  async createOffer(socketId) {
    console.log(`📞 Creating offer for ${socketId}`);
    const pc = this.createPeerConnection(socketId);
    
    try {
      // FIXED: Ensure local stream is available before creating offer
      if (!this.localStream) {
        console.error(`❌ No local stream available when creating offer for ${socketId}`);
        return;
      }
      
      console.log(`🎥 Local stream tracks for ${socketId}:`, this.localStream.getTracks().map(t => `${t.kind}: ${t.enabled}`));
      
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      
      await pc.setLocalDescription(offer);
      
      console.log(`📤 Sending offer to ${socketId}`);
      socketManager.emit('signal', {
        to: socketId,
        signal: {
          type: 'offer',
          offer: offer
        }
      });
    } catch (error) {
      console.error(`❌ Error creating offer for ${socketId}:`, error);
      this.removePeer(socketId);
    }
  }

  async handleOffer(socketId, offer) {
    console.log(`📥 Handling offer from ${socketId}`);
    const pc = this.createPeerConnection(socketId);
    
    try {
      // FIXED: Ensure local stream is available before handling offer
      if (!this.localStream) {
        console.error(`❌ No local stream available when handling offer from ${socketId}`);
        return;
      }
      
      console.log(`🎥 Local stream tracks for ${socketId}:`, this.localStream.getTracks().map(t => `${t.kind}: ${t.enabled}`));
      
      await pc.setRemoteDescription(offer);
      
      // FIXED: Process pending candidates after setting remote description
      this.processPendingCandidates(socketId);
      
      const answer = await pc.createAnswer();
      
      await pc.setLocalDescription(answer);
      
      console.log(`📤 Sending answer to ${socketId}`);
      socketManager.emit('signal', {
        to: socketId,
        signal: {
          type: 'answer',
          answer: answer
        }
      });
    } catch (error) {
      console.error(`❌ Error handling offer from ${socketId}:`, error);
      // FIXED: Clean up on error
      this.removePeer(socketId);
    }
  }

  // ENHANCED: Advanced audio SDP enhancement for high-quality codecs
  enhanceAudioSDP(sdp) {
    let enhancedSDP = sdp;
    
    // Configure based on current settings
    const { audioCodec, audioBitrate, audioChannels, stereoEnabled, dtxEnabled, opusComplexity, opusFec, opusMaxPlaybackRate } = this.currentSettings;
    
    if (audioCodec === 'opus') {
      // ENHANCED: Advanced Opus parameters for maximum quality
      const opusParams = [
        `maxaveragebitrate=${audioBitrate}`,
        `maxplaybackrate=${opusMaxPlaybackRate}`,
        audioChannels === 2 && stereoEnabled ? 'stereo=1' : 'stereo=0',
        audioChannels === 2 && stereoEnabled ? 'sprop-stereo=1' : 'sprop-stereo=0',
        dtxEnabled ? 'usedtx=1' : 'usedtx=0',
        `useinbandfec=${opusFec ? '1' : '0'}`, // Forward Error Correction
        `complexity=${opusComplexity}`, // Maximum complexity for best quality
        'cbr=0', // Variable bitrate for better quality
        'vbr=1' // Enable variable bitrate
      ].join(';');
      
      // Apply Opus parameters to all Opus codecs
      enhancedSDP = enhancedSDP.replace(
        /(a=fmtp:(\d+) .*opus.*)/gi,
        (match, line, payloadType) => {
          // Check if this line already has parameters
          if (line.includes('maxaveragebitrate')) {
            return line; // Already enhanced
          }
          return `${line};${opusParams}`;
        }
      );
      
      // If no existing fmtp line for Opus, add one
      const opusPayloadMatch = enhancedSDP.match(/a=rtpmap:(\d+) opus/i);
      if (opusPayloadMatch && !enhancedSDP.includes(`a=fmtp:${opusPayloadMatch[1]}`)) {
        const payloadType = opusPayloadMatch[1];
        const rtpmapLine = `a=rtpmap:${payloadType} opus/48000/2`;
        enhancedSDP = enhancedSDP.replace(
          rtpmapLine,
          `${rtpmapLine}\r\na=fmtp:${payloadType} ${opusParams}`
        );
      }
      
      // Prefer Opus codec by reordering m= line
      enhancedSDP = enhancedSDP.replace(
        /(m=audio \d+ UDP\/TLS\/RTP\/SAVPF) ([\d\s]+)/g,
        (match, prefix, codecList) => {
          const codecs = codecList.trim().split(' ');
          const opusCodecs = [];
          const otherCodecs = [];
          
          // Find Opus codec payload types
          const opusMatches = enhancedSDP.match(/a=rtpmap:(\d+) opus/gi);
          const opusPayloads = opusMatches ? opusMatches.map(m => m.match(/a=rtpmap:(\d+)/)[1]) : [];
          
          codecs.forEach(codec => {
            if (opusPayloads.includes(codec)) {
              opusCodecs.push(codec);
            } else {
              otherCodecs.push(codec);
            }
          });
          
          // Put Opus first
          const reorderedCodecs = [...opusCodecs, ...otherCodecs].join(' ');
          return `${prefix} ${reorderedCodecs}`;
        }
      );
    } else {
      // Handle other codecs (G.722, PCMU, PCMA)
      const codecMap = {
        'g722': 'G722',
        'pcmu': 'PCMU',
        'pcma': 'PCMA'
      };
      
      const codecName = codecMap[audioCodec];
      if (codecName) {
        const codecRegex = new RegExp(`a=rtpmap:(\\d+) ${codecName}`, 'i');
        const codecs = enhancedSDP.match(codecRegex);
        if (codecs) {
          const codecId = codecs[1];
          enhancedSDP = enhancedSDP.replace(
            /(m=audio \d+ UDP\/TLS\/RTP\/SAVPF) ([\d\s]+)/g,
            (match, prefix, codecList) => {
              const reorderedCodecs = codecList.trim().split(' ');
              // Move preferred codec to front
              const index = reorderedCodecs.indexOf(codecId);
              if (index > 0) {
                reorderedCodecs.splice(index, 1);
                reorderedCodecs.unshift(codecId);
              }
              return `${prefix} ${reorderedCodecs.join(' ')}`;
            }
          );
        }
      }
    }
    
    return enhancedSDP;
  }

  // ENHANCED: Advanced video SDP enhancement for high-quality codecs
  enhanceVideoSDP(sdp) {
    let enhancedSDP = sdp;
    
    const { videoCodec, videoBitrate } = this.currentSettings;
    
    // ENHANCED: Advanced video codec parameters
    if (videoCodec === 'vp9') {
      // VP9 specific enhancements
      const vp9PayloadMatch = enhancedSDP.match(/a=rtpmap:(\d+) VP9/i);
      if (vp9PayloadMatch) {
        const payloadType = vp9PayloadMatch[1];
        const vp9Params = [
          'profile-id=0', // Profile 0 for better compatibility
          'level-id=30'   // Level 3.0 for 720p
        ].join(';');
        
        // Add or enhance VP9 fmtp line
        if (!enhancedSDP.includes(`a=fmtp:${payloadType}`)) {
          const rtpmapLine = `a=rtpmap:${payloadType} VP9/90000`;
          enhancedSDP = enhancedSDP.replace(
            rtpmapLine,
            `${rtpmapLine}\r\na=fmtp:${payloadType} ${vp9Params}`
          );
        }
      }
    } else if (videoCodec === 'h264') {
      // H.264 specific enhancements
      const h264PayloadMatch = enhancedSDP.match(/a=rtpmap:(\d+) H264/i);
      if (h264PayloadMatch) {
        const payloadType = h264PayloadMatch[1];
        const h264Params = [
          'level-asymmetry-allowed=1',
          'packetization-mode=1',
          'profile-level-id=42e01f' // Baseline profile, level 3.1
        ].join(';');
        
        // Add or enhance H.264 fmtp line
        if (!enhancedSDP.includes(`a=fmtp:${payloadType}`)) {
          const rtpmapLine = `a=rtpmap:${payloadType} H264/90000`;
          enhancedSDP = enhancedSDP.replace(
            rtpmapLine,
            `${rtpmapLine}\r\na=fmtp:${payloadType} ${h264Params}`
          );
        }
      }
    }
    
    // Set video bitrate using b= line (more reliable than fmtp)
    enhancedSDP = enhancedSDP.replace(
      /(m=video \d+ UDP\/TLS\/RTP\/SAVPF [\d\s]+)/g,
      `$1\r\nb=AS:${Math.floor(videoBitrate / 1000)}`
    );
    
    // Prefer selected video codec by reordering m= line
    const codecMap = {
      'vp8': 'VP8',
      'vp9': 'VP9',
      'h264': 'H264',
      'av1': 'AV01'
    };
    
    const codecName = codecMap[videoCodec];
    if (codecName) {
      enhancedSDP = enhancedSDP.replace(
        /(m=video \d+ UDP\/TLS\/RTP\/SAVPF) ([\d\s]+)/g,
        (match, prefix, codecList) => {
          const codecs = codecList.trim().split(' ');
          const preferredCodecs = [];
          const otherCodecs = [];
          
          // Find preferred codec payload types
          const codecMatches = enhancedSDP.match(new RegExp(`a=rtpmap:(\\d+) ${codecName}`, 'gi'));
          const codecPayloads = codecMatches ? codecMatches.map(m => m.match(/a=rtpmap:(\d+)/)[1]) : [];
          
          codecs.forEach(codec => {
            if (codecPayloads.includes(codec)) {
              preferredCodecs.push(codec);
            } else {
              otherCodecs.push(codec);
            }
          });
          
          // Put preferred codec first
          const reorderedCodecs = [...preferredCodecs, ...otherCodecs].join(' ');
          return `${prefix} ${reorderedCodecs}`;
        }
      );
    }
    
    return enhancedSDP;
  }

  async handleAnswer(socketId, answer) {
    const pc = this.peers.get(socketId);
    if (pc) {
      try {
        await pc.setRemoteDescription(answer);
        
        // FIXED: Process pending candidates after setting remote description
        this.processPendingCandidates(socketId);
      } catch (error) {
        console.error('Error handling answer:', error);
        // FIXED: Clean up on error
        this.removePeer(socketId);
      }
    }
  }

  async handleIceCandidate(socketId, candidate) {
    const pc = this.peers.get(socketId);
    if (pc) {
      try {
        // FIXED: Check if remote description is set before adding candidate
        if (pc.remoteDescription && pc.remoteDescription.type) {
          await pc.addIceCandidate(candidate);
          console.log(`✅ Added ICE candidate for ${socketId}`);
        } else {
          // FIXED: Queue candidate if remote description not set yet (race condition fix)
          console.log(`📦 Queuing ICE candidate for ${socketId} (remote description not set)`);
          const pendingCandidates = this.pendingCandidates.get(socketId) || [];
          pendingCandidates.push(candidate);
          this.pendingCandidates.set(socketId, pendingCandidates);
        }
      } catch (error) {
        console.error('Error adding ICE candidate:', error);
        // Don't throw error, just log it as this is common during connection setup
      }
    }
  }

  // FIXED: Added method to process pending ICE candidates
  async processPendingCandidates(socketId) {
    const pc = this.peers.get(socketId);
    const pendingCandidates = this.pendingCandidates.get(socketId) || [];
    
    if (pc && pc.remoteDescription && pendingCandidates.length > 0) {
      console.log(`🔄 Processing ${pendingCandidates.length} pending ICE candidates for ${socketId}`);
      
      for (const candidate of pendingCandidates) {
        try {
          await pc.addIceCandidate(candidate);
          console.log(`✅ Added queued ICE candidate for ${socketId}`);
        } catch (error) {
          console.error(`❌ Error adding queued ICE candidate for ${socketId}:`, error);
        }
      }
      
      // Clear the queue
      this.pendingCandidates.set(socketId, []);
    }
  }

  // FIXED: Added connection failure handling with ICE restart
  handleConnectionFailure(socketId) {
    const pc = this.peers.get(socketId);
    if (pc) {
      console.log(`🔄 Attempting ICE restart for ${socketId}`);
      
      try {
        // Attempt ICE restart
        pc.restartIce();
        
        // Log the failure for diagnostics
        this.connectionErrors.push({
          socketId,
          error: 'ICE connection failed',
          timestamp: Date.now(),
          iceState: pc.iceConnectionState,
          connectionState: pc.connectionState
        });
        
        // If ICE restart doesn't work after 30 seconds, remove peer
        setTimeout(() => {
          if (pc.connectionState === 'failed') {
            console.error(`❌ ICE restart failed for ${socketId}, removing peer`);
            this.removePeer(socketId);
          }
        }, 30000);
        
      } catch (error) {
        console.error(`❌ ICE restart failed for ${socketId}:`, error);
        this.removePeer(socketId);
      }
    }
  }

  // FIXED: Enhanced ICE state change handling with TURN diagnostics
  handleIceStateChange(socketId, iceState) {
    console.log(`🧊 ICE state change for ${socketId}: ${iceState}`);
    
    switch (iceState) {
      case 'checking':
        console.log(`🔍 ICE checking connectivity for ${socketId}`);
        break;
      case 'connected':
        console.log(`✅ ICE connected for ${socketId}`);
        break;
      case 'completed':
        console.log(`🎉 ICE completed for ${socketId}`);
        break;
      case 'failed':
        console.error(`❌ ICE failed for ${socketId} - Connection issue detected`);
        // Don't immediately show error - ICE can recover
        setTimeout(() => {
          const pc = this.peers.get(socketId);
          if (pc && pc.iceConnectionState === 'failed') {
            NotificationManager.show('Connection failed - Check network or TURN server', 'error');
            console.log('💡 Visit /turn-test.html to test TURN server connectivity');
          }
        }, 3000);
        break;
      case 'disconnected':
        console.warn(`⚠️ ICE disconnected for ${socketId}`);
        break;
      case 'closed':
        console.log(`🔒 ICE closed for ${socketId}`);
        break;
    }
  }

  // Add TURN server diagnostics logging
  logTurnServerDiagnostics() {
    console.log('🔍 === TURN SERVER DIAGNOSTICS ===');
    console.log('Current ICE servers configuration:', this.iceServers);
    console.log('💡 If connections keep failing, visit /turn-test.html to test TURN server');
    console.log('🔧 Fallback TURN servers are automatically included for reliability');
    
    // Test TURN server connectivity
    this.testTurnConnectivity().then(result => {
      if (result.working) {
        console.log('✅ TURN server connectivity test passed');
      } else {
        console.error('❌ TURN server connectivity test failed:', result.error);
        console.log('🔄 Using fallback TURN servers for connection reliability');
      }
    });
  }

  // Quick TURN server connectivity test
  async testTurnConnectivity() {
    try {
      const pc = new RTCPeerConnection({ iceServers: this.iceServers });
      let hasRelay = false;
      
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          pc.close();
          resolve({ working: hasRelay, error: hasRelay ? null : 'No relay candidates found' });
        }, 5000);
        
        pc.onicecandidate = (event) => {
          if (event.candidate && event.candidate.type === 'relay') {
            hasRelay = true;
            clearTimeout(timeout);
            pc.close();
            resolve({ working: true, error: null });
          }
        };
        
        pc.createDataChannel('test');
        pc.createOffer().then(offer => pc.setLocalDescription(offer));
      });
    } catch (error) {
      return { working: false, error: error.message };
    }
  }

  removePeer(socketId) {
    const pc = this.peers.get(socketId);
    if (pc) {
      // FIXED: Properly close peer connection and clean up resources
      try {
        // Close all transceivers
        pc.getTransceivers().forEach(transceiver => {
          if (transceiver.stop) {
            transceiver.stop();
          }
        });
        
        // Close the peer connection
        pc.close();
      } catch (error) {
        console.error(`Error closing peer connection for ${socketId}:`, error);
      }
      
      this.peers.delete(socketId);
    }
    
    // FIXED: Clean up pending candidates queue
    this.pendingCandidates.delete(socketId);
    
    // FIXED: Clean up stored user info
    this.userInfo.delete(socketId);
    
    // Remove from UI
    uiManager.removeVideo(socketId);
    
    // Remove stats display
    const statsSection = document.getElementById(`stats-${socketId}`);
    if (statsSection) {
      statsSection.remove();
    }
    
    console.log(`🧹 Cleaned up peer connection for ${socketId}`);
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

  async toggleVideo() {
    if (!this.localStream) return false;
    
    const videoTrack = this.localStream.getVideoTracks()[0];
    
    if (!videoTrack) {
      // No video track exists, need to add camera
      try {
        const [width, height] = this.currentSettings.videoResolution.split('x').map(Number);
        const videoConstraints = {
          deviceId: this.currentSettings.selectedCamera ? 
            { exact: this.currentSettings.selectedCamera } : undefined,
          width: { ideal: width, max: width * 1.5 },
          height: { ideal: height, max: height * 1.5 },
          frameRate: { ideal: this.currentSettings.videoFramerate, max: this.currentSettings.videoFramerate }
        };
        
        const videoStream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });
        const newVideoTrack = videoStream.getVideoTracks()[0];
        
        // Add video track to existing stream
        this.localStream.addTrack(newVideoTrack);
        
        // Update local video element
        const localVideo = document.getElementById('local-video');
        if (localVideo) {
          localVideo.srcObject = this.localStream;
        }
        
        // Update all peer connections with the new video track
        this.peers.forEach(async (pc, socketId) => {
          try {
            console.log(`🔄 Updating video track for peer ${socketId}`);
            
            // SIMPLIFIED: Find video transceiver directly by kind
            const videoTransceiver = pc.getTransceivers().find(t => 
              t.receiver.track?.kind === 'video' || 
              (t.sender.track === null && t.receiver.track === null && t.mid !== null)
            );
            
            if (videoTransceiver && videoTransceiver.sender) {
              // Replace the track
              await videoTransceiver.sender.replaceTrack(newVideoTrack);
              
              // Configure video encoding parameters
              const params = videoTransceiver.sender.getParameters();
              if (params.encodings && params.encodings.length > 0) {
                params.encodings[0].maxBitrate = this.currentSettings.videoBitrate;
                params.encodings[0].maxFramerate = this.currentSettings.videoFramerate;
                params.encodings[0].priority = 'medium';
                params.encodings[0].networkPriority = 'medium';
              }
              await videoTransceiver.sender.setParameters(params);
              
              console.log(`✅ Successfully replaced video track for peer ${socketId}`);
            } else {
              console.error(`❌ No video transceiver found for ${socketId}!`);
              console.log(`� Avalilable transceivers:`, pc.getTransceivers().map(t => ({
                mid: t.mid,
                direction: t.direction,
                senderTrack: t.sender.track?.kind,
                receiverTrack: t.receiver.track?.kind
              })));
            }
            
          } catch (error) {
            console.error(`❌ Error updating video track for ${socketId}:`, error);
          }
        });
        
        this.isVideoMuted = false;
        uiManager.updateVideoButton(this.isVideoMuted);
        uiManager.updateLocalVideoDisplay(false);
        NotificationManager.show(`📹 Camera enabled!`, 'success');
        
        // Debug: Log transceiver states after enabling camera
        setTimeout(() => this.logTransceiverStates(), 1000);
        
        return true;
        
      } catch (error) {
        console.error('Error enabling camera:', error);
        NotificationManager.show('Failed to enable camera', 'error');
        return false;
      }
    } else {
      // Video track exists, toggle it
      const wasEnabled = videoTrack.enabled;
      videoTrack.enabled = !videoTrack.enabled;
      this.isVideoMuted = !videoTrack.enabled;
      uiManager.updateVideoButton(this.isVideoMuted);
      uiManager.updateLocalVideoDisplay(this.isVideoMuted);
      
      // If we're disabling video, replace track with null in peer connections
      if (!videoTrack.enabled && wasEnabled) {
        this.peers.forEach(async (pc, socketId) => {
          try {
            console.log(`🔄 Disabling video track for peer ${socketId}`);
            
            // Find video transceiver with active video track
            const videoTransceiver = pc.getTransceivers().find(t => 
              t.sender.track && t.sender.track.kind === 'video'
            );
            
            if (videoTransceiver && videoTransceiver.sender) {
              await videoTransceiver.sender.replaceTrack(null);
              console.log(`✅ Disabled video track for peer connection ${socketId}`);
            } else {
              console.warn(`⚠️ No active video transceiver found for disabling for ${socketId}`);
            }
          } catch (error) {
            console.error(`❌ Error disabling video track for ${socketId}:`, error);
          }
        });
      }
      // If we're enabling video, replace null with the track
      else if (videoTrack.enabled && !wasEnabled) {
        this.peers.forEach(async (pc, socketId) => {
          try {
            console.log(`🔄 Enabling video track for peer ${socketId}`);
            
            // Find video transceiver
            const videoTransceiver = pc.getTransceivers().find(t => 
              t.receiver.track?.kind === 'video' || 
              (t.sender.track === null && t.receiver.track === null && t.mid !== null)
            );
            
            if (videoTransceiver && videoTransceiver.sender) {
              await videoTransceiver.sender.replaceTrack(videoTrack);
              console.log(`✅ Enabled video track for peer connection ${socketId}`);
            } else {
              console.error(`❌ No video transceiver found for enabling video for ${socketId}`);
            }
          } catch (error) {
            console.error(`❌ Error enabling video track for ${socketId}:`, error);
          }
        });
      }
      
      return !this.isVideoMuted;
    }
  }

  muteAudio() {
    if (this.localStream) {
      const audioTrack = this.localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = false;
        this.isAudioMuted = true;
        uiManager.updateMuteButton(this.isAudioMuted);
      }
    }
  }

  async shareScreen() {
    if (this.isScreenSharing) {
      // Stop screen sharing
      await this.stopScreenShare();
      return;
    }

    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
      });

      // Replace video track in all peer connections
      const videoTrack = screenStream.getVideoTracks()[0];
      
      this.peers.forEach(async (pc) => {
        const sender = pc.getSenders().find(s => 
          s.track && s.track.kind === 'video'
        );
        
        if (sender) {
          await sender.replaceTrack(videoTrack);
        }
      });

      // Update local video
      const localVideo = document.querySelector('#local-video');
      if (localVideo) {
        localVideo.srcObject = screenStream;
      }

      // Handle screen share end
      videoTrack.onended = () => {
        this.stopScreenShare();
      };

      this.isScreenSharing = true;
      uiManager.updateScreenShareButton(true);
      
      // Mark local container as screen sharing for better fullscreen experience
      const localContainer = document.getElementById('local-container');
      if (localContainer) {
        localContainer.classList.add('screen-sharing');
      }
      
      NotificationManager.show('Screen sharing started - Double-click video for fullscreen', 'success');

    } catch (error) {
      console.error('Error sharing screen:', error);
      NotificationManager.show('Failed to share screen', 'error');
    }
  }

  async stopScreenShare() {
    if (!this.isScreenSharing) return;

    try {
      // Get camera stream back
      const cameraStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });

      const videoTrack = cameraStream.getVideoTracks()[0];

      // Replace screen track with camera track in all peer connections
      this.peers.forEach(async (pc) => {
        const sender = pc.getSenders().find(s => 
          s.track && s.track.kind === 'video'
        );
        
        if (sender) {
          await sender.replaceTrack(videoTrack);
        }
      });

      // Update local video
      const localVideo = document.querySelector('#local-video');
      if (localVideo) {
        localVideo.srcObject = cameraStream;
      }

      // Update local stream reference
      this.localStream = cameraStream;

      this.isScreenSharing = false;
      uiManager.updateScreenShareButton(false);
      
      // Remove screen sharing class
      const localContainer = document.getElementById('local-container');
      if (localContainer) {
        localContainer.classList.remove('screen-sharing');
      }
      
      NotificationManager.show('Screen sharing stopped', 'info');

    } catch (error) {
      console.error('Error stopping screen share:', error);
      NotificationManager.show('Failed to stop screen sharing', 'error');
    }
  }

  cleanup() {
    // FIXED: Enhanced cleanup to prevent memory leaks
    console.log('🧹 Starting WebRTC cleanup...');
    
    // Close all peer connections with proper cleanup
    this.peers.forEach((pc, socketId) => {
      try {
        // Close all transceivers
        pc.getTransceivers().forEach(transceiver => {
          if (transceiver.stop) {
            transceiver.stop();
          }
        });
        
        // Close peer connection
        pc.close();
        console.log(`✅ Closed peer connection for ${socketId}`);
      } catch (error) {
        console.error(`❌ Error closing peer connection for ${socketId}:`, error);
      }
    });
    this.peers.clear();

    // FIXED: Clear pending candidates queue
    this.pendingCandidates.clear();

    // Stop local stream with proper track cleanup
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

    // Clean up audio context
    if (this.audioContext) {
      try {
        this.audioContext.close();
        console.log('✅ Closed audio context');
      } catch (error) {
        console.error('❌ Error closing audio context:', error);
      }
      this.audioContext = null;
    }

    // Reset audio visualizer
    this.analyser = null;
    this.activeSpeaker = null;
    
    // Stop stats collection
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
    
    console.log('🧹 WebRTC cleanup completed');
  }

  startConnectionStats() {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
    }
    
    this.statsInterval = setInterval(() => {
      this.updateConnectionStats();
      this.measureServerPing();
    }, 1000);
  }

  stopConnectionStats() {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
  }

  async updateConnectionStats() {
    try {
      // Update local stream stats
      await this.updateLocalStats();
      
      // Update remote peer stats
      for (const [socketId, pc] of this.peers) {
        await this.updateRemoteStats(socketId, pc);
      }
    } catch (error) {
      console.error('Error updating connection stats:', error);
    }
  }

  async updateLocalStats() {
    if (!this.localStream) return;
    
    const videoTrack = this.localStream.getVideoTracks()[0];
    const audioTrack = this.localStream.getAudioTracks()[0];
    
    // Update video resolution and framerate
    if (videoTrack) {
      const settings = videoTrack.getSettings();
      document.getElementById('local-resolution').textContent = 
        `${settings.width || 0}x${settings.height || 0}`;
      document.getElementById('local-framerate').textContent = 
        `${settings.frameRate || 0} fps`;
    }
    
    // Get stats from first peer connection for outbound data
    const firstPeer = this.peers.values().next().value;
    if (firstPeer) {
      const stats = await firstPeer.getStats();
      
      let videoBitrate = 0;
      let audioBitrate = 0;
      let videoCodec = this.currentSettings.videoCodec.toUpperCase();
      let audioCodec = this.currentSettings.audioCodec.toUpperCase();
      
      stats.forEach(report => {
        if (report.type === 'outbound-rtp') {
          if (report.mediaType === 'video' && report.bytesSent) {
            videoBitrate = Math.round((report.bytesSent * 8) / 1000); // kbps
          } else if (report.mediaType === 'audio' && report.bytesSent) {
            audioBitrate = Math.round((report.bytesSent * 8) / 1000); // kbps
          }
        } else if (report.type === 'codec') {
          if (report.mimeType) {
            if (report.mimeType.includes('video/')) {
              videoCodec = report.mimeType.split('/')[1].toUpperCase();
            } else if (report.mimeType.includes('audio/')) {
              audioCodec = report.mimeType.split('/')[1].toUpperCase();
            }
          }
        }
      });
      
      document.getElementById('local-video-bitrate').textContent = `${videoBitrate} kbps`;
      document.getElementById('local-audio-bitrate').textContent = `${audioBitrate} kbps`;
      document.getElementById('local-video-codec').textContent = videoCodec;
      document.getElementById('local-audio-codec').textContent = audioCodec;
    }
  }

  async updateRemoteStats(socketId, pc) {
    try {
      const stats = await pc.getStats();
      
      let videoBitrate = 0;
      let audioBitrate = 0;
      let packetLoss = 0;
      let rtt = 0;
      let videoResolution = '-';
      let framerate = 0;
      let videoCodec = '-';
      let audioCodec = '-';
      
      stats.forEach(report => {
        if (report.type === 'inbound-rtp') {
          if (report.mediaType === 'video') {
            if (report.bytesReceived) {
              videoBitrate = Math.round((report.bytesReceived * 8) / 1000);
            }
            if (report.frameWidth && report.frameHeight) {
              videoResolution = `${report.frameWidth}x${report.frameHeight}`;
            }
            if (report.framesPerSecond) {
              framerate = Math.round(report.framesPerSecond);
            }
            if (report.packetsLost && report.packetsReceived) {
              packetLoss = ((report.packetsLost / (report.packetsLost + report.packetsReceived)) * 100).toFixed(1);
            }
          } else if (report.mediaType === 'audio' && report.bytesReceived) {
            audioBitrate = Math.round((report.bytesReceived * 8) / 1000);
          }
        } else if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          if (report.currentRoundTripTime) {
            rtt = Math.round(report.currentRoundTripTime * 1000);
          }
        } else if (report.type === 'codec') {
          if (report.mimeType) {
            if (report.mimeType.includes('video/')) {
              videoCodec = report.mimeType.split('/')[1].toUpperCase();
            } else if (report.mimeType.includes('audio/')) {
              audioCodec = report.mimeType.split('/')[1].toUpperCase();
            }
          }
        }
      });
      
      this.updateRemoteStatsDisplay(socketId, {
        videoBitrate,
        audioBitrate,
        packetLoss,
        rtt,
        videoResolution,
        framerate,
        videoCodec,
        audioCodec
      });
      
    } catch (error) {
      console.error(`Error getting stats for ${socketId}:`, error);
    }
  }

  updateRemoteStatsDisplay(socketId, stats) {
    const container = document.getElementById('remote-stats-container');
    let statsSection = document.getElementById(`stats-${socketId}`);
    
    if (!statsSection) {
      statsSection = document.createElement('div');
      statsSection.id = `stats-${socketId}`;
      statsSection.className = 'stats-section remote-peer-stats';
      
      const userName = document.getElementById(`name-${socketId}`)?.textContent || 'Remote User';
      
      statsSection.innerHTML = `
        <h4>${userName} (${socketId.substring(0, 8)})</h4>
        <div class="stats-data">
          <div class="stat-item">
            <span class="stat-label">Video Resolution:</span>
            <span class="stat-value" id="resolution-${socketId}">-</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Frame Rate:</span>
            <span class="stat-value" id="framerate-${socketId}">-</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Video Bitrate:</span>
            <span class="stat-value" id="video-bitrate-${socketId}">-</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Audio Bitrate:</span>
            <span class="stat-value" id="audio-bitrate-${socketId}">-</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Packet Loss:</span>
            <span class="stat-value" id="packet-loss-${socketId}">-</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">RTT:</span>
            <span class="stat-value" id="rtt-${socketId}">-</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Video Codec:</span>
            <span class="stat-value" id="video-codec-${socketId}">-</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Audio Codec:</span>
            <span class="stat-value" id="audio-codec-${socketId}">-</span>
          </div>
        </div>
      `;
      
      container.appendChild(statsSection);
    }
    
    // Update values
    document.getElementById(`resolution-${socketId}`).textContent = stats.videoResolution;
    document.getElementById(`framerate-${socketId}`).textContent = `${stats.framerate} fps`;
    
    const videoBitrateEl = document.getElementById(`video-bitrate-${socketId}`);
    videoBitrateEl.textContent = `${stats.videoBitrate} kbps`;
    videoBitrateEl.className = 'stat-value' + (stats.videoBitrate < 500 ? ' warning' : '');
    
    const audioBitrateEl = document.getElementById(`audio-bitrate-${socketId}`);
    audioBitrateEl.textContent = `${stats.audioBitrate} kbps`;
    
    const packetLossEl = document.getElementById(`packet-loss-${socketId}`);
    packetLossEl.textContent = `${stats.packetLoss}%`;
    packetLossEl.className = 'stat-value' + (stats.packetLoss > 5 ? ' error' : stats.packetLoss > 2 ? ' warning' : '');
    
    const rttEl = document.getElementById(`rtt-${socketId}`);
    rttEl.textContent = `${stats.rtt} ms`;
    rttEl.className = 'stat-value' + (stats.rtt > 200 ? ' error' : stats.rtt > 100 ? ' warning' : '');
    
    document.getElementById(`video-codec-${socketId}`).textContent = stats.videoCodec;
    document.getElementById(`audio-codec-${socketId}`).textContent = stats.audioCodec;
  }

  measureServerPing() {
    const startTime = Date.now();
    
    // Send ping to server
    socketManager.emit('ping', { timestamp: startTime });
    
    // Listen for pong response (set up once)
    if (!this.pongListenerSet) {
      socketManager.on('pong', (data) => {
        const endTime = Date.now();
        const ping = endTime - data.timestamp;
        this.updateServerPing(ping);
      });
      this.pongListenerSet = true;
    }
  }

  updateServerPing(ping) {
    const pingElement = document.getElementById('server-ping');
    if (pingElement) {
      pingElement.textContent = `${ping} ms`;
      pingElement.className = 'stat-value' + (ping > 200 ? ' error' : ping > 100 ? ' warning' : '');
    }
  }
}

// UI Manager Class
class UIManager {
  constructor() {
    this.currentTheme = 'theme-gaming';
    this.isChatOpen = false;
    this.isAdminPanelOpen = false;
    this.userCount = 0;
    this.isHost = false;
    this.roomId = '';
    this.nickname = '';
    this.layoutMode = 'grid'; // 'grid' or 'spotlight'
    this.activeSpeaker = null;
    this.pinnedUser = null;
    this.isSettingsPanelOpen = false;
    this.audioVisualizerEnabled = true;
    this.isFullscreen = false;
    this.connectionStatsEnabled = false;
    this.statsInterval = null;
    this.currentLanguage = 'en'; // Default language
    this.translations = {
      en: {
        nickname: 'Enter your nickname',
        roomId: 'Room ID (leave empty for new room)',
        joinRoom: '🚀 Join Room',
        beta: 'Beta 1.0',
        telegram: '📱 Join our Telegram',
        connecting: 'Zlover is setting up your connection...',
        tip: "💡 Zlover's tip: Make sure your microphone is ready!",
        roomCopied: 'Room link copied to clipboard!',
        joinedSession: 'joined the gaming session!',
        firstGamer: "Zloer: You're the first gamer here! Invite your friends!",
        foundGamers: 'Zloer found',
        gamersInRoom: 'gamer(s) in the room!',
        connected: 'Zloer: Connected to server successfully!',
        cameraEnabled: 'Zloer: Camera enabled! Looking good, gamer!',
        hostPowerUp: 'Zloer: You are now the room host! Power up!',
        kickUser: 'Kick User',
        youAreHost: 'You are the room owner',
        hostBadge: 'Owner',
        userKicked: 'has been kicked from the room',
        youWereKicked: 'You have been kicked from the room',
        zloverGreeting: "Hey there! I'm Zlover, your gaming buddy!",
        poweredBy: 'Powered by Zlover - Making gaming connections awesome!'
      },
      ru: {
        nickname: 'Введите ваш никнейм',
        roomId: 'ID комнаты (оставьте пустым для новой комнаты)',
        joinRoom: '🚀 Войти в комнату',
        beta: 'Бета 1.0',
        telegram: '📱 Присоединиться к Telegram',
        connecting: 'Злоер настраивает ваше соединение...',
        tip: '💡 Совет Злоера: Убедитесь, что микрофон готов!',
        roomCopied: 'Ссылка на комнату скопирована!',
        joinedSession: 'присоединился к игровой сессии!',
        firstGamer: 'Злоер: Вы первый игрок здесь! Пригласите друзей!',
        foundGamers: 'Злоер нашёл',
        gamersInRoom: 'игрок(ов) в комнате!',
        connected: 'Злоер: Успешно подключен к серверу!',
        cameraEnabled: 'Злоер: Камера включена! Отлично выглядишь, игрок!',
        hostPowerUp: 'Злоер: Теперь вы хост комнаты! Вперёд!',
        kickUser: 'Исключить пользователя',
        youAreHost: 'Вы владелец комнаты',
        hostBadge: 'Владелец',
        userKicked: 'был исключён из комнаты',
        youWereKicked: 'Вас исключили из комнаты',
        zloverGreeting: 'Привет! Я Злоер, твой игровой приятель!',
        poweredBy: 'Работает на Злоере - Делаем игровые соединения потрясающими!'
      }
    };
  }

  init() {
    this.setupEventListeners();
    this.loadTheme();
    this.loadLanguage(); // Load saved language
    this.setLayoutMode('grid'); // Initialize with grid layout
    
    // Load audio visualizer setting
    const savedSettings = localStorage.getItem('zloer-settings');
    if (savedSettings) {
      const settings = JSON.parse(savedSettings);
      this.audioVisualizerEnabled = settings.audioVisualizerEnabled !== false;
    }
    
    // Parse URL for room ID
    this.parseUrlForRoom();
    
    // Add fullscreen event listeners
    document.addEventListener('fullscreenchange', () => this.handleFullscreenChange());
    document.addEventListener('webkitfullscreenchange', () => this.handleFullscreenChange());
    document.addEventListener('msfullscreenchange', () => this.handleFullscreenChange());
    
    // Add global event listener for video control buttons
    document.addEventListener('click', (e) => {
      const socketId = e.target.closest('.video-container')?.dataset.socketId;
      
      if (e.target.classList.contains('fullscreen-btn')) {
        e.stopPropagation();
        this.toggleFullscreen(socketId);
      } else if (e.target.classList.contains('pin-btn')) {
        e.stopPropagation();
        this.togglePin(socketId);
      }
    });
  }

  parseUrlForRoom() {
    const urlParams = new URLSearchParams(window.location.search);
    const roomId = urlParams.get('room');
    if (roomId) {
      const roomInput = document.getElementById('room-input');
      if (roomInput) {
        roomInput.value = roomId;
        console.log('Auto-filled room ID from URL:', roomId);
      }
    }
  }

  setLanguage(lang) {
    this.currentLanguage = lang;
    localStorage.setItem('zloer-language', lang);
    this.updateTexts();
  }

  loadLanguage() {
    const savedLang = localStorage.getItem('zloer-language') || 'en';
    this.currentLanguage = savedLang;
    this.updateTexts();
  }

  t(key) {
    return this.translations[this.currentLanguage][key] || this.translations.en[key] || key;
  }

  updateTexts() {
    // Update placeholders
    const nicknameInput = document.getElementById('nickname-input');
    const roomInput = document.getElementById('room-input');
    const joinBtn = document.getElementById('join-btn');
    const telegramLink = document.querySelector('.telegram-link a');
    const versionBadge = document.querySelector('.version-badge');
    const loadingText = document.querySelector('.loading-text');
    const loadingTip = document.querySelector('.loading-tips p');
    const zloverMessage = document.getElementById('zlover-message');
    const mascotIntro = document.querySelector('.mascot-intro');

    if (nicknameInput) nicknameInput.placeholder = this.t('nickname');
    if (roomInput) roomInput.placeholder = this.t('roomId');
    if (joinBtn) joinBtn.textContent = this.t('joinRoom');
    if (telegramLink) telegramLink.textContent = this.t('telegram');
    if (versionBadge) versionBadge.textContent = this.t('beta');
    if (loadingText) loadingText.textContent = this.t('connecting');
    if (loadingTip) loadingTip.textContent = this.t('tip');
    if (zloverMessage) zloverMessage.textContent = this.t('zloverGreeting');
    if (mascotIntro) mascotIntro.textContent = this.t('poweredBy');
    
    // Update language selector to show current selection
    const languageSelect = document.getElementById('language-select');
    if (languageSelect) {
      languageSelect.value = this.currentLanguage;
    }
  }

  setupEventListeners() {
    // Join form - FIXED: Add null checks for all elements
    const joinBtn = document.getElementById('join-btn');
    const nicknameInput = document.getElementById('nickname-input');
    const roomInput = document.getElementById('room-input');

    if (joinBtn) {
      joinBtn.addEventListener('click', () => this.handleJoin());
    }
    
    if (nicknameInput) {
      nicknameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.handleJoin();
      });
    }
    
    if (roomInput) {
      roomInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.handleJoin();
      });
    }

    // Theme selector - FIXED: Add null check
    const themeSelect = document.getElementById('theme-select');
    if (themeSelect) {
      themeSelect.addEventListener('change', (e) => {
        this.changeTheme(e.target.value);
      });
    }

    // Language selector - FIXED: Add null check
    const languageSelect = document.getElementById('language-select');
    if (languageSelect) {
      languageSelect.addEventListener('change', (e) => {
        this.setLanguage(e.target.value);
      });
    }

    // Layout controls - FIXED: Add null checks
    const layoutGridBtn = document.getElementById('layout-grid-btn');
    const layoutSpotlightBtn = document.getElementById('layout-spotlight-btn');
    const visualizerToggleBtn = document.getElementById('visualizer-toggle-btn');
    const statsToggleBtn = document.getElementById('stats-toggle-btn');

    if (layoutGridBtn) {
      layoutGridBtn.addEventListener('click', () => {
        this.setLayoutMode('grid');
      });
    }

    if (layoutSpotlightBtn) {
      layoutSpotlightBtn.addEventListener('click', () => {
        this.setLayoutMode('spotlight');
      });
    }

    if (visualizerToggleBtn) {
      visualizerToggleBtn.addEventListener('click', () => {
        this.toggleAudioVisualizer();
      });
    }

    if (statsToggleBtn) {
      statsToggleBtn.addEventListener('click', () => {
        this.toggleConnectionStats();
      });
    }

    // Controls - FIXED: Add null checks
    const muteBtn = document.getElementById('mute-btn');
    const videoBtn = document.getElementById('video-btn');
    const screenShareBtn = document.getElementById('screen-share-btn');
    const chatToggleBtn = document.getElementById('chat-toggle-btn');

    if (muteBtn) {
      muteBtn.addEventListener('click', () => {
        rtcManager.toggleAudio();
      });
    }

    if (videoBtn) {
      videoBtn.addEventListener('click', () => {
        rtcManager.toggleVideo();
      });
    }

    if (screenShareBtn) {
      screenShareBtn.addEventListener('click', () => {
        rtcManager.shareScreen();
      });
    }

    if (chatToggleBtn) {
      chatToggleBtn.addEventListener('click', () => {
        this.toggleChat();
      });
    }

    // Header buttons - FIXED: Add null checks
    const themeBtn = document.getElementById('theme-btn');
    const settingsBtn = document.getElementById('settings-btn');
    const leaveBtn = document.getElementById('leave-btn');
    const copyRoomBtn = document.getElementById('copy-room-btn');

    if (themeBtn) {
      themeBtn.addEventListener('click', () => {
        this.cycleTheme();
      });
    }

    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => {
        this.toggleSettingsPanel();
      });

      // Right-click on settings for admin panel (host only)
      settingsBtn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (this.isHost) {
          this.toggleAdminPanel();
        } else {
          NotificationManager.show('Only the host can access admin controls', 'info');
        }
      });
    }

    if (leaveBtn) {
      leaveBtn.addEventListener('click', () => {
        this.leaveRoom();
      });
    }

    // TURN test button
    const turnTestBtn = document.getElementById('turn-test-btn');
    if (turnTestBtn) {
      turnTestBtn.addEventListener('click', () => {
        window.open('/turn-test.html', '_blank');
      });
    }

    // Copy room link - FIXED: Add null check
    if (copyRoomBtn) {
      copyRoomBtn.addEventListener('click', () => {
        const roomUrl = `${window.location.origin}${window.location.pathname}?room=${this.roomId}`;
        navigator.clipboard.writeText(roomUrl).then(() => {
          NotificationManager.show(`🎮 ${this.t('roomCopied')}`, 'success');
        }).catch(() => {
          // Fallback for older browsers
          const textArea = document.createElement('textarea');
          textArea.value = roomUrl;
          document.body.appendChild(textArea);
          textArea.select();
          document.execCommand('copy');
          document.body.removeChild(textArea);
          NotificationManager.show(`🎮 ${this.t('roomCopied')}`, 'success');
        });
      });
    }
    // Chat - FIXED: Add null checks
    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-btn');
    const chatCloseBtn = document.getElementById('chat-close-btn');

    if (sendBtn) {
      sendBtn.addEventListener('click', () => this.sendMessage());
    }
    
    if (chatInput) {
      chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.sendMessage();
      });
    }

    if (chatCloseBtn) {
      chatCloseBtn.addEventListener('click', () => {
        this.toggleChat();
      });
    }

    // Admin panel - FIXED: Add null checks
    const adminCloseBtn = document.getElementById('admin-close-btn');
    if (adminCloseBtn) {
      adminCloseBtn.addEventListener('click', () => {
        this.toggleAdminPanel();
      });
    }

    // Settings panel - FIXED: Add null checks
    const settingsCloseBtn = document.getElementById('settings-close-btn');
    if (settingsCloseBtn) {
      settingsCloseBtn.addEventListener('click', () => {
        this.toggleSettingsPanel();
      });
    }

    // Stats panel - FIXED: Add null checks
    const statsCloseBtn = document.getElementById('stats-close-btn');
    const applySettingsBtn = document.getElementById('apply-settings-btn');
    const resetSettingsBtn = document.getElementById('reset-settings-btn');
    const testMicBtn = document.getElementById('test-mic-btn');
    const testCameraBtn = document.getElementById('test-camera-btn');

    if (statsCloseBtn) {
      statsCloseBtn.addEventListener('click', () => {
        this.toggleConnectionStats();
      });
    }

    if (applySettingsBtn) {
      applySettingsBtn.addEventListener('click', () => {
        this.applySettings();
      });
    }

    if (resetSettingsBtn) {
      resetSettingsBtn.addEventListener('click', () => {
        this.resetSettings();
      });
    }

    if (testMicBtn) {
      testMicBtn.addEventListener('click', () => {
        const microphoneSelect = document.getElementById('microphone-select');
        const deviceId = microphoneSelect ? microphoneSelect.value : '';
        if (deviceId) {
          rtcManager.testDevice('microphone', deviceId);
        }
      });
    }

    if (testCameraBtn) {
      testCameraBtn.addEventListener('click', () => {
        const cameraSelect = document.getElementById('camera-select');
        const deviceId = cameraSelect ? cameraSelect.value : '';
        if (deviceId) {
          rtcManager.testDevice('camera', deviceId);
        }
      });
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey) {
        switch (e.key.toLowerCase()) {
          case 'm':
            e.preventDefault();
            rtcManager.toggleAudio();
            break;
          case 'v':
            e.preventDefault();
            rtcManager.toggleVideo();
            break;
          case 's':
            e.preventDefault();
            rtcManager.shareScreen();
            break;
          case 'c':
            e.preventDefault();
            this.toggleChat();
            break;
          case 'g':
            e.preventDefault();
            this.setLayoutMode('grid');
            break;
          case 'l':
            e.preventDefault();
            this.setLayoutMode('spotlight');
            break;
          case 'e':
            e.preventDefault();
            this.toggleSettingsPanel();
            break;
          case 'f':
            e.preventDefault();
            // Toggle fullscreen for active speaker or local video
            const activeContainer = document.querySelector('.video-container.active-speaker') || 
                                  document.getElementById('local-container');
            if (activeContainer) {
              const socketId = activeContainer.dataset.socketId;
              this.toggleFullscreen(socketId);
            }
            break;
          case 'a':
            e.preventDefault();
            this.toggleAudioVisualizer();
            break;
          case 'i':
            e.preventDefault();
            this.toggleConnectionStats();
            break;
        }
      }
    });

  }

  async handleJoin() {
    const nicknameInput = document.getElementById('nickname-input');
    const roomInput = document.getElementById('room-input');
    
    if (!nicknameInput || !roomInput) {
      console.error('❌ Required input elements not found');
      NotificationManager.show('Page not loaded correctly. Please refresh.', 'error');
      return;
    }
    
    const nickname = nicknameInput.value.trim();
    const roomId = roomInput.value.trim() || this.generateRoomId();

    if (!nickname) {
      NotificationManager.show('Please enter a nickname', 'error');
      return;
    }

    console.log('Starting join process...', { nickname, roomId });
    this.nickname = nickname;
    this.roomId = roomId;

    // Update URL with room ID for sharing
    const roomUrl = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
    window.history.replaceState({}, '', roomUrl);

    // Show loading
    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen) {
      loadingScreen.style.display = 'flex';
    }

    try {
      // FIXED: Reduced timeout from 15s to 10s to prevent endless loading
      const joinProcess = this.performJoinProcess();
      const timeoutProcess = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Join process timeout')), 10000);
      });
      
      await Promise.race([joinProcess, timeoutProcess]);
      
    } catch (error) {
      console.error('Error during join process:', error);
      if (loadingScreen) loadingScreen.style.display = 'none';
      
      if (error.message === 'Join process timeout') {
        NotificationManager.show('Connection timeout. Continuing anyway...', 'warning');
        // FIXED: Always continue to main app even on timeout
        this.showMainApp();
      } else {
        NotificationManager.show(`Join failed: ${error.message}`, 'error');
        // FIXED: Still show main app even on other errors
        setTimeout(() => {
          this.showMainApp();
        }, 1000);
      }
    }
  }

  async performJoinProcess() {
    // Initialize media
    console.log('Initializing media...');
    
    try {
      const mediaInitialized = await rtcManager.initializeMedia();
      if (!mediaInitialized) {
        console.error('Media initialization failed, continuing anyway...');
        // Don't throw error, continue with dummy stream
      }
      console.log('Media initialized successfully');
    } catch (error) {
      console.error('Media initialization error:', error);
      // Continue anyway with dummy stream
      rtcManager.localStream = rtcManager.createDummyStream();
    }

    // Connect to server
    console.log('Connecting to server...');
    socketManager.connect();
    
    // Wait for connection and join room
    setTimeout(() => {
      console.log('Joining room...', { roomId: this.roomId, nickname: this.nickname });
      socketManager.emit('join-room', { roomId: this.roomId, nickname: this.nickname });
    }, 1000);

    // FIXED: Show main app after a shorter delay to prevent endless loading
    setTimeout(() => {
      this.showMainApp();
    }, 2000); // Reduced from 3000 to 2000
  }

  showMainApp() {
    console.log('Showing main app...');
    const loadingScreen = document.getElementById('loading-screen');
    const joinScreen = document.getElementById('join-screen');
    const app = document.getElementById('app');
    const roomDisplay = document.getElementById('room-id-display');
    
    if (loadingScreen) loadingScreen.style.display = 'none';
    if (joinScreen) joinScreen.style.display = 'none';
    if (app) app.classList.remove('hidden');
    if (roomDisplay) roomDisplay.textContent = `Room: ${this.roomId}`;
    
    // Show notification with proper translation
    setTimeout(() => {
      NotificationManager.show('🎮 Welcome to Zloer! Chat and see user presence.', 'success', 5000);
    }, 1000);
  }

  generateRoomId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  addLocalVideo(stream) {
    console.log('🎥 Adding local video');
    // FIXED: Define socketId explicitly for local user
    const socketId = 'local';
    
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
    video.muted = true; // IMPORTANT: Mute local video to prevent echo/feedback!
    video.volume = 0;
    
    // Add double-click for fullscreen
    video.addEventListener('dblclick', () => {
      this.toggleFullscreen('local');
    });
    
    // Audio visualizer canvas
    const visualizerCanvas = document.createElement('canvas');
    visualizerCanvas.className = 'audio-visualizer';
    visualizerCanvas.id = 'local-visualizer';
    visualizerCanvas.width = 200;
    visualizerCanvas.height = 60;
    visualizerCanvas.style.display = rtcManager.currentSettings.audioVisualizerEnabled ? 'block' : 'none';
    
    const overlay = document.createElement('div');
    overlay.className = 'video-overlay';
    
    const nameSpan = document.createElement('span');
    nameSpan.className = 'user-name';
    nameSpan.id = 'name-local'; // FIXED: Add ID for consistency
    // FIXED: Use nickname if available, otherwise show placeholder
    nameSpan.textContent = this.nickname ? `${this.nickname} (You)` : 'You';
    
    const controlsDiv = document.createElement('div');
    controlsDiv.className = 'video-controls'; 
    
    const hostBadge = document.createElement('span');
    hostBadge.className = 'host-badge';
    hostBadge.textContent = '👑';
    hostBadge.style.display = this.isHost ? 'inline' : 'none';
    hostBadge.title = 'Owner';
    
    const pinBtn = document.createElement('button');
    pinBtn.className = 'pin-btn';
    pinBtn.innerHTML = '📌';
    pinBtn.onclick = () => this.togglePin('local');
    
    const fsBtn = document.createElement('button');
    fsBtn.className = 'fullscreen-btn';
    fsBtn.innerHTML = '⛶';
    fsBtn.onclick = () => this.toggleFullscreen('local'); 
    
    controlsDiv.appendChild(hostBadge);
    controlsDiv.appendChild(pinBtn);
    controlsDiv.appendChild(fsBtn);
    
    overlay.appendChild(nameSpan);
    overlay.appendChild(controlsDiv);
    
    videoContainer.appendChild(video);
    videoContainer.appendChild(visualizerCanvas);
    videoContainer.appendChild(overlay);
    
    // Prepend to show local video first
    videoGrid.prepend(videoContainer);
    
    this.updateLayout();
    
    console.log('✅ Local video added with nickname:', this.nickname);
  }

  addRemoteVideo(socketId, stream) {
    try {
      console.log(`🎥 Adding remote video for ${socketId}`);
      
      // FIXED: Add null checks
      if (!socketId) {
        console.error('❌ Cannot add remote video: socketId is null/undefined');
        return;
      }
      
      if (!stream) {
        console.error(`❌ Cannot add remote video for ${socketId}: stream is null/undefined`);
        return;
      }
      
      const videoGrid = document.getElementById('video-grid');
      if (!videoGrid) {
        console.error('❌ Cannot add remote video: video-grid element not found');
        return;
      }
      
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
      video.playsinline = true;
      video.muted = false; // Audio must be ON
      video.volume = 1.0;

    // --- AUTOPLAY FIX ---
    const tryPlay = async () => {
      try {
        await video.play();
        console.log(`✅ Video playing for ${socketId}`);
      } catch (err) {
        console.warn(`⚠️ Autoplay blocked for ${socketId}. Waiting for user interaction.`);
        const enableAudio = async () => {
          try {
            await video.play();
            document.removeEventListener('click', enableAudio);
            document.removeEventListener('touchstart', enableAudio);
          } catch(e) {}
        };
        document.addEventListener('click', enableAudio);
        document.addEventListener('touchstart', enableAudio);
      }
    };

    video.onloadedmetadata = tryPlay;
    // -------------------
    
    // Add double-click for fullscreen
    video.addEventListener('dblclick', () => {
      this.toggleFullscreen(socketId);
    });
    
    // Audio visualizer canvas
    const visualizerCanvas = document.createElement('canvas');
    visualizerCanvas.className = 'audio-visualizer';
    visualizerCanvas.id = `visualizer-${socketId}`;
    visualizerCanvas.width = 200;
    visualizerCanvas.height = 60;
    visualizerCanvas.style.display = rtcManager.currentSettings.audioVisualizerEnabled ? 'block' : 'none';
    
    const overlay = document.createElement('div');
    overlay.className = 'video-overlay';
    
    // FIXED: Create elements properly instead of using innerHTML
    const userName = document.createElement('span');
    userName.className = 'user-name';
    userName.id = `name-${socketId}`;
    userName.textContent = 'Loading...'; // Default text, will be updated
    
    const videoControls = document.createElement('div');
    videoControls.className = 'video-controls';
    
    const hostBadge = document.createElement('span');
    hostBadge.className = 'host-badge';
    hostBadge.id = `host-${socketId}`;
    hostBadge.style.display = 'none';
    hostBadge.title = this.t('hostBadge');
    hostBadge.textContent = '👑';
    
    const pinBtn = document.createElement('button');
    pinBtn.className = 'pin-btn';
    pinBtn.title = 'Pin/Unpin';
    pinBtn.textContent = '📌';
    
    const fullscreenBtn = document.createElement('button');
    fullscreenBtn.className = 'fullscreen-btn';
    fullscreenBtn.title = 'Fullscreen';
    fullscreenBtn.textContent = '⛶';
    
    const kickBtn = document.createElement('button');
    kickBtn.className = 'kick-btn';
    kickBtn.id = `kick-${socketId}`;
    kickBtn.style.display = 'none';
    kickBtn.title = this.t('kickUser');
    kickBtn.textContent = '❌';
    
    videoControls.appendChild(hostBadge);
    videoControls.appendChild(pinBtn);
    videoControls.appendChild(fullscreenBtn);
    videoControls.appendChild(kickBtn);
    
    overlay.appendChild(userName);
    overlay.appendChild(videoControls);
    
    videoContainer.appendChild(video);
    videoContainer.appendChild(visualizerCanvas);
    videoContainer.appendChild(overlay);
    videoGrid.appendChild(videoContainer);
    
    // Add kick button event listener
    kickBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.kickUser(socketId);
    });
    
    // FIXED: Update nickname immediately if we have user info
    const userInfo = rtcManager.getStoredUserInfo(socketId);
    if (userInfo && userInfo.nickname) {
      userName.textContent = userInfo.nickname;
      console.log(`✅ Immediately set nickname for ${socketId}: ${userInfo.nickname}`);
    }
    
    this.updateLayout();
    
    console.log(`✅ Successfully added remote video for ${socketId}`);
  } catch (error) {
    console.error(`❌ Error adding remote video for ${socketId}:`, error);
    NotificationManager.show(`Failed to add video for user ${socketId}`, 'error');
  }
}

  removeVideo(socketId) {
    const videoContainer = document.getElementById(`video-${socketId}`);
    if (videoContainer) {
      videoContainer.remove();
      this.updateLayout();
    }
  }

  setLayoutMode(mode) {
    this.layoutMode = mode;
    
    // Update button states
    document.getElementById('layout-grid-btn').classList.toggle('active', mode === 'grid');
    document.getElementById('layout-spotlight-btn').classList.toggle('active', mode === 'spotlight');
    
    this.updateLayout();
    NotificationManager.show(`Switched to ${mode} view`, 'info');
  }

  updateLayout() {
    const videoGrid = document.getElementById('video-grid');
    const containers = videoGrid.querySelectorAll('.video-container');
    
    // Remove existing layout classes
    videoGrid.classList.remove('grid-layout', 'spotlight-layout');
    containers.forEach(container => {
      container.classList.remove('spotlight-main', 'spotlight-sidebar', 'grid-item');
    });
    
    if (this.layoutMode === 'spotlight') {
      videoGrid.classList.add('spotlight-layout');
      
      // Determine spotlight user (pinned user, active speaker, or first user)
      let spotlightUser = this.pinnedUser || this.activeSpeaker || 'local';
      
      containers.forEach(container => {
        const socketId = container.dataset.socketId;
        if (socketId === spotlightUser) {
          container.classList.add('spotlight-main');
        } else {
          container.classList.add('spotlight-sidebar');
        }
      });
    } else {
      videoGrid.classList.add('grid-layout');
      containers.forEach(container => {
        container.classList.add('grid-item');
      });
    }
  }

  togglePin(socketId) {
    if (this.pinnedUser === socketId) {
      this.pinnedUser = null;
      NotificationManager.show('User unpinned', 'info');
    } else {
      this.pinnedUser = socketId;
      const userName = socketId === 'local' ? 'You' : document.getElementById(`name-${socketId}`)?.textContent || 'User';
      NotificationManager.show(`${userName} pinned`, 'success');
    }
    
    // Update pin button states
    document.querySelectorAll('.pin-btn').forEach(btn => {
      btn.classList.remove('active');
    });
    
    if (this.pinnedUser) {
      const pinnedContainer = socketId === 'local' ? 
        document.getElementById('local-container') : 
        document.getElementById(`video-${this.pinnedUser}`);
      
      if (pinnedContainer) {
        pinnedContainer.querySelector('.pin-btn').classList.add('active');
      }
    }
    
    this.updateLayout();
  }

  setActiveSpeaker(socketId) {
    // Remove previous active speaker indicator
    document.querySelectorAll('.video-container').forEach(container => {
      container.classList.remove('active-speaker');
    });
    
    // Add active speaker indicator
    const speakerContainer = socketId === 'local' ? 
      document.getElementById('local-container') : 
      document.getElementById(`video-${socketId}`);
    
    if (speakerContainer) {
      speakerContainer.classList.add('active-speaker');
      this.activeSpeaker = socketId;
      
      // Update layout if in spotlight mode and no pinned user
      if (this.layoutMode === 'spotlight' && !this.pinnedUser) {
        this.updateLayout();
      }
    }
  }

  updateAudioVisualizer(volume, frequencyData) {
    if (!rtcManager.currentSettings.audioVisualizerEnabled) return;
    
    const canvas = document.getElementById('local-visualizer');
    // FIXED: Add proper error checking for canvas element
    if (!canvas) {
      console.warn('Local canvas visualizer not found');
      return;
    }
    
    // FIXED: Check if element is actually a canvas
    if (canvas.tagName !== 'CANVAS') {
      console.warn(`Local visualizer element is not a canvas, it's a ${canvas.tagName}`);
      return;
    }
    
    // FIXED: Add try-catch for getContext
    let ctx;
    try {
      ctx = canvas.getContext('2d');
      if (!ctx) {
        console.warn('Could not get 2d context for local canvas');
        return;
      }
    } catch (error) {
      console.error('Error getting local canvas context:', error);
      return;
    }
    const width = canvas.width;
    const height = canvas.height;
    
    // Clear canvas
    ctx.clearRect(0, 0, width, height);
    
    // Draw frequency bars
    const barWidth = width / frequencyData.length * 2;
    let x = 0;
    
    for (let i = 0; i < frequencyData.length; i++) {
      const barHeight = (frequencyData[i] / 255) * height;
      
      // Create gradient
      const gradient = ctx.createLinearGradient(0, height - barHeight, 0, height);
      gradient.addColorStop(0, '#00ff88');
      gradient.addColorStop(0.5, '#ffaa00');
      gradient.addColorStop(1, '#ff4444');
      
      ctx.fillStyle = gradient;
      ctx.fillRect(x, height - barHeight, barWidth, barHeight);
      
      x += barWidth + 1;
    }
    
    // Update microphone button glow
    this.updateMicrophoneGlow(volume);
  }

  updateRemoteAudioVisualizer(socketId, volume, frequencyData) {
    if (!rtcManager.currentSettings.audioVisualizerEnabled) return;
    
    const canvas = document.getElementById(`visualizer-${socketId}`);
    // FIXED: Add proper error checking for canvas element
    if (!canvas) {
      console.warn(`Canvas visualizer not found for ${socketId}`);
      return;
    }
    
    // FIXED: Check if element is actually a canvas
    if (canvas.tagName !== 'CANVAS') {
      console.warn(`Element visualizer-${socketId} is not a canvas, it's a ${canvas.tagName}`);
      return;
    }
    
    // FIXED: Add try-catch for getContext
    let ctx;
    try {
      ctx = canvas.getContext('2d');
      if (!ctx) {
        console.warn(`Could not get 2d context for canvas ${socketId}`);
        return;
      }
    } catch (error) {
      console.error(`Error getting canvas context for ${socketId}:`, error);
      return;
    }
    const width = canvas.width;
    const height = canvas.height;
    
    // Clear canvas
    ctx.clearRect(0, 0, width, height);
    
    // Draw frequency bars
    const barWidth = width / frequencyData.length * 2;
    let x = 0;
    
    for (let i = 0; i < frequencyData.length; i++) {
      const barHeight = (frequencyData[i] / 255) * height;
      
      // Create gradient
      const gradient = ctx.createLinearGradient(0, height - barHeight, 0, height);
      gradient.addColorStop(0, '#0088ff');
      gradient.addColorStop(0.5, '#00aaff');
      gradient.addColorStop(1, '#0066cc');
      
      ctx.fillStyle = gradient;
      ctx.fillRect(x, height - barHeight, barWidth, barHeight);
      
      x += barWidth + 1;
    }
  }

  toggleAudioVisualizer() {
    this.audioVisualizerEnabled = !this.audioVisualizerEnabled;
    rtcManager.updateSettings({ audioVisualizerEnabled: this.audioVisualizerEnabled });
    
    // Show/hide all visualizer canvases
    const visualizers = document.querySelectorAll('.audio-visualizer');
    visualizers.forEach(canvas => {
      canvas.style.display = this.audioVisualizerEnabled ? 'block' : 'none';
    });
    
    // Update button state
    const btn = document.getElementById('visualizer-toggle-btn');
    if (btn) {
      btn.classList.toggle('active', this.audioVisualizerEnabled);
    }
    
    NotificationManager.show(
      `Audio visualizer ${this.audioVisualizerEnabled ? 'enabled' : 'disabled'}`, 
      'info'
    );
  }

  updateMicrophoneGlow(volume) {
    const muteBtn = document.getElementById('mute-btn');
    if (!muteBtn) return;
    
    // Create glow effect based on volume
    const intensity = Math.min(volume / 100, 1);
    const glowColor = this.isAudioMuted ? 'rgba(255, 68, 68, 0.5)' : `rgba(0, 255, 136, ${intensity})`;
    
    muteBtn.style.boxShadow = `0 0 ${intensity * 20}px ${glowColor}`;
  }

  updateUserName(socketId, nickname) {
    console.log(`📝 Updating name for ${socketId}: ${nickname}`);
    const nameElement = document.getElementById(`name-${socketId}`);
    
    if (nameElement) {
      const displayName = socketId === 'local' ? `${nickname} (You)` : nickname;
      nameElement.textContent = displayName;
      console.log(`✅ Name updated for ${socketId}: ${displayName}`);
    } else {
      console.warn(`❌ Name element not found for ${socketId}`);
      
      // FIXED: Retry a few times with increasing delays
      let retryCount = 0;
      const maxRetries = 5;
      
      const retryUpdate = () => {
        retryCount++;
        const retryElement = document.getElementById(`name-${socketId}`);
        if (retryElement) {
          const displayName = socketId === 'local' ? `${nickname} (You)` : nickname;
          retryElement.textContent = displayName;
          console.log(`✅ Name updated on retry ${retryCount} for ${socketId}: ${displayName}`);
        } else if (retryCount < maxRetries) {
          console.log(`⏳ Retry ${retryCount}/${maxRetries} for ${socketId} name update...`);
          setTimeout(retryUpdate, retryCount * 200); // Increasing delay
        } else {
          console.error(`❌ Failed to update name for ${socketId} after ${maxRetries} retries`);
        }
      };
      
      setTimeout(retryUpdate, 100);
    }
  }

  updateHostBadge(socketId, isHost) {
    const hostBadge = document.getElementById(`host-${socketId}`);
    if (hostBadge) {
      hostBadge.style.display = isHost ? 'inline' : 'none';
      hostBadge.title = this.t('hostBadge');
    }
    
    // Update kick button visibility for this user
    const kickBtn = document.getElementById(`kick-${socketId}`);
    if (kickBtn && this.isHost) {
      kickBtn.style.display = isHost ? 'none' : 'inline-block'; // Don't show kick button for host
    }
  }

  updateUserCount(count) {
    this.userCount = count;
    document.getElementById('user-count').textContent = `${count} user${count !== 1 ? 's' : ''}`;
  }

  updateMuteButton(isMuted) {
    const btn = document.getElementById('mute-btn');
    btn.textContent = isMuted ? 'MUTED' : 'MIC';
    btn.className = `btn-control ${isMuted ? 'inactive' : 'active'}`;
    btn.title = `${isMuted ? 'Unmute' : 'Mute'} (Ctrl+M)`;
  }

  updateVideoButton(isOff) {
    const btn = document.getElementById('video-btn');
    btn.textContent = isOff ? 'OFF' : 'ON';
    btn.className = `btn-control ${isOff ? 'inactive' : 'active'}`;
    btn.title = `Camera ${isOff ? 'Off' : 'On'} (Ctrl+V)`;
  }

  updateLocalVideoDisplay(isOff) {
    const localVideo = document.getElementById('local-video');
    const localContainer = document.getElementById('local-container');
    
    if (isOff) {
      // Remove any existing overlays
      const existingOverlay = localContainer.querySelector('.camera-off-overlay');
      if (existingOverlay) {
        existingOverlay.remove();
      }
      
      // Create new overlay with camera off emoji
      const overlay = document.createElement('div');
      overlay.className = 'camera-off-overlay user-avatar-fallback';
      overlay.innerHTML = '📷';
      
      localContainer.appendChild(overlay);
      
      if (localVideo) {
        localVideo.style.display = 'none';
      }
    } else {
      // Remove camera off overlay
      const overlay = localContainer.querySelector('.camera-off-overlay');
      if (overlay) {
        overlay.remove();
      }
      if (localVideo) {
        localVideo.style.display = 'block';
      }
    }
  }

  updateScreenShareButton(isSharing) {
    const btn = document.getElementById('screen-share-btn');
    btn.textContent = isSharing ? '🖥️' : '🖥️';
    btn.className = `btn-control ${isSharing ? 'active' : ''}`;
    btn.title = `${isSharing ? 'Stop' : 'Share'} Screen (Ctrl+S)`;
  }

  toggleChat() {
    const chatPanel = document.getElementById('chat-panel');
    this.isChatOpen = !this.isChatOpen;
    
    if (this.isChatOpen) {
      chatPanel.style.display = 'flex';
      document.getElementById('chat-input').focus();
    } else {
      chatPanel.style.display = 'none';
    }
    
    const btn = document.getElementById('chat-toggle-btn');
    btn.className = `btn-control ${this.isChatOpen ? 'active' : ''}`;
  }

  addChatMessage(data) {
    const messagesContainer = document.getElementById('chat-messages');
    
    const messageDiv = document.createElement('div');
    messageDiv.className = 'chat-message';
    
    const timestamp = new Date(data.timestamp).toLocaleTimeString();
    
    messageDiv.innerHTML = `
      <div class="chat-message-header">
        <span class="chat-nickname">${data.nickname}</span>
        <span class="chat-timestamp">${timestamp}</span>
      </div>
      <div class="chat-text">${this.escapeHtml(data.message)}</div>
    `;
    
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  sendMessage() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    
    if (message) {
      socketManager.emit('chat-message', { message });
      input.value = '';
    }
  }

  toggleAdminPanel() {
    const adminPanel = document.getElementById('admin-panel');
    this.isAdminPanelOpen = !this.isAdminPanelOpen;
    
    if (this.isAdminPanelOpen) {
      adminPanel.classList.remove('hidden');
      this.updateAdminPanel();
    } else {
      adminPanel.classList.add('hidden');
    }
  }

  toggleSettingsPanel() {
    const settingsPanel = document.getElementById('settings-panel');
    this.isSettingsPanelOpen = !this.isSettingsPanelOpen;
    
    if (this.isSettingsPanelOpen) {
      settingsPanel.classList.remove('hidden');
      this.loadSettingsPanel();
    } else {
      settingsPanel.classList.add('hidden');
    }
  }

  async loadSettingsPanel() {
    // Load available devices
    const devices = await rtcManager.enumerateDevices();
    
    // Populate microphone dropdown
    const micSelect = document.getElementById('microphone-select');
    micSelect.innerHTML = '<option value="">Default</option>';
    devices.audioInputs.forEach(device => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = device.label || `Microphone ${device.deviceId.substring(0, 8)}`;
      if (device.deviceId === rtcManager.currentSettings.selectedMicrophone) {
        option.selected = true;
      }
      micSelect.appendChild(option);
    });

    // Populate camera dropdown
    const cameraSelect = document.getElementById('camera-select');
    cameraSelect.innerHTML = '<option value="">Default</option>';
    devices.videoInputs.forEach(device => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = device.label || `Camera ${device.deviceId.substring(0, 8)}`;
      if (device.deviceId === rtcManager.currentSettings.selectedCamera) {
        option.selected = true;
      }
      cameraSelect.appendChild(option);
    });

    // Load current settings into form
    const settings = rtcManager.currentSettings;
    document.getElementById('audio-codec-select').value = settings.audioCodec;
    document.getElementById('video-codec-select').value = settings.videoCodec;
    document.getElementById('audio-bitrate-select').value = settings.audioBitrate;
    document.getElementById('video-bitrate-select').value = settings.videoBitrate;
    document.getElementById('audio-channels-select').value = settings.audioChannels;
    document.getElementById('video-resolution-select').value = settings.videoResolution;
    document.getElementById('video-framerate-select').value = settings.videoFramerate;
    document.getElementById('sample-rate-select').value = settings.sampleRate;
    
    document.getElementById('echo-cancellation').checked = settings.echoCancellation;
    document.getElementById('noise-suppression').checked = settings.noiseSuppression;
    document.getElementById('auto-gain-control').checked = settings.autoGainControl;
    document.getElementById('stereo-enabled').checked = settings.stereoEnabled;
    document.getElementById('dtx-enabled').checked = settings.dtxEnabled;
    document.getElementById('audio-visualizer-enabled').checked = settings.audioVisualizerEnabled;
  }

  async applySettings() {
    try {
      const newSettings = {
        selectedMicrophone: document.getElementById('microphone-select').value,
        selectedCamera: document.getElementById('camera-select').value,
        audioCodec: document.getElementById('audio-codec-select').value,
        videoCodec: document.getElementById('video-codec-select').value,
        audioBitrate: parseInt(document.getElementById('audio-bitrate-select').value),
        videoBitrate: parseInt(document.getElementById('video-bitrate-select').value),
        audioChannels: parseInt(document.getElementById('audio-channels-select').value),
        videoResolution: document.getElementById('video-resolution-select').value,
        videoFramerate: parseInt(document.getElementById('video-framerate-select').value),
        sampleRate: parseInt(document.getElementById('sample-rate-select').value),
        echoCancellation: document.getElementById('echo-cancellation').checked,
        noiseSuppression: document.getElementById('noise-suppression').checked,
        autoGainControl: document.getElementById('auto-gain-control').checked,
        stereoEnabled: document.getElementById('stereo-enabled').checked,
        dtxEnabled: document.getElementById('dtx-enabled').checked,
        audioVisualizerEnabled: document.getElementById('audio-visualizer-enabled').checked
      };

      // Update settings
      rtcManager.updateSettings(newSettings);

      // Check if device change is needed
      const currentSettings = rtcManager.currentSettings;
      const deviceChanged = 
        newSettings.selectedMicrophone !== currentSettings.selectedMicrophone ||
        newSettings.selectedCamera !== currentSettings.selectedCamera;

      if (deviceChanged) {
        // Reinitialize media with new settings
        await rtcManager.initializeMedia();
        NotificationManager.show('Settings applied and devices updated', 'success');
      } else {
        NotificationManager.show('Settings applied successfully', 'success');
      }

      this.toggleSettingsPanel();
    } catch (error) {
      console.error('Error applying settings:', error);
      NotificationManager.show('Failed to apply settings', 'error');
    }
  }

  resetSettings() {
    if (confirm('Are you sure you want to reset all settings to default?')) {
      rtcManager.resetSettings();
      this.loadSettingsPanel();
      NotificationManager.show('Settings reset to default', 'info');
    }
  }

  toggleFullscreen(socketId) {
    const container = socketId === 'local' ? 
      document.getElementById('local-container') : 
      document.getElementById(`video-${socketId}`);
    
    if (!container) return;

    if (!this.isFullscreen) {
      // Enter fullscreen
      if (container.requestFullscreen) {
        container.requestFullscreen();
      } else if (container.webkitRequestFullscreen) {
        container.webkitRequestFullscreen();
      } else if (container.msRequestFullscreen) {
        container.msRequestFullscreen();
      }
      
      // Add fullscreen class for styling
      container.classList.add('fullscreen-active');
      this.isFullscreen = true;
      
      // Hide other UI elements
      document.getElementById('header')?.classList.add('hidden');
      document.getElementById('controls')?.classList.add('hidden');
      document.getElementById('chat-panel')?.classList.add('hidden');
      
      NotificationManager.show('Press ESC to exit fullscreen', 'info');
    } else {
      // Exit fullscreen
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      } else if (document.msExitFullscreen) {
        document.msExitFullscreen();
      }
    }
  }

  handleFullscreenChange() {
    const isCurrentlyFullscreen = !!(
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.msFullscreenElement
    );

    if (!isCurrentlyFullscreen && this.isFullscreen) {
      // Exited fullscreen
      this.isFullscreen = false;
      
      // Remove fullscreen class
      document.querySelectorAll('.fullscreen-active').forEach(el => {
        el.classList.remove('fullscreen-active');
      });
      
      // Show UI elements
      document.getElementById('header')?.classList.remove('hidden');
      document.getElementById('controls')?.classList.remove('hidden');
      
      NotificationManager.show('Exited fullscreen', 'info');
    }
  }

  toggleConnectionStats() {
    this.connectionStatsEnabled = !this.connectionStatsEnabled;
    const overlay = document.getElementById('connection-stats-overlay');
    const btn = document.getElementById('stats-toggle-btn');
    
    if (this.connectionStatsEnabled) {
      overlay.classList.remove('hidden');
      btn.classList.add('active');
      rtcManager.startConnectionStats();
      NotificationManager.show('Connection stats enabled', 'info');
    } else {
      overlay.classList.add('hidden');
      btn.classList.remove('active');
      rtcManager.stopConnectionStats();
      NotificationManager.show('Connection stats disabled', 'info');
    }
  }

  updateAdminPanel() {
    // This would be populated with actual user data from the server
    const adminUsers = document.getElementById('admin-users');
    adminUsers.innerHTML = '<p>Admin controls will be populated with connected users</p>';
  }

  setHost(isHost) {
    this.isHost = isHost;
    
    // Update local host badge
    const localHostBadge = document.querySelector('#local-container .host-badge');
    if (localHostBadge) {
      localHostBadge.style.display = isHost ? 'inline' : 'none';
      localHostBadge.title = this.t('hostBadge');
    }
    
    // Show/hide kick buttons for all remote users
    const kickButtons = document.querySelectorAll('.kick-btn');
    kickButtons.forEach(btn => {
      btn.style.display = isHost ? 'inline-block' : 'none';
    });
    
    // Settings button should be visible for ALL users
    const settingsBtn = document.getElementById('settings-btn');
    if (settingsBtn) {
      settingsBtn.style.display = 'block';
      settingsBtn.style.visibility = 'visible';
      settingsBtn.style.opacity = '1';
    }
    
    // Show host status notification
    if (isHost) {
      NotificationManager.show(`👑 ${this.t('youAreHost')}`, 'info');
    }
  }

  kickUser(socketId) {
    if (!this.isHost) {
      const errorMsg = this.currentLanguage === 'ru' ? 
        'Только владелец комнаты может исключать пользователей' : 
        'Only the room owner can kick users';
      NotificationManager.show(errorMsg, 'error');
      return;
    }
    
    const userName = document.getElementById(`name-${socketId}`)?.textContent || 'User';
    const confirmMsg = this.currentLanguage === 'ru' ? 
      `Вы уверены, что хотите исключить ${userName}?` : 
      `Are you sure you want to kick ${userName}?`;
    
    if (confirm(confirmMsg)) {
      socketManager.emit('kick-user', { targetSocketId: socketId });
      NotificationManager.show(`${userName} ${this.t('userKicked')}`, 'info');
    }
  }

  changeTheme(theme) {
    document.body.className = theme;
    this.currentTheme = theme;
    localStorage.setItem('zloer-theme', theme);
  }

  cycleTheme() {
    const themes = ['theme-default', 'theme-dark', 'theme-gaming', 'theme-neon'];
    const currentIndex = themes.indexOf(this.currentTheme);
    const nextIndex = (currentIndex + 1) % themes.length;
    this.changeTheme(themes[nextIndex]);
  }

  loadTheme() {
    const savedTheme = localStorage.getItem('zloer-theme');
    if (savedTheme) {
      this.changeTheme(savedTheme);
      document.getElementById('theme-select').value = savedTheme;
    }
  }

  leaveRoom() {
    if (confirm('Are you sure you want to leave the room?')) {
      rtcManager.cleanup();
      window.location.reload();
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Notification Manager Class
class NotificationManager {
  static show(message, type = 'info', duration = 5000) {
    const notifications = document.getElementById('notifications');
    
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    
    notifications.appendChild(notification);
    
    // Auto remove after duration
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, duration);
    
    // Click to dismiss
    notification.addEventListener('click', () => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    });
  }
}

// Global instances
const socketManager = new SocketManager();
const rtcManager = new RTCManager();
const uiManager = new UIManager();

// Make instances globally accessible for debugging and fixes
window.socketManager = socketManager;
window.rtcManager = rtcManager;
window.uiManager = uiManager;

// Global debug functions for camera visibility issues
window.debugCamera = function() {
  if (window.rtcManager && window.rtcManager.debugCameraVisibility) {
    window.rtcManager.debugCameraVisibility();
  } else {
    console.error('RTC Manager not available');
  }
};

window.debugTransceivers = function() {
  if (window.rtcManager && window.rtcManager.logTransceiverStates) {
    window.rtcManager.logTransceiverStates();
  } else {
    console.error('RTC Manager not available');
  }
};

window.forceRefreshVideo = function() {
  if (window.rtcManager && window.rtcManager.forceRefreshVideoTracks) {
    window.rtcManager.forceRefreshVideoTracks();
  } else {
    console.error('RTC Manager not available');
  }
};

window.emergencyRestore = function() {
  if (window.rtcManager && window.rtcManager.emergencyRestoreConnections) {
    window.rtcManager.emergencyRestoreConnections();
  } else {
    console.error('RTC Manager not available');
  }
};

console.log('🐛 Debug functions available: debugCamera(), debugTransceivers(), forceRefreshVideo(), emergencyRestore()');
console.log('💡 If everything disappears when new user joins, run emergencyRestore()');

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
  uiManager.init();
  
  // Hide loading screen initially
  setTimeout(() => {
    document.getElementById('loading-screen').style.display = 'none';
  }, 1000);
});

// Socket event handlers - Override the connect method
socketManager.connect = function() {
  console.log('Attempting to connect to server...');
  this.socket = io();
  
  // Set up basic socket events
  this.socket.on('connect', () => {
    this.isConnected = true;
    console.log('✅ Connected to server successfully');
    NotificationManager.show(`🎮 ${uiManager.t('connected')}`, 'success');
  });

  this.socket.on('disconnect', () => {
    this.isConnected = false;
    console.log('❌ Disconnected from server');
    NotificationManager.show('Connection lost', 'error');
  });

  this.socket.on('kicked', () => {
    NotificationManager.show(`❌ ${uiManager.t('youWereKicked')}`, 'error');
    setTimeout(() => {
      window.location.reload();
    }, 2000);
  });

  this.socket.on('force-mute', () => {
    rtcManager.muteAudio();
    NotificationManager.show('You have been muted by the host', 'info');
  });
  
  // WebRTC signaling
  this.socket.on('existing-users', (data) => {
    console.log('✅ Existing users received:', data);
    
    // Update ICE servers configuration from server
    if (data.iceServers) {
      rtcManager.updateIceServers(data.iceServers);
    }
    
    uiManager.setHost(data.isHost);
    uiManager.updateUserCount(data.users.length + 1);
    
    if (data.users.length > 0) {
      NotificationManager.show(`🎮 ${uiManager.t('foundGamers')} ${data.users.length} ${uiManager.t('gamersInRoom')}`, 'success');
    } else {
      NotificationManager.show(`🎮 ${uiManager.t('firstGamer')}`, 'info');
    }
    
    // Handle existing users as objects with socketId and nickname
    data.users.forEach(user => {
      console.log('📞 Creating offer for:', user.socketId, 'nickname:', user.nickname);
      // Store user info before creating connection
      rtcManager.storeUserInfo(user.socketId, { nickname: user.nickname });
      rtcManager.createOffer(user.socketId);
    });
  });
  
  this.socket.on('user-joined', (data) => {
    console.log('👋 User joined:', data);
    
    // Update ICE servers configuration from server
    if (data.iceServers) {
      rtcManager.updateIceServers(data.iceServers);
    }
    
    // Store user info before any connection attempts
    rtcManager.storeUserInfo(data.socketId, { nickname: data.nickname });
    
    uiManager.updateUserCount(uiManager.userCount + 1);
    NotificationManager.show(`🎮 ${data.nickname} ${uiManager.t('joinedSession')}`, 'success');
  });
  
  this.socket.on('user-left', (data) => {
    console.log('👋 User left:', data);
    rtcManager.removePeer(data.socketId);
    uiManager.updateUserCount(uiManager.userCount - 1);
  });
  
  this.socket.on('signal', async (data) => {
    console.log('📡 Signal received:', data.signal.type, 'from:', data.from);
    const { from, signal } = data;
    
    try {
      switch (signal.type) {
        case 'offer':
          await rtcManager.handleOffer(from, signal.offer);
          break;
        case 'answer':
          await rtcManager.handleAnswer(from, signal.answer);
          break;
        case 'ice-candidate':
          await rtcManager.handleIceCandidate(from, signal.candidate);
          break;
        case 'renegotiate-offer':
          await rtcManager.handleRenegotiateOffer(from, signal.offer);
          break;
        case 'renegotiate-answer':
          await rtcManager.handleRenegotiateAnswer(from, signal.answer);
          break;
        default:
          console.warn(`Unknown signal type: ${signal.type}`);
      }
    } catch (error) {
      console.error('❌ Error handling signal:', error);
    }
  });
  
  this.socket.on('chat-message', (data) => {
    uiManager.addChatMessage(data);
  });
  
  this.socket.on('host-transferred', () => {
    uiManager.setHost(true);
    NotificationManager.show(`🎮 ${uiManager.t('hostPowerUp')}`, 'success');
  });
  
  this.socket.on('new-host', (data) => {
    // Update UI to show new host
    console.log('👑 New host:', data.hostId);
  });
  
  this.socket.on('room-joined', (data) => {
    console.log('🏠 Room joined successfully:', data);
    
    // Update ICE servers configuration from server
    if (data.iceServers) {
      rtcManager.updateIceServers(data.iceServers);
    }
    
    uiManager.setHost(data.isHost);
    uiManager.updateUserCount(data.userCount);
    
    // FIXED: Update local user nickname after room is joined
    if (data.nickname) {
      uiManager.updateUserName('local', data.nickname);
    }
  });
  
  return this.socket;
};
