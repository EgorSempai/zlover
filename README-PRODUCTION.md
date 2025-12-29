# 🎮 Zloer Communication - Production Deployment

## 🚀 Quick Start

Your Zloer Communication application is ready for production deployment with:

- **WebRTC Video/Audio Streaming** with mesh topology
- **Own STUN Server** for optimal connection performance  
- **Russian/English Language Support**
- **Host Controls** (kick users, room management)
- **Real-time Connection Stats** with codec analysis
- **Production Security** features and SSL support

## 📦 What's Included

### Core Files:
- `server.js` - Production Node.js server with security
- `public/` - Complete web application
- `install.sh` - Automated deployment script
- `verify-setup.sh` - Post-installation verification

### Docker Configuration:
- `Dockerfile` - Application container
- `docker-compose.yml` - Multi-service orchestration
- `nginx.conf` - Reverse proxy with SSL
- `coturn.conf` - STUN/TURN server configuration

### Process Management:
- `ecosystem.config.js` - PM2 configuration
- `package.json` - Dependencies and scripts

## 🛠️ Installation Instructions

### 1. Server Requirements
- Ubuntu 20.04+ or Debian 11+
- 2GB+ RAM (4GB recommended)
- Public IP address
- Domain name pointing to your server

### 2. Deploy to Server

**Upload files to your server:**
```bash
# Option 1: Git clone (recommended)
git clone https://github.com/yourusername/zloer-communication.git
cd zloer-communication

# Option 2: Upload via SCP
scp -r ./* root@your-server-ip:/opt/zloer/
```

**Run installation:**
```bash
chmod +x install.sh
./install.sh yourdomain.com
```

**Verify installation:**
```bash
chmod +x verify-setup.sh
./verify-setup.sh yourdomain.com
```

### 3. Domain Configuration

**DNS Records needed:**
```
A    yourdomain.com      → your-server-ip
A    www.yourdomain.com  → your-server-ip
```

The installation script will automatically:
- Set up SSL certificates (Let's Encrypt)
- Configure Nginx reverse proxy
- Start STUN server on port 3478
- Enable automatic SSL renewal

## 🌐 Access Your Application

After successful deployment:
- **Main Site**: `https://yourdomain.com`
- **Health Check**: `https://yourdomain.com/health`
- **Direct Room**: `https://yourdomain.com/room/ROOM_ID`

## 🔧 Management Commands

### Application Management:
```bash
pm2 status              # Check status
pm2 logs zloer-app      # View logs
pm2 restart zloer-app   # Restart app
```

### Docker Services:
```bash
docker-compose ps       # Check services
docker-compose logs     # View logs
docker-compose restart  # Restart all
```

### SSL Certificate:
```bash
sudo certbot renew     # Manual renewal
```

## 🎯 Features Overview

### WebRTC Features:
- **Mesh Topology**: Everyone connects to everyone
- **Own STUN Server**: `stun:yourdomain.com:3478`
- **Codec Support**: VP9, H.264, Opus, G.722
- **Quality Settings**: Bitrate, resolution, framerate control
- **Device Selection**: Camera/microphone switching

### User Interface:
- **Dual Language**: English/Russian with persistent settings
- **Room Sharing**: Shareable room URLs
- **Connection Stats**: Real-time WebRTC analytics
- **Audio Visualizer**: Optional waveform display
- **Fullscreen Support**: For screen sharing

### Host Controls:
- **Room Ownership**: First user becomes host (👑)
- **Kick Users**: Host can remove participants
- **Host Transfer**: Automatic when host leaves

### Security Features:
- **Rate Limiting**: 100 connections per IP per hour
- **Input Validation**: Room ID and nickname limits
- **HTTPS Only**: Automatic HTTP to HTTPS redirect
- **Security Headers**: XSS, CSRF, clickjacking protection

## 🔍 Troubleshooting

### Common Issues:

**1. Can't connect to room:**
- Check if STUN server is running: `docker-compose ps coturn`
- Verify firewall allows UDP 3478: `sudo ufw status`

**2. SSL certificate issues:**
- Ensure DNS is pointing to your server
- Wait for DNS propagation (up to 24 hours)
- Manual renewal: `sudo certbot --nginx -d yourdomain.com`

**3. Application not starting:**
- Check logs: `pm2 logs zloer-app`
- Verify Node.js version: `node --version` (requires 16+)

**4. WebRTC connection fails:**
- Check browser console for errors
- Verify STUN server in connection stats
- Test with different browsers/networks

### Log Locations:
- **App Logs**: `/opt/zloer/logs/`
- **Nginx**: `/var/log/nginx/`
- **Coturn**: `/var/log/coturn.log`

## 🔄 Updates

To update your application:
```bash
cd /opt/zloer
git pull origin main
npm install --production
pm2 restart zloer-app
docker-compose restart
```

## 📊 Monitoring

### Health Check Endpoint:
`GET https://yourdomain.com/health`

Returns:
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "rooms": 5,
  "users": 12
}
```

### Performance Monitoring:
- **PM2 Monitoring**: `pm2 monit`
- **Docker Stats**: `docker stats`
- **System Resources**: `htop` or `top`

## 🎉 Success!

Your Zloer Communication server is now running with:
- ✅ Production-grade security
- ✅ Own STUN server for optimal WebRTC
- ✅ SSL encryption
- ✅ Automatic scaling and recovery
- ✅ Comprehensive logging and monitoring

Users can now connect from anywhere in the world for high-quality video communication!