// Patch for fixing emoji and functionality issues
document.addEventListener('DOMContentLoaded', () => {
  console.log('🔧 Applying patches...');
  
  // Fix corrupted emojis in Russian translations
  if (window.uiManager && window.uiManager.translations && window.uiManager.translations.ru) {
    window.uiManager.translations.ru.joinRoom = '🚀 Войти в комнату';
    window.uiManager.translations.ru.telegram = '📱 Присоединиться к Telegram';
    console.log('✅ Fixed corrupted Russian emojis');
  }
  
  // Also fix them after UI manager loads
  setTimeout(() => {
    if (window.uiManager && window.uiManager.translations && window.uiManager.translations.ru) {
      window.uiManager.translations.ru.joinRoom = '🚀 Войти в комнату';
      window.uiManager.translations.ru.telegram = '📱 Присоединиться к Telegram';
      
      // Update the buttons if they exist
      const joinBtn = document.getElementById('join-btn');
      const telegramBtn = document.querySelector('a[href*="t.me"]');
      
      if (joinBtn && window.uiManager.currentLanguage === 'ru') {
        joinBtn.textContent = '🚀 Войти в комнату';
      }
      
      if (telegramBtn && window.uiManager.currentLanguage === 'ru') {
        telegramBtn.textContent = '📱 Присоединиться к Telegram';
      }
      
      console.log('✅ Updated button text with fixed emojis');
    }
  }, 2000);
  
  // Zlover Interactive Features
  const zloverTips = {
    en: [
      "Pro tip: Use headphones to avoid echo and sound better!",
      "Gaming wisdom: Good communication wins games!",
      "Zlover says: Test your mic before important calls!",
      "Remember: Mute when you're not talking in big groups!",
      "Fun fact: I help millions of gamers connect every day!",
      "Tip: Use Ctrl+M to quickly mute/unmute!",
      "Zlover's advice: Screen sharing is great for tutorials!",
      "Did you know? You can pin users in spotlight mode!",
      "Pro gamer move: Adjust your settings for best quality!",
      "Zlover reminder: Invite friends with the room ID!"
    ],
    ru: [
      "Совет профи: Используйте наушники, чтобы избежать эха!",
      "Игровая мудрость: Хорошее общение выигрывает игры!",
      "Злоер говорит: Проверьте микрофон перед важными звонками!",
      "Помните: Отключайте звук, когда не говорите в больших группах!",
      "Интересный факт: Я помогаю миллионам игроков подключаться каждый день!",
      "Совет: Используйте Ctrl+M для быстрого включения/выключения звука!",
      "Совет Злоера: Демонстрация экрана отлично подходит для обучения!",
      "Знали ли вы? Можно закреплять пользователей в режиме прожектора!",
      "Ход профи-геймера: Настройте параметры для лучшего качества!",
      "Напоминание Злоера: Приглашайте друзей с помощью ID комнаты!"
    ]
  };
  
  // Add click handler for Zlover mascot
  setTimeout(() => {
    const zloverMascot = document.getElementById('zlover-mascot');
    const zloverMessage = document.getElementById('zlover-message');
    
    if (zloverMascot && zloverMessage) {
      zloverMascot.addEventListener('click', () => {
        const currentLang = window.uiManager?.currentLanguage || 'en';
        const tips = zloverTips[currentLang] || zloverTips.en;
        const randomTip = tips[Math.floor(Math.random() * tips.length)];
        zloverMessage.textContent = randomTip;
        
        // Add special animation
        zloverMascot.style.animation = 'none';
        setTimeout(() => {
          zloverMascot.style.animation = 'zloverBounce 2s ease-in-out infinite';
        }, 100);
        
        // Show notification
        if (window.NotificationManager && window.uiManager) {
          const notificationText = currentLang === 'ru' ? 
            '🎮 Злоер поделился советом!' : 
            '🎮 Zloer shared a tip!';
          window.NotificationManager.show(notificationText, 'info');
        }
      });
      
      zloverMascot.style.cursor = 'pointer';
      console.log('✅ Zlover interactive features enabled');
    }
  }, 1000);
  
  // Fix all button emoji functions
  setTimeout(() => {
    if (window.uiManager) {
      // Fix video button emoji
      window.uiManager.updateVideoButton = function(isOff) {
        const btn = document.getElementById('video-btn');
        if (btn) {
          btn.textContent = isOff ? '📷' : '📹';
          btn.className = `btn-control ${isOff ? 'inactive' : 'active'}`;
          btn.title = `Camera ${isOff ? 'Off' : 'On'} (Ctrl+V)`;
        }
      };
      
      // Fix mute button emoji
      window.uiManager.updateMuteButton = function(isMuted) {
        const btn = document.getElementById('mute-btn');
        if (btn) {
          btn.textContent = isMuted ? '🔇' : '🎤';
          btn.className = `btn-control ${isMuted ? 'inactive' : 'active'}`;
          btn.title = `${isMuted ? 'Unmute' : 'Mute'} (Ctrl+M)`;
        }
      };
      
      // Fix screen share button emoji
      window.uiManager.updateScreenShareButton = function(isSharing) {
        const btn = document.getElementById('screen-share-btn');
        if (btn) {
          btn.textContent = isSharing ? '🖥️' : '🖥️';
          btn.className = `btn-control ${isSharing ? 'active' : ''}`;
          btn.title = `${isSharing ? 'Stop' : 'Share'} Screen (Ctrl+S)`;
        }
      };
      
      // Fix local video display
      window.uiManager.updateLocalVideoDisplay = function(isOff) {
        const localVideo = document.getElementById('local-video');
        const localContainer = document.getElementById('local-container');
        
        if (isOff) {
          // Show camera off emoji
          if (localContainer && !localContainer.querySelector('.camera-off-overlay')) {
            const overlay = document.createElement('div');
            overlay.className = 'camera-off-overlay';
            overlay.innerHTML = '📷';
            localContainer.appendChild(overlay);
          }
          if (localVideo) {
            localVideo.style.display = 'none';
          }
        } else {
          // Remove camera off emoji
          const overlay = localContainer?.querySelector('.camera-off-overlay');
          if (overlay) {
            overlay.remove();
          }
          if (localVideo) {
            localVideo.style.display = 'block';
          }
        }
      };
      
      console.log('✅ All button emojis fixed');
    }
  }, 1000);
});

