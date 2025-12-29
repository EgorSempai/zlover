// Zloer Communication System Diagnostics
// Run in browser console: window.ZloerDiagnostics.runFullDiagnostic()

window.ZloerDiagnostics = {
  
  // Run comprehensive system diagnostic
  async runFullDiagnostic() {
    console.log('🔍 Starting Zloer Communication System Diagnostic...\n');
    
    const results = {
      timestamp: new Date().toISOString(),
      browser: this.checkBrowserSupport(),
      network: await this.checkNetworkConnectivity(),
      webrtc: await this.checkWebRTCSupport(),
      media: await this.checkMediaDevices(),
      server: await this.checkServerHealth(),
      socket: this.checkSocketConnection(),
      performance: this.checkPerformance()
    };
    
    this.displayResults(results);
    return results;
  },

  // Check browser WebRTC support
  checkBrowserSupport() {
    const support = {
      webrtc: !!window.RTCPeerConnection,
      getUserMedia: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
      websockets: !!window.WebSocket,
      socketio: !!window.io,
      browser: this.getBrowserInfo()
    };
    
    console.log('🌐 Browser Support:', support);
    return support;
  },

  getBrowserInfo() {
    const ua = navigator.userAgent;
    let browser = 'Unknown';
    
    if (ua.includes('Chrome')) browser = 'Chrome';
    else if (ua.includes('Firefox')) browser = 'Firefox';
    else if (ua.includes('Safari')) browser = 'Safari';
    else if (ua.includes('Edge')) browser = 'Edge';
    
    return {
      name: browser,
      userAgent: ua,
      language: navigator.language,
      platform: navigator.platform,
      cookieEnabled: navigator.cookieEnabled,
      onLine: navigator.onLine
    };
  },

  // Check network connectivity
  async checkNetworkConnectivity() {
    const connectivity = {
      online: navigator.onLine,
      connection: navigator.connection ? {
        effectiveType: navigator.connection.effectiveType,
        downlink: navigator.connection.downlink,
        rtt: navigator.connection.rtt,
        saveData: navigator.connection.saveData
      } : null,
      stunServers: await this.testStunServers()
    };
    
    console.log('🌐 Network Connectivity:', connectivity);
    return connectivity;
  },

  // Test STUN server connectivity
  async testStunServers() {
    const stunServers = [
      `stun:${window.location.hostname}:3478`,
      'stun:stun.l.google.com:19302',
      'stun:stun1.l.google.com:19302'
    ];
    
    const results = {};
    
    for (const stunUrl of stunServers) {
      try {
        const pc = new RTCPeerConnection({ iceServers: [{ urls: stunUrl }] });
        
        const testResult = await new Promise((resolve) => {
          const timeout = setTimeout(() => resolve({ status: 'timeout' }), 5000);
          
          pc.onicecandidate = (event) => {
            if (event.candidate && event.candidate.candidate.includes('srflx')) {
              clearTimeout(timeout);
              pc.close();
              resolve({ status: 'success', candidate: event.candidate.candidate });
            }
          };
          
          pc.createDataChannel('test');
          pc.createOffer().then(offer => pc.setLocalDescription(offer));
        });
        
        results[stunUrl] = testResult;
        
      } catch (error) {
        results[stunUrl] = { status: 'error', error: error.message };
      }
    }
    
    return results;
  },

  // Check WebRTC capabilities
  async checkWebRTCSupport() {
    const webrtc = {
      supported: !!window.RTCPeerConnection,
      codecs: await this.getSupportedCodecs(),
      iceServers: window.rtcManager?.config?.iceServers || [],
      currentConnections: window.rtcManager?.peers?.size || 0,
      connectionStats: window.rtcManager?.getConnectionStats() || null
    };
    
    console.log('📞 WebRTC Support:', webrtc);
    return webrtc;
  },

  // Get supported audio/video codecs
  async getSupportedCodecs() {
    if (!window.RTCPeerConnection) return { audio: [], video: [] };
    
    const pc = new RTCPeerConnection();
    const codecs = { audio: [], video: [] };
    
    try {
      // Check audio codecs
      const audioTransceiver = pc.addTransceiver('audio');
      const audioCapabilities = RTCRtpSender.getCapabilities('audio');
      codecs.audio = audioCapabilities?.codecs?.map(c => c.mimeType) || [];
      
      // Check video codecs
      const videoTransceiver = pc.addTransceiver('video');
      const videoCapabilities = RTCRtpSender.getCapabilities('video');
      codecs.video = videoCapabilities?.codecs?.map(c => c.mimeType) || [];
      
    } catch (error) {
      console.warn('Error checking codec support:', error);
    } finally {
      pc.close();
    }
    
    return codecs;
  },

  // Check media device access
  async checkMediaDevices() {
    const media = {
      supported: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
      devices: [],
      permissions: {},
      currentStream: !!window.rtcManager?.localStream
    };
    
    try {
      // Check device enumeration
      if (navigator.mediaDevices.enumerateDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        media.devices = devices.map(d => ({
          kind: d.kind,
          label: d.label || 'Unknown',
          deviceId: d.deviceId ? 'Available' : 'Restricted'
        }));
      }
      
      // Check permissions
      if (navigator.permissions) {
        try {
          const cameraPermission = await navigator.permissions.query({ name: 'camera' });
          const micPermission = await navigator.permissions.query({ name: 'microphone' });
          
          media.permissions = {
            camera: cameraPermission.state,
            microphone: micPermission.state
          };
        } catch (e) {
          media.permissions = { error: 'Permission API not supported' };
        }
      }
      
    } catch (error) {
      media.error = error.message;
    }
    
    console.log('🎥 Media Devices:', media);
    return media;
  },

  // Check server health
  async checkServerHealth() {
    const server = {
      reachable: false,
      health: null,
      latency: null,
      error: null
    };
    
    try {
      const startTime = Date.now();
      const response = await fetch('/health');
      const endTime = Date.now();
      
      server.reachable = true;
      server.latency = endTime - startTime;
      
      if (response.ok) {
        server.health = await response.json();
      } else {
        server.error = `HTTP ${response.status}: ${response.statusText}`;
      }
      
    } catch (error) {
      server.error = error.message;
    }
    
    console.log('🏥 Server Health:', server);
    return server;
  },

  // Check Socket.IO connection
  checkSocketConnection() {
    const socket = {
      available: !!window.socketManager,
      connected: window.socketManager?.isConnected || false,
      connectionQuality: window.socketManager?.connectionQuality || 'unknown',
      latency: window.socketManager?.serverLatency || null,
      reconnectAttempts: window.socketManager?.reconnectAttempts || 0
    };
    
    console.log('🔌 Socket Connection:', socket);
    return socket;
  },

  // Check performance metrics
  checkPerformance() {
    const perf = {
      memory: performance.memory ? {
        used: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024) + 'MB',
        total: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024) + 'MB',
        limit: Math.round(performance.memory.jsHeapSizeLimit / 1024 / 1024) + 'MB'
      } : 'Not available',
      timing: performance.timing ? {
        pageLoad: performance.timing.loadEventEnd - performance.timing.navigationStart + 'ms',
        domReady: performance.timing.domContentLoadedEventEnd - performance.timing.navigationStart + 'ms'
      } : 'Not available',
      fps: this.measureFPS()
    };
    
    console.log('⚡ Performance:', perf);
    return perf;
  },

  // Measure current FPS
  measureFPS() {
    let fps = 0;
    let lastTime = performance.now();
    let frames = 0;
    
    const measureFrame = (currentTime) => {
      frames++;
      if (currentTime >= lastTime + 1000) {
        fps = Math.round((frames * 1000) / (currentTime - lastTime));
        frames = 0;
        lastTime = currentTime;
      }
      
      if (frames < 60) { // Measure for 1 second max
        requestAnimationFrame(measureFrame);
      }
    };
    
    requestAnimationFrame(measureFrame);
    
    // Return estimated FPS (will be updated asynchronously)
    return fps || 'Measuring...';
  },

  // Display formatted results
  displayResults(results) {
    console.log('\n📊 ZLOER COMMUNICATION DIAGNOSTIC RESULTS');
    console.log('==========================================\n');
    
    // Overall health score
    const healthScore = this.calculateHealthScore(results);
    console.log(`🎯 Overall Health Score: ${healthScore}/100\n`);
    
    // Recommendations
    const recommendations = this.generateRecommendations(results);
    if (recommendations.length > 0) {
      console.log('💡 RECOMMENDATIONS:');
      recommendations.forEach((rec, i) => {
        console.log(`${i + 1}. ${rec}`);
      });
      console.log('');
    }
    
    // Critical issues
    const issues = this.findCriticalIssues(results);
    if (issues.length > 0) {
      console.log('🚨 CRITICAL ISSUES:');
      issues.forEach((issue, i) => {
        console.log(`${i + 1}. ${issue}`);
      });
      console.log('');
    }
    
    console.log('✅ Diagnostic complete! Results saved to window.lastDiagnostic');
    window.lastDiagnostic = results;
  },

  // Calculate overall health score
  calculateHealthScore(results) {
    let score = 0;
    
    // Browser support (20 points)
    if (results.browser.webrtc && results.browser.getUserMedia && results.browser.websockets) {
      score += 20;
    }
    
    // Network connectivity (20 points)
    if (results.network.online) score += 10;
    if (results.network.stunServers && Object.values(results.network.stunServers).some(s => s.status === 'success')) {
      score += 10;
    }
    
    // Server health (20 points)
    if (results.server.reachable) score += 10;
    if (results.server.health && results.server.health.status === 'ok') score += 10;
    
    // Socket connection (20 points)
    if (results.socket.available) score += 10;
    if (results.socket.connected) score += 10;
    
    // Media devices (20 points)
    if (results.media.supported) score += 10;
    if (results.media.devices && results.media.devices.length > 0) score += 10;
    
    return score;
  },

  // Generate recommendations
  generateRecommendations(results) {
    const recommendations = [];
    
    if (!results.browser.webrtc) {
      recommendations.push('Update your browser to support WebRTC');
    }
    
    if (!results.network.online) {
      recommendations.push('Check your internet connection');
    }
    
    if (!results.socket.connected) {
      recommendations.push('Refresh the page to reconnect to server');
    }
    
    if (results.server.latency > 200) {
      recommendations.push('High server latency detected - consider using a server closer to your location');
    }
    
    if (!results.media.supported) {
      recommendations.push('Your browser does not support media devices - update to a modern browser');
    }
    
    return recommendations;
  },

  // Find critical issues
  findCriticalIssues(results) {
    const issues = [];
    
    if (!results.browser.webrtc) {
      issues.push('WebRTC not supported - video calls will not work');
    }
    
    if (!results.server.reachable) {
      issues.push('Cannot reach server - check your internet connection');
    }
    
    if (!results.socket.connected) {
      issues.push('Not connected to server - real-time features unavailable');
    }
    
    if (results.media.permissions.camera === 'denied' || results.media.permissions.microphone === 'denied') {
      issues.push('Camera/microphone permissions denied - grant permissions for video calls');
    }
    
    return issues;
  }
};

// Auto-run basic diagnostic on load
console.log('🔧 Zloer Communication Diagnostics loaded. Run window.ZloerDiagnostics.runFullDiagnostic() for complete analysis.');