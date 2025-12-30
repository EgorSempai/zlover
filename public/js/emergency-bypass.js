// Emergency Bypass Script - Ultra Simple Version
console.log('🚨 Emergency Bypass Mode Activated');

// Hide loading screen immediately
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    const loadingScreen = document.getElementById('loading-screen');
    const joinScreen = document.getElementById('join-screen');
    
    if (loadingScreen) loadingScreen.style.display = 'none';
    if (joinScreen) joinScreen.style.display = 'block';
    
    console.log('✅ Emergency bypass completed - showing join screen');
  }, 1000);
});

// Simple join function
function emergencyJoin() {
  const nickname = document.getElementById('nickname-input')?.value || 'User';
  const roomId = document.getElementById('room-input')?.value || 'test';
  
  console.log('Emergency join:', { nickname, roomId });
  
  // Hide join screen, show app
  const joinScreen = document.getElementById('join-screen');
  const app = document.getElementById('app');
  
  if (joinScreen) joinScreen.style.display = 'none';
  if (app) app.classList.remove('hidden');
  
  // Update room display
  const roomDisplay = document.getElementById('room-id-display');
  if (roomDisplay) roomDisplay.textContent = `Room: ${roomId}`;
  
  // Show success message
  alert(`Joined room "${roomId}" as "${nickname}" in emergency mode`);
}

// Add emergency join button after page loads
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    const joinBtn = document.getElementById('join-btn');
    if (joinBtn) {
      joinBtn.onclick = emergencyJoin;
      joinBtn.textContent = '🚨 Emergency Join';
      joinBtn.style.background = '#ff6b6b';
    }
  }, 2000);
});