// Ensure settings button works for everyone - MULTIPLE SAFEGUARDS
function ensureSettingsButtonForAll() {
  const settingsBtn = document.getElementById('settings-btn');
  if (settingsBtn) {
    // Force show settings button for ALL users
    settingsBtn.style.display = 'inline-block';
    settingsBtn.style.visibility = 'visible';
    settingsBtn.style.opacity = '1';
    settingsBtn.style.pointerEvents = 'auto';
    
    // Remove any existing handlers and add new one
    const newBtn = settingsBtn.cloneNode(true);
    settingsBtn.parentNode.replaceChild(newBtn, settingsBtn);
    
    newBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('Settings clicked');
      if (window.uiManager && window.uiManager.toggleSettingsPanel) {
        window.uiManager.toggleSettingsPanel();
      }
    });
    
    console.log('✅ Settings button patched for all users');
    return true;
  }
  return false;
}

// Apply settings button fix multiple times to ensure it works
window.addEventListener('load', () => {
  // Try immediately
  ensureSettingsButtonForAll();
  
  // Try after 1 second
  setTimeout(ensureSettingsButtonForAll, 1000);
  
  // Try after 2 seconds
  setTimeout(ensureSettingsButtonForAll, 2000);
  
  // Try after 3 seconds (when room is fully loaded)
  setTimeout(ensureSettingsButtonForAll, 3000);
});

// Also ensure settings button is visible whenever setHost is called
const originalSetHost = window.uiManager?.setHost;
if (originalSetHost) {
  window.uiManager.setHost = function(isHost) {
    originalSetHost.call(this, isHost);
    setTimeout(ensureSettingsButtonForAll, 100);
  };
}

// Force refresh UI language to apply emoji fixes
setTimeout(() => {
  if (window.uiManager && window.uiManager.updateLanguage) {
    const currentLang = window.uiManager.currentLanguage;
    window.uiManager.updateLanguage(currentLang);
    console.log('✅ Refreshed UI language to apply emoji fixes');
  }
}, 3000);