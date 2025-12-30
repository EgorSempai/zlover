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

// RTC Manager Class
class RTCManager {
  constructor() {
    this.localStream = null;
    this.peers = new Map(); // socketId -> RTCPeerConnection
    // FIXED: Added ICE candidate queue to handle race conditions
    this.pendingCandidates = new Map(); // socketId -> [candidates]
    this.isAudioMuted = false;
    this.isVideoMuted = false;
    this.isScreenSharing = false;
    this.audioContext = null;
    this.analyser = null;
    this.audioVisualizer = null;
    this.activeSpeaker = null;
    this.availableDevices = { audioInputs: [], videoInputs: [] };
    this.currentSettings = {
      audioCodec: 'opus',
      videoCodec: 'vp9',
      audioBitrate: 128000,
      videoBitrate: 2000000,
      audioChannels: 2,
      sampleRate: 48000,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      stereoEnabled: true,
      dtxEnabled: false,
      selectedMicrophone: '',
      selectedCamera: '',
      videoResolution: '1280x720',
      videoFramerate: 30,
      audioVisualizerEnabled: true
    };
    
    // Dynamic ICE servers configuration - will be updated from server
    this.iceServers = [
      // Fallback STUN servers (will be replaced by server config)
      {
        urls: 'stun:stun.l.google.com:19302'
      }
    ];
    
    // Enhanced diagnostics and monitoring
    this.connectionStats = new Map(); // socketId -> stats
    this.connectionErrors = [];
    this.iceConnectionStates = new Map();
    this.lastStatsUpdate = 0;
    this.statsInterval = null;
    
    // Start connection monitoring
    this.startConnectionMonitoring();
  }

