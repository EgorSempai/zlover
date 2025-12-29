// Fix for button functionality and settings access
document.addEventListener('DOMContentLoaded', () => {
  console.log('🔧 Applying fixes...');
  
  // Ensure settings button is always visible and functional
  setTimeout(() => {
    const settingsBtn = document.getElementById('settings-btn');
    if (settingsBtn) {
      // Remove any existing event listeners
      settingsBtn.replaceWith(settingsBtn.cloneNode(true));
      const newSettingsBtn = document.getElementById('settings-btn');
      
      // Add click handler for settings
      newSettingsBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('Settings button clicked');
        if (window.uiManager) {
          window.uiManager.toggleSettingsPanel();
        }
      });
      
      // Right-click for admin panel (host only)
      newSettingsBtn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (window.uiManager && window.uiManager.isHost) {
          window.uiManager.toggleAdminPanel();
        } else {
          console.log('Admin panel only available to host');
        }
      });
      
      console.log('✅ Settings button fixed');
    }
  }, 2000);
  
  // Fix fullscreen and pin buttons with event delegation
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('fullscreen-btn')) {
      e.stopPropagation();
      const container = e.target.closest('.video-container');
      if (container) {
        const socketId = container.dataset.socketId;
        if (window.uiManager) {
          window.uiManager.toggleFullscreen(socketId);
        }
      }
    } else if (e.target.classList.contains('pin-btn')) {
      e.stopPropagation();
      const container = e.target.closest('.video-container');
      if (container) {
        const socketId = container.dataset.socketId;
        if (window.uiManager) {
          window.uiManager.togglePin(socketId);
        }
      }
    }
  });
  
  console.log('✅ All fixes applied successfully');
});

// Make uiManager globally accessible and ensure settings work
window.addEventListener('load', () => {
  setTimeout(() => {
    if (typeof uiManager !== 'undefined') {
      window.uiManager = uiManager;
      console.log('✅ uiManager made globally accessible');
    }
    
    // Double-check settings button functionality
    const settingsBtn = document.getElementById('settings-btn');
    if (settingsBtn && !settingsBtn.onclick) {
      settingsBtn.style.display = 'block';
      settingsBtn.style.visibility = 'visible';
      console.log('✅ Settings button visibility ensured');
    }
  }, 3000);
});