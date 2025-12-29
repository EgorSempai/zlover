# TURN Server Troubleshooting Guide

## 🚨 Current Issue: "Job for coturn.service failed because the control process exited with error code"

## 🔧 Immediate Fix Steps

### 1. **Run the Fix Script**
```bash
chmod +x fix-coturn.sh
sudo ./fix-coturn.sh
```

### 2. **Manual Diagnosis Commands**
```bash
# Check detailed error
sudo journalctl -xeu coturn.service

# Check configuration syntax
sudo turnserver --check-config -c /etc/coturn/turnserver.conf

# Check if ports are blocked
sudo netstat -tulpn | grep 3478
```

### 3. **Common Coturn Startup Issues**

#### Issue A: Configuration File Location
**Problem:** Coturn can't find config file
**Solution:**
```bash
# Copy config to correct location
sudo cp coturn.conf /etc/coturn/turnserver.conf
```

#### Issue B: Permission Issues
**Problem:** Can't write to log file
**Solution:**
```bash
sudo mkdir -p /var/log
sudo touch /var/log/coturn.log
sudo chown turnserver:turnserver /var/log/coturn.log
```

#### Issue C: Port Already in Use
**Problem:** Another service using port 3478
**Solution:**
```bash
# Find what's using the port
sudo lsof -i :3478
# Kill the process or change coturn port
```

#### Issue D: TLS Certificate Issues
**Problem:** Missing SSL certificates
**Solution:**
```bash
# Install default certificates
sudo apt-get install ssl-cert
# Or remove TLS lines from config temporarily
```

#### Issue E: Coturn Not Enabled
**Problem:** Service disabled in default config
**Solution:**
```bash
sudo nano /etc/default/coturn
# Change: #TURNSERVER_ENABLED=1 to: TURNSERVER_ENABLED=1
```

### 4. **Try Minimal Configuration**
If the main config fails, use the minimal one:
```bash
sudo cp coturn-minimal.conf /etc/coturn/turnserver.conf
sudo systemctl restart coturn
```

### 5. **Manual Testing**
Test coturn manually to see exact errors:
```bash
sudo turnserver -c /etc/coturn/turnserver.conf -v
```

## 🔍 Diagnostic Commands

### Check Service Status
```bash
sudo systemctl status coturn.service
sudo journalctl -u coturn --no-pager -n 50
```

### Check Configuration
```bash
sudo turnserver --check-config -c /etc/coturn/turnserver.conf
```

### Check Network
```bash
sudo netstat -tulpn | grep -E "(3478|5349|443)"
sudo ss -tulpn | grep -E "(3478|5349|443)"
```

### Check Permissions
```bash
ls -la /etc/coturn/turnserver.conf
ls -la /var/log/coturn.log
```

## 🚨 Emergency Workaround

If Coturn still won't start, temporarily use a public TURN server in your `server.js`:

```javascript
// Add this to getIceServers() function as fallback
{
  urls: 'turn:openrelay.metered.ca:80',
  username: 'openrelayproject',
  credential: 'openrelayproject'
}
```

This will let you test your WebRTC app while fixing Coturn.

### 1. **Update Coturn Configuration**
Your `coturn.conf` has been updated with the correct settings. Key changes:
- ✅ Real IP address (185.117.154.193) instead of placeholder
- ✅ REST API authentication with shared secret
- ✅ TLS port 443 for firewall bypass
- ✅ Proper security settings

### 2. **Restart Coturn Service**
```bash
sudo systemctl restart coturn
sudo systemctl enable coturn
sudo systemctl status coturn
```

### 3. **Check Coturn Logs**
```bash
sudo journalctl -u coturn -f
# Or check the log file:
sudo tail -f /var/log/coturn.log
```

### 4. **Test TURN Server**
Run the test script:
```bash
node test-turn.js
```

### 5. **Manual TURN Testing**
Install coturn utilities:
```bash
sudo apt-get install coturn-utils
```

Test with generated credentials:
```bash
# Get credentials from your app logs, then test:
turnutils_uclient -T -u "TIMESTAMP:zloer-user" -w "BASE64_PASSWORD" 185.117.154.193
```

## 🔍 Common Issues & Solutions

### Issue 1: Port Blocked by Firewall
**Symptoms:** Connection timeouts
**Solution:**
```bash
# Open required ports
sudo ufw allow 3478/udp
sudo ufw allow 3478/tcp  
sudo ufw allow 443/tcp
sudo ufw allow 49152:65535/udp
```

### Issue 2: Coturn Not Running
**Symptoms:** Connection refused
**Check:**
```bash
sudo systemctl status coturn
sudo netstat -tulpn | grep 3478
```

### Issue 3: Wrong IP Configuration
**Symptoms:** ICE candidates not generated
**Fix:** Ensure `external-ip` in coturn.conf matches your public IP:
```bash
curl ifconfig.me  # Get your public IP
```

### Issue 4: Certificate Issues (TLS)
**Symptoms:** TLS connections fail
**Fix:** Use self-signed certificates for testing:
```bash
sudo apt-get install ssl-cert
# Certificates are at:
# /etc/ssl/certs/ssl-cert-snakeoil.pem
# /etc/ssl/private/ssl-cert-snakeoil.key
```

### Issue 5: Authentication Mismatch
**Symptoms:** 401 Unauthorized errors
**Check:** Ensure TURN_SECRET matches in both:
- `server.js` (my_secure_secret_key_2024)
- `coturn.conf` (static-auth-secret=my_secure_secret_key_2024)

## 🧪 Browser Debugging

### Chrome WebRTC Internals
1. Open `chrome://webrtc-internals/`
2. Look for ICE candidates
3. Check for "relay" type candidates
4. Look for TURN server errors

### Console Debugging
Your app now includes enhanced logging:
- 🔄 TURN server configuration
- 🧪 Automatic TURN connectivity tests
- 🧊 ICE candidate types
- ✅ Success/failure indicators

## 📋 Verification Checklist

- [ ] Coturn service is running
- [ ] Ports 3478 (UDP/TCP) and 443 (TCP) are open
- [ ] External IP is correctly configured
- [ ] TURN secret matches between server.js and coturn.conf
- [ ] Browser console shows "TURN relay candidate found"
- [ ] No 401/403 errors in coturn logs

## 🔧 Quick Fix Commands

```bash
# Complete restart sequence
sudo systemctl stop coturn
sudo systemctl start coturn
sudo systemctl status coturn

# Check if ports are listening
sudo netstat -tulpn | grep -E "(3478|443)"

# Test basic connectivity
nc -z -v 185.117.154.193 3478
nc -u -z -v 185.117.154.193 3478

# View real-time logs
sudo journalctl -u coturn -f
```

## 🆘 If Still Not Working

1. **Check server logs** for TURN credential generation
2. **Verify firewall rules** on your VPS
3. **Test from different networks** (mobile hotspot vs WiFi)
4. **Use browser WebRTC internals** to see exact error messages
5. **Try public TURN servers** temporarily to isolate the issue

## 📞 Emergency Fallback

If your TURN server is still not working, you can temporarily use a public TURN server for testing:

```javascript
// Add to your ICE servers array in server.js
{
  urls: 'turn:openrelay.metered.ca:80',
  username: 'openrelayproject',
  credential: 'openrelayproject'
}
```

This will help you determine if the issue is with your TURN server specifically or with your WebRTC implementation.