  // FIXED: Add missing updateIceServers method
  updateIceServers(iceServers) {
    if (iceServers && Array.isArray(iceServers)) {
      this.iceServers = iceServers;
      console.log('🔄 Updated ICE servers configuration:', iceServers);
      
      // Log TURN server details for debugging
      iceServers.forEach((server, index) => {
        if (server.urls.includes('turn:') || server.urls.includes('turns:')) {
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

  // FIXED: Optimized TURN connectivity test with fewer servers
  async testTurnConnectivity() {
    console.log('🧪 Testing TURN server connectivity (optimized)...');
    
    // Use only essential servers for testing
    const testConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        {
          urls: 'turn:openrelay.metered.ca:80',
          username: 'openrelayproject',
          credential: 'openrelayproject'
        }
      ],
      iceCandidatePoolSize: 2 // Minimal for testing
    };
    
    const testPc = new RTCPeerConnection(testConfig);
    
    return new Promise((resolve) => {
      let hasRelayCandidate = false;
      let timeout;
      
      testPc.onicecandidate = (event) => {
        if (event.candidate) {
          console.log(`🧊 Test ICE candidate:`, {
            type: event.candidate.type,
            protocol: event.candidate.protocol
          });
          
          if (event.candidate.type === 'relay') {
            hasRelayCandidate = true;
            console.log('✅ TURN relay candidate found - TURN servers are working!');
          }
        } else {
          // ICE gathering complete
          clearTimeout(timeout);
          if (hasRelayCandidate) {
            console.log('✅ TURN connectivity test passed');
            resolve(true);
          } else {
            console.warn('⚠️ No TURN relay candidates found - TURN servers may not be working');
            resolve(false);
          }
          testPc.close();
        }
      };
      
      // Create a data channel to trigger ICE gathering
      testPc.createDataChannel('test');
      
      // Create offer to start ICE gathering
      testPc.createOffer().then(offer => {
        return testPc.setLocalDescription(offer);
      }).catch(error => {
        console.error('❌ Error creating test offer:', error);
        resolve(false);
      });
      
      // Shorter timeout for faster testing
      timeout = setTimeout(() => {
        console.warn('⚠️ TURN connectivity test timed out');
        testPc.close();
        resolve(false);
      }, 5000); // Reduced from 10s to 5s
    });
  }

  // Update ICE servers configuration from server
  updateIceServers(iceServers) {
    this.iceServers = iceServers;
    console.log('🔄 Updated ICE servers configuration:', iceServers);
    
    // Log TURN server details for debugging
    iceServers.forEach((server, index) => {
      if (server.urls.includes('turn:') || server.urls.includes('turns:')) {
        console.log(`🔄 TURN Server ${index + 1}:`, {
          url: server.urls,
          username: server.username,
          hasCredential: !!server.credential,
          credentialLength: server.credential ? server.credential.length : 0
        });
        
        // Test TURN server connectivity
        this.testTurnServer(server);
      }
    });
  }

  // Test TURN server connectivity
  async testTurnServer(turnConfig) {
    try {
      console.log('🧪 Testing TURN server connectivity for:', turnConfig.urls);
      
      // Create a test peer connection with only this TURN server
      const testConfig = {
        iceServers: [turnConfig],
        iceTransportPolicy: 'relay' // Force TURN usage
      };
      
      const testPc = new RTCPeerConnection(testConfig);
      
      // Add a dummy data channel to trigger ICE gathering
      testPc.createDataChannel('test');
      
      // Monitor ICE gathering
      testPc.onicecandidate = (event) => {
        if (event.candidate) {
          console.log('🧊 ICE candidate type:', event.candidate.type, 'for', turnConfig.urls);
          if (event.candidate.type === 'relay') {
            console.log('✅ TURN relay candidate found - TURN server is working!');
          }
        } else {
          console.log('🏁 ICE gathering complete for', turnConfig.urls);
        }
      };
      
      testPc.onicegatheringstatechange = () => {
        console.log('🔄 ICE gathering state:', testPc.iceGatheringState, 'for', turnConfig.urls);
      };
      
      // Create offer to start ICE gathering
      const offer = await testPc.createOffer();
      await testPc.setLocalDescription(offer);
      
      // Clean up after 10 seconds
      setTimeout(() => {
        testPc.close();
      }, 10000);
      
    } catch (error) {
      console.error('❌ TURN server test failed for', turnConfig.urls, ':', error);
    }
  }

  // Get current RTC configuration with optimized ICE servers
  getRTCConfiguration() {
    // FIXED: Using verified configuration from the working project (Zloer Main)
    const iceServers = [
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

    console.log('🔗 Using FIXED ICE servers configuration:', iceServers);
    
    return {
      iceServers: iceServers,
      iceTransportPolicy: 'all',
      iceCandidatePoolSize: 2,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require'
    };
  }
  startConnectionMonitoring() {
    // Monitor connection stats every 5 seconds
    this.statsInterval = setInterval(() => {
      this.updateConnectionStats();
    }, 5000);

    // Monitor ICE connection states and verify TURN usage
    setInterval(() => {
      this.monitorIceStates();
      this.verifyTurnUsage();
    }, 2000);
  }

  // Verify that connections are using TURN relay
  async verifyTurnUsage() {
    for (const [socketId, peer] of this.peers) {
      if (peer.connectionState === 'connected') {
        try {
          const stats = await peer.getStats();
          stats.forEach(report => {
            if (report.type === 'candidate-pair' && report.state === 'succeeded') {
              const localType = report.localCandidate ? report.localCandidate.candidateType : 'unknown';
              const remoteType = report.remoteCandidate ? report.remoteCandidate.candidateType : 'unknown';
              
              if (localType === 'relay' || remoteType === 'relay') {
                console.log(`✅ Using TURN Relay for ${socketId} (Secure Connection)`);
              } else {
                console.log(`⚡ Direct Connection (P2P) for ${socketId} - Best Performance`);
              }
            }
          });
        } catch (error) {
          // Ignore stats errors
        }
      }
    }
  }

  async updateConnectionStats() {
    try {
      const allStats = {};
      let totalBitrate = 0;
      let totalPacketLoss = 0;
      let totalRTT = 0;
      let peerCount = 0;

      for (const [socketId, peer] of this.peers) {
        if (peer.connectionState === 'connected') {
          const stats = await peer.getStats();
          const peerStats = this.parseWebRTCStats(stats);
          
          allStats[socketId] = peerStats;
          totalBitrate += peerStats.bitrate || 0;
          totalPacketLoss += peerStats.packetLoss || 0;
          totalRTT += peerStats.rtt || 0;
          peerCount++;
        }
      }

      // Calculate averages
      const avgStats = {
        avgBitrate: peerCount > 0 ? totalBitrate / peerCount : 0,
        avgPacketLoss: peerCount > 0 ? totalPacketLoss / peerCount : 0,
        avgRTT: peerCount > 0 ? totalRTT / peerCount : 0,
        peersCount: peerCount,
        timestamp: Date.now()
      };

      this.connectionStats.set('average', avgStats);
      
      // Send stats to server for monitoring
      if (socketManager && socketManager.isConnected) {
        socketManager.emit('webrtc-stats', avgStats);
      }

      // Log poor connection quality
      if (avgStats.avgPacketLoss > 5 || avgStats.avgRTT > 500) {
        console.warn('⚠️ Poor WebRTC connection quality detected:', avgStats);
        this.handlePoorConnectionQuality(avgStats);
      }

    } catch (error) {
      console.error('Error updating connection stats:', error);
    }
  }

  parseWebRTCStats(stats) {
    let bitrate = 0;
    let packetLoss = 0;
    let rtt = 0;
    let bytesReceived = 0;
    let bytesSent = 0;

    stats.forEach(report => {
      if (report.type === 'inbound-rtp' && report.mediaType === 'video') {
        bitrate += report.bytesReceived * 8 / 1000; // Convert to kbps
        bytesReceived += report.bytesReceived || 0;
        packetLoss += report.packetsLost || 0;
      }
      
      if (report.type === 'outbound-rtp' && report.mediaType === 'video') {
        bytesSent += report.bytesSent || 0;
      }
      
      if (report.type === 'candidate-pair' && report.state === 'succeeded') {
        rtt = report.currentRoundTripTime * 1000 || 0; // Convert to ms
      }
    });

    return { bitrate, packetLoss, rtt, bytesReceived, bytesSent };
  }

  monitorIceStates() {
    for (const [socketId, peer] of this.peers) {
      const currentState = peer.iceConnectionState;
      const previousState = this.iceConnectionStates.get(socketId);
      
      if (currentState !== previousState) {
        console.log(`🧊 ICE connection state changed for ${socketId}: ${previousState} → ${currentState}`);
        this.iceConnectionStates.set(socketId, currentState);
        
        // Handle connection state changes
        this.handleIceStateChange(socketId, currentState, previousState);
      }
    }
  }

  handleIceStateChange(socketId, newState, oldState) {
    switch (newState) {
      case 'connected':
        console.log(`✅ WebRTC connection established with ${socketId}`);
        NotificationManager.show('Peer connected', 'success');
        // Verify TURN usage
        this.logConnectionType(socketId);
        break;
      case 'disconnected':
        console.warn(`⚠️ WebRTC connection lost with ${socketId}`);
        NotificationManager.show('Peer connection lost', 'warning');
        break;
      case 'failed':
        console.error(`❌ WebRTC connection failed with ${socketId}`);
        console.error('ICE connection failed - check TURN server configuration');
        NotificationManager.show('Connection failed - check TURN server', 'error');
        this.handleConnectionFailure(socketId);
        break;
      case 'closed':
        console.log(`🔒 WebRTC connection closed with ${socketId}`);
        break;
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

  // Log connection type for debugging
  async logConnectionType(socketId) {
    const peer = this.peers.get(socketId);
    if (!peer) return;

    try {
      const stats = await peer.getStats();
      stats.forEach(report => {
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          console.log(`🔗 Connection type for ${socketId}:`, {
            local: report.localCandidate?.candidateType,
            remote: report.remoteCandidate?.candidateType,
            transport: report.localCandidate?.protocol
          });
        }
      });
    } catch (error) {
      console.error('Error getting connection stats:', error);
    }
  }

  handleConnectionFailure(socketId) {
    // Attempt to restart ICE
    const peer = this.peers.get(socketId);
    if (peer) {
      console.log(`🔄 Attempting ICE restart for ${socketId}`);
      peer.restartIce();
      
      // Log the failure for diagnostics
      this.connectionErrors.push({
        socketId,
        error: 'ICE connection failed',
        timestamp: Date.now(),
        iceState: peer.iceConnectionState,
        connectionState: peer.connectionState
      });
    }
  }

  handlePoorConnectionQuality(stats) {
    // Could implement adaptive bitrate or quality reduction
    console.log('🔧 Implementing quality adjustments for poor connection');
    
    // Reduce video bitrate if packet loss is high
    if (stats.avgPacketLoss > 10) {
      this.currentSettings.videoBitrate = Math.max(500000, this.currentSettings.videoBitrate * 0.7);
      console.log(`📉 Reduced video bitrate to ${this.currentSettings.videoBitrate}`);
    }
  }

  getConnectionStats() {
    return {
      peers: this.peers.size,
      connectionStates: Array.from(this.iceConnectionStates.entries()),
      averageStats: this.connectionStats.get('average'),
      recentErrors: this.connectionErrors.slice(-5), // Last 5 errors
      timestamp: Date.now()
    };
  }

  // Enhanced error handling for WebRTC operations
  async handleWebRTCEsrror(error, operation, socketId = null) {
    const errorInfo = {
      operation,
      socketId,
      error: error.message,
      name: error.name,
      timestamp: Date.now()
    };
    
    this.connectionErrors.push(errorInfo);
    console.error(`WebRTC Error in ${operation}:`, error);
    
    // Specific error handling
    switch (error.name) {
      case 'NotAllowedError':
        NotificationManager.show('Camera/microphone access denied', 'error');
        break;
      case 'NotFoundError':
        NotificationManager.show('Camera/microphone not found', 'error');
        break;
      case 'OverconstrainedError':
        NotificationManager.show('Camera/microphone constraints not supported', 'error');
        break;
      case 'NotReadableError':
        NotificationManager.show('Camera/microphone already in use', 'error');
        break;
      default:
        NotificationManager.show(`WebRTC error: ${error.message}`, 'error');
    }
    
    return errorInfo;
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

  // High-quality audio constraints (camera off by default)
  getMediaConstraints() {
    const [width, height] = this.currentSettings.videoResolution.split('x').map(Number);
    
    return {
      audio: {
        deviceId: this.currentSettings.selectedMicrophone ? 
          { exact: this.currentSettings.selectedMicrophone } : undefined,
        echoCancellation: this.currentSettings.echoCancellation,
        noiseSuppression: this.currentSettings.noiseSuppression,
        autoGainControl: this.currentSettings.autoGainControl,
        sampleRate: this.currentSettings.sampleRate,
        channelCount: this.currentSettings.audioChannels,
        volume: 1.0,
        latency: 0.01
      },
      video: false // Start with camera off by default
    };
  }

  updateSettings(newSettings) {
    this.currentSettings = { ...this.currentSettings, ...newSettings };
    console.log('Settings updated:', this.currentSettings);
    
    // Save settings to localStorage
    localStorage.setItem('zloer-settings', JSON.stringify(this.currentSettings));
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

  resetSettings() {
    this.currentSettings = {
      audioCodec: 'opus',
      videoCodec: 'vp9',
      audioBitrate: 128000,
      videoBitrate: 2000000,
      audioChannels: 2,
      sampleRate: 48000,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      stereoEnabled: true,
      dtxEnabled: false,
      selectedMicrophone: '',
      selectedCamera: '',
      videoResolution: '1280x720',
      videoFramerate: 30,
      audioVisualizerEnabled: true
    };
    
    localStorage.removeItem('zloer-settings');
    console.log('Settings reset to default');
  }
  async initializeMedia() {
    try {
      // Load saved settings
      this.loadSettings();
      
      // Enumerate devices first
      await this.enumerateDevices();
      
      // FIXED: Start with both audio AND video enabled by default
      const constraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,
          channelCount: 2
        },
        video: {
          width: { ideal: 1280, max: 1920 },
          height: { ideal: 720, max: 1080 },
          frameRate: { ideal: 30, max: 30 }
        }
      };
      
      console.log('🎤 Requesting media with constraints:', constraints);
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      
      // Initialize audio visualizer
      await this.initializeAudioVisualizer();
      
      // Add local video to UI
      uiManager.addLocalVideo(this.localStream);
      
      // FIXED: Set initial states properly
      this.isVideoMuted = false;
      this.isAudioMuted = false;
      uiManager.updateVideoButton(this.isVideoMuted);
      uiManager.updateMuteButton(this.isAudioMuted);
      
      console.log('✅ Media initialized successfully with audio and video');
      
      // FIXED: Test TURN connectivity after media initialization
      setTimeout(() => {
        this.testTurnConnectivity();
      }, 2000);
      
      return true;
    } catch (error) {
      console.error('Error accessing media devices:', error);
      
      // FIXED: Try with audio only as fallback
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
        
        await this.initializeAudioVisualizer();
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

  async switchDevice(deviceType, deviceId) {
    try {
      if (deviceType === 'microphone') {
        this.currentSettings.selectedMicrophone = deviceId;
      } else if (deviceType === 'camera') {
        this.currentSettings.selectedCamera = deviceId;
      }

      // Stop current stream
      if (this.localStream) {
        this.localStream.getTracks().forEach(track => track.stop());
      }

      // Get new stream with updated device
      const constraints = this.getMediaConstraints();
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);

      // Update local video
      const localVideo = document.getElementById('local-video');
      if (localVideo) {
        localVideo.srcObject = this.localStream;
      }

      // Reinitialize audio visualizer
      await this.initializeAudioVisualizer();

      // Update all peer connections with new stream
      this.peers.forEach(async (pc) => {
        const senders = pc.getSenders();
        const tracks = this.localStream.getTracks();

        for (const track of tracks) {
          const sender = senders.find(s => s.track && s.track.kind === track.kind);
          if (sender) {
            await sender.replaceTrack(track);
          } else {
            pc.addTrack(track, this.localStream);
          }
        }
      });

      NotificationManager.show(`${deviceType} switched successfully`, 'success');
      return true;
    } catch (error) {
      console.error(`Error switching ${deviceType}:`, error);
      NotificationManager.show(`Failed to switch ${deviceType}`, 'error');
      return false;
    }
  }

  async testDevice(deviceType, deviceId) {
    try {
      const constraints = deviceType === 'microphone' ? 
        { audio: { deviceId: { exact: deviceId } } } :
        { video: { deviceId: { exact: deviceId } } };

      const testStream = await navigator.mediaDevices.getUserMedia(constraints);
      
      // Create test video element
      const testVideo = document.createElement('video');
      testVideo.srcObject = testStream;
      testVideo.autoplay = true;
      testVideo.muted = true;
      testVideo.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        width: 200px;
        height: 150px;
        border: 2px solid var(--primary-color);
        border-radius: 8px;
        z-index: 10000;
        background: #000;
      `;

      document.body.appendChild(testVideo);

      // Remove test video after 5 seconds
      setTimeout(() => {
        testStream.getTracks().forEach(track => track.stop());
        document.body.removeChild(testVideo);
      }, 5000);

      NotificationManager.show(`Testing ${deviceType} for 5 seconds`, 'info');
      return true;
    } catch (error) {
      console.error(`Error testing ${deviceType}:`, error);
      NotificationManager.show(`Failed to test ${deviceType}`, 'error');
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

  createPeerConnection(socketId) {
    const config = this.getRTCConfiguration();
    const pc = new RTCPeerConnection(config);
    
    console.log('🔗 Creating peer connection with config:', config);
    
    // FIXED: Initialize pending candidates queue for this peer
    this.pendingCandidates.set(socketId, []);
    
    // Add local stream tracks with enhanced settings
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        const sender = pc.addTrack(track, this.localStream);
        
        // Configure audio encoding parameters for better quality
        if (track.kind === 'audio') {
          const params = sender.getParameters();
          if (params.encodings && params.encodings.length > 0) {
            params.encodings[0].maxBitrate = 128000; // 128 kbps for high-quality audio
          }
          sender.setParameters(params).catch(console.error);
        }
      });
    }

    // Handle incoming tracks
    pc.ontrack = (event) => {
      const [remoteStream] = event.streams;
      uiManager.addRemoteVideo(socketId, remoteStream);
      
      // Set up remote audio analysis for active speaker detection
      this.setupRemoteAudioAnalysis(socketId, remoteStream);
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
        console.error(`❌ Connection failed with ${socketId}, attempting ICE restart`);
        this.handleConnectionFailure(socketId);
      } else if (pc.connectionState === 'disconnected') {
        console.warn(`⚠️ Connection disconnected with ${socketId}, monitoring for recovery`);
        // Give it 10 seconds to recover before attempting restart
        setTimeout(() => {
          if (pc.connectionState === 'disconnected') {
            console.log(`🔄 Attempting ICE restart for ${socketId} after timeout`);
            this.handleConnectionFailure(socketId);
          }
        }, 10000);
      } else if (pc.connectionState === 'connected') {
        console.log(`✅ Connection established with ${socketId}`);
        NotificationManager.show('Peer connected successfully', 'success');
        // FIXED: Process any pending candidates now that connection is established
        this.processPendingCandidates(socketId);
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
          uiManager.updateRemoteAudioVisualizer(socketId, average, dataArray);
          
          // Detect active speaker
          if (average > 30) {
            this.activeSpeaker = socketId;
            uiManager.setActiveSpeaker(socketId);
          }
        };
        
        analyze();
      }
    } catch (error) {
      console.error('Error setting up remote audio analysis:', error);
    }
  }

  async createOffer(socketId) {
    const pc = this.createPeerConnection(socketId);
    
    try {
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      
      await pc.setLocalDescription(offer);
      
      socketManager.emit('signal', {
        to: socketId,
        signal: {
          type: 'offer',
          offer: offer
        }
      });
    } catch (error) {
      console.error('Error creating offer:', error);
    }
  }

  async handleOffer(socketId, offer) {
    const pc = this.createPeerConnection(socketId);
    
    try {
      await pc.setRemoteDescription(offer);
      
      // FIXED: Process pending candidates after setting remote description
      this.processPendingCandidates(socketId);
      
      const answer = await pc.createAnswer();
      
      await pc.setLocalDescription(answer);
      
      socketManager.emit('signal', {
        to: socketId,
        signal: {
          type: 'answer',
          answer: answer
        }
      });
    } catch (error) {
      console.error('Error handling offer:', error);
      // FIXED: Clean up on error
      this.removePeer(socketId);
    }
  }

  enhanceAudioSDP(sdp) {
    let enhancedSDP = sdp;
    
    // Configure based on current settings
    const { audioCodec, audioBitrate, audioChannels, stereoEnabled, dtxEnabled } = this.currentSettings;
    
    if (audioCodec === 'opus') {
      // Set Opus parameters
      const opusParams = [
        `maxaveragebitrate=${audioBitrate}`,
        audioChannels === 2 && stereoEnabled ? 'stereo=1' : 'stereo=0',
        audioChannels === 2 && stereoEnabled ? 'sprop-stereo=1' : 'sprop-stereo=0',
        dtxEnabled ? 'usedtx=1' : 'usedtx=0'
      ].join(';');
      
      enhancedSDP = enhancedSDP.replace(
        /(a=fmtp:\d+ .*)/g,
        `$1;${opusParams}`
      );
      
      // Prefer Opus codec
      enhancedSDP = enhancedSDP.replace(
        /(m=audio \d+ UDP\/TLS\/RTP\/SAVPF) (\d+)/g,
        (match, prefix, codecId) => {
          const codecs = enhancedSDP.match(/a=rtpmap:(\d+) opus/);
          if (codecs) {
            const opusId = codecs[1];
            return `${prefix} ${opusId}`;
          }
          return match;
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
            /(m=audio \d+ UDP\/TLS\/RTP\/SAVPF) (\d+)/g,
            `$1 ${codecId}`
          );
        }
      }
    }
    
    return enhancedSDP;
  }

  enhanceVideoSDP(sdp) {
    let enhancedSDP = sdp;
    
    const { videoCodec, videoBitrate } = this.currentSettings;
    
    // Set video bitrate
    enhancedSDP = enhancedSDP.replace(
      /(a=fmtp:\d+ .*)/g,
      `$1;x-google-max-bitrate=${Math.floor(videoBitrate / 1000)}`
    );
    
    // Prefer selected video codec
    const codecMap = {
      'vp8': 'VP8',
      'vp9': 'VP9',
      'h264': 'H264',
      'av1': 'AV1'
    };
    
    const codecName = codecMap[videoCodec];
    if (codecName) {
      const codecRegex = new RegExp(`a=rtpmap:(\\d+) ${codecName}`, 'i');
      const codecs = enhancedSDP.match(codecRegex);
      if (codecs) {
        const codecId = codecs[1];
        enhancedSDP = enhancedSDP.replace(
          /(m=video \d+ UDP\/TLS\/RTP\/SAVPF) (\d+)/g,
          `$1 ${codecId}`
        );
      }
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
        
        // Update all peer connections
        this.peers.forEach(async (pc) => {
          pc.addTrack(newVideoTrack, this.localStream);
        });
        
        this.isVideoMuted = false;
        uiManager.updateVideoButton(this.isVideoMuted);
        uiManager.updateLocalVideoDisplay(false);
        NotificationManager.show(`🎮 ${uiManager.t('cameraEnabled')}`, 'success');
        return true;
        
      } catch (error) {
        console.error('Error enabling camera:', error);
        NotificationManager.show('Failed to enable camera', 'error');
        return false;
      }
    } else {
      // Video track exists, toggle it
      videoTrack.enabled = !videoTrack.enabled;
      this.isVideoMuted = !videoTrack.enabled;
      uiManager.updateVideoButton(this.isVideoMuted);
      uiManager.updateLocalVideoDisplay(this.isVideoMuted);
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
        joinRoom: '� Вройти в комнату',
        beta: 'Бета 1.0',
        telegram: '� ПЗрисоединиться к Telegram',
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

    // Theme selector
    const themeSelect = document.getElementById('theme-select');
    themeSelect.addEventListener('change', (e) => {
      this.changeTheme(e.target.value);
    });

    // Language selector
    const languageSelect = document.getElementById('language-select');
    languageSelect.addEventListener('change', (e) => {
      this.setLanguage(e.target.value);
    });

    // Layout controls
    document.getElementById('layout-grid-btn').addEventListener('click', () => {
      this.setLayoutMode('grid');
    });

    document.getElementById('layout-spotlight-btn').addEventListener('click', () => {
      this.setLayoutMode('spotlight');
    });

    document.getElementById('visualizer-toggle-btn').addEventListener('click', () => {
      this.toggleAudioVisualizer();
    });

    document.getElementById('stats-toggle-btn').addEventListener('click', () => {
      this.toggleConnectionStats();
    });

    // Controls
    document.getElementById('mute-btn').addEventListener('click', () => {
      rtcManager.toggleAudio();
    });

    document.getElementById('video-btn').addEventListener('click', () => {
      rtcManager.toggleVideo();
    });

    document.getElementById('screen-share-btn').addEventListener('click', () => {
      rtcManager.shareScreen();
    });

    document.getElementById('chat-toggle-btn').addEventListener('click', () => {
      this.toggleChat();
    });

    // Header buttons
    document.getElementById('theme-btn').addEventListener('click', () => {
      this.cycleTheme();
    });

    document.getElementById('settings-btn').addEventListener('click', () => {
      this.toggleSettingsPanel();
    });

    // Right-click on settings for admin panel (host only)
    document.getElementById('settings-btn').addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.isHost) {
        this.toggleAdminPanel();
      } else {
        NotificationManager.show('Only the host can access admin controls', 'info');
      }
    });

    document.getElementById('leave-btn').addEventListener('click', () => {
      this.leaveRoom();
    });

    // Copy room link
    document.getElementById('copy-room-btn').addEventListener('click', () => {
      const roomUrl = `${window.location.origin}${window.location.pathname}?room=${this.roomId}`;
      navigator.clipboard.writeText(roomUrl).then(() => {
        NotificationManager.show('Room link copied to clipboard!', 'success');
      }).catch(() => {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = roomUrl;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        NotificationManager.show('Room link copied to clipboard!', 'success');
      });
    });

    // Chat
    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-btn');

    sendBtn.addEventListener('click', () => this.sendMessage());
    chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.sendMessage();
    });

    document.getElementById('chat-close-btn').addEventListener('click', () => {
      this.toggleChat();
    });

    // Admin panel
    document.getElementById('admin-close-btn').addEventListener('click', () => {
      this.toggleAdminPanel();
    });

    // Settings panel
    document.getElementById('settings-close-btn').addEventListener('click', () => {
      this.toggleSettingsPanel();
    });

    // Stats panel
    document.getElementById('stats-close-btn').addEventListener('click', () => {
      this.toggleConnectionStats();
    });

    document.getElementById('apply-settings-btn').addEventListener('click', () => {
      this.applySettings();
    });

    document.getElementById('reset-settings-btn').addEventListener('click', () => {
      this.resetSettings();
    });

    document.getElementById('test-mic-btn').addEventListener('click', () => {
      const deviceId = document.getElementById('microphone-select').value;
      if (deviceId) {
        rtcManager.testDevice('microphone', deviceId);
      }
    });

    document.getElementById('test-camera-btn').addEventListener('click', () => {
      const deviceId = document.getElementById('camera-select').value;
      if (deviceId) {
        rtcManager.testDevice('camera', deviceId);
      }
    });

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
    const nickname = document.getElementById('nickname-input').value.trim();
    const roomId = document.getElementById('room-input').value.trim() || this.generateRoomId();

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
    document.getElementById('loading-screen').style.display = 'flex';

    try {
      // Initialize media
      console.log('Initializing media...');
      const mediaInitialized = await rtcManager.initializeMedia();
      if (!mediaInitialized) {
        console.error('Media initialization failed');
        document.getElementById('loading-screen').style.display = 'none';
        return;
      }
      console.log('Media initialized successfully');

      // Connect to server
      console.log('Connecting to server...');
      socketManager.connect();
      
      // Wait a bit for connection to establish
      setTimeout(() => {
        console.log('Joining room...', { roomId, nickname });
        socketManager.emit('join-room', { roomId, nickname });
      }, 1000);

      // Hide join screen and show app
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
      NotificationManager.show(`Join failed: ${error.message}`, 'error');
      document.getElementById('loading-screen').style.display = 'none';
    }
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
    nameSpan.textContent = `${this.nickname} (You)`;
    
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
  }

  addRemoteVideo(socketId, stream) {
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
    overlay.innerHTML = `
      <span class="user-name" id="name-${socketId}">User</span>
      <div class="video-controls">
        <span class="host-badge" id="host-${socketId}" style="display: none" title="${this.t('hostBadge')}">👑</span>
        <button class="pin-btn" title="Pin/Unpin">📌</button>
        <button class="fullscreen-btn" title="Fullscreen">⛶</button>
        <button class="kick-btn" id="kick-${socketId}" style="display: none" title="${this.t('kickUser')}">❌</button>
      </div>
    `;
    
    videoContainer.appendChild(video);
    videoContainer.appendChild(visualizerCanvas);
    videoContainer.appendChild(overlay);
    videoGrid.appendChild(videoContainer);
    
    // Add kick button event listener
    const kickBtn = document.getElementById(`kick-${socketId}`);
    if (kickBtn) {
      kickBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.kickUser(socketId);
      });
    }
    
    this.updateLayout();
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
    const nameElement = document.getElementById(`name-${socketId}`);
    
    if (nameElement) {
      nameElement.textContent = nickname;
      console.log(`✅ Name updated for ${socketId}: ${nickname}`);
    } else {
      // Retry if element is not yet created
      console.log(`⏳ Waiting for video element for ${socketId}...`);
      setTimeout(() => {
        const retryElement = document.getElementById(`name-${socketId}`);
        if (retryElement) retryElement.textContent = nickname;
      }, 500);
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

  // FIXED: Add missing addRemoteVideo method
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
    video.muted = false; // FIXED: Don't mute remote audio - this was the main issue!
    
    // FIXED: Add error handling for video playback
    video.onerror = (e) => {
      console.error(`Video error for ${socketId}:`, e);
    };
    
    video.onloadedmetadata = () => {
      console.log(`✅ Video metadata loaded for ${socketId}`);
    };
    
    // Create name overlay
    const nameOverlay = document.createElement('div');
    nameOverlay.className = 'name-overlay';
    nameOverlay.id = `name-${socketId}`;
    nameOverlay.textContent = `User ${socketId.substring(0, 8)}`; // Default name, will be updated
    
    // Create controls overlay
    const controlsOverlay = document.createElement('div');
    controlsOverlay.className = 'video-controls';
    
    // Add fullscreen button
    const fullscreenBtn = document.createElement('button');
    fullscreenBtn.className = 'control-btn fullscreen-btn';
    fullscreenBtn.innerHTML = '⛶';
    fullscreenBtn.title = 'Fullscreen';
    
    // Add pin button
    const pinBtn = document.createElement('button');
    pinBtn.className = 'control-btn pin-btn';
    pinBtn.innerHTML = '📌';
    pinBtn.title = 'Pin video';
    
    // FIXED: Add kick button for host
    if (this.isHost) {
      const kickBtn = document.createElement('button');
      kickBtn.className = 'control-btn kick-btn';
      kickBtn.innerHTML = '❌';
      kickBtn.title = this.t('kickUser');
      kickBtn.onclick = (e) => {
        e.stopPropagation();
        this.kickUser(socketId);
      };
      controlsOverlay.appendChild(kickBtn);
    }
    
    controlsOverlay.appendChild(fullscreenBtn);
    controlsOverlay.appendChild(pinBtn);
    
    // FIXED: Create canvas element for audio visualizer instead of div
    const audioVisualizer = document.createElement('canvas');
    audioVisualizer.className = 'audio-visualizer';
    audioVisualizer.id = `visualizer-${socketId}`;
    audioVisualizer.width = 100;
    audioVisualizer.height = 30;
    
    // Assemble the video container
    videoContainer.appendChild(video);
    videoContainer.appendChild(nameOverlay);
    videoContainer.appendChild(controlsOverlay);
    videoContainer.appendChild(audioVisualizer);
    
    videoGrid.appendChild(videoContainer);
    
    console.log(`✅ Remote video added for ${socketId}`);
    
    // FIXED: Force video to play (some browsers require this)
    video.play().catch(e => {
      console.warn(`Auto-play failed for ${socketId}:`, e);
    });
  }

  // FIXED: Add missing updateUserName method
  updateUserName(socketId, nickname) {
    console.log(`📝 Updating name for ${socketId}: ${nickname}`);
    const nameElement = document.getElementById(`name-${socketId}`);
    if (nameElement) {
      nameElement.textContent = nickname;
      console.log(`✅ Name updated for ${socketId}: ${nickname}`);
    } else {
      console.warn(`❌ Name element not found for ${socketId}`);
    }
  }

  // FIXED: Add missing removeVideo method
  removeVideo(socketId) {
    const videoContainer = document.getElementById(`video-${socketId}`);
    if (videoContainer) {
      // FIXED: Stop all tracks before removing
      const video = videoContainer.querySelector('video');
      if (video && video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
      }
      videoContainer.remove();
      console.log(`🗑️ Removed video container for ${socketId}`);
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
    
    // Create offers for existing users
    data.users.forEach(socketId => {
      console.log('📞 Creating offer for:', socketId);
      rtcManager.createOffer(socketId);
    });
  });
  
  this.socket.on('user-joined', (data) => {
    console.log('👋 User joined:', data);
    
    // FIXED: Update ICE servers configuration from server
    if (data.iceServers) {
      rtcManager.updateIceServers(data.iceServers);
    }
    
    uiManager.updateUserCount(uiManager.userCount + 1);
    // FIXED: Update user name immediately when they join
    uiManager.updateUserName(data.socketId, data.nickname);
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
  });
  
  return this.socket;
};
