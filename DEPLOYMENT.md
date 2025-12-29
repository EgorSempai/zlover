# 🚀 Zloer Communication Server Deployment Guide

## Overview
Your Zloer Communication application is now production-ready with:
- ✅ Production Node.js server with security features
- ✅ Docker containerization with health checks
- ✅ Nginx reverse proxy with SSL support
- ✅ STUN/TURN server (Coturn) for WebRTC
- ✅ Automated installation script
- ✅ PM2 process management
- ✅ SSL certificate automation

## 🛠️ Server Requirements
- **OS**: Ubuntu 20.04+ or Debian 11+
- **RAM**: Minimum 2GB (4GB recommended)
- **CPU**: 2+ cores recommended
- **Storage**: 20GB+ available space
- **Network**: Public IP address with ports 80, 443, 3478, 49152-65535 open

## 📋 Pre-Installation Checklist

### 1. Domain Setup
Before installation, ensure your domain is properly configured:

1. **Purchase a domain** (e.g., `yourdomain.com`)
2. **Point DNS to your server**:
   - Create an `A` record pointing `yourdomain.com` to your server's IP
   - Create an `A` record pointing `www.yourdomain.com` to your server's IP
   - Wait for DNS propagation (can take up to 24 hours)

### 2. Server Access
- SSH access to your server as root or sudo user
- Server should have internet connectivity

## 🚀 Installation Steps

### Step 1: Connect to Your Server
```bash
ssh root@your-server-ip
# or
ssh your-username@your-server-ip
```

### Step 2: Upload Application Files
Upload all your Zloer application files to the server. You can use:

**Option A: Git Clone (Recommended)**
```bash
git clone https://github.com/yourusername/zloer-communication.git
cd zloer-communication
```

**Option B: SCP Upload**
```bash
# From your local machine
scp -r /path/to/zloer-files/* root@your-server-ip:/root/zloer/
```

**Option C: Manual Upload**
Use FileZilla, WinSCP, or similar tools to upload files.

### Step 3: Run Installation Script
```bash
# Make the script executable
chmod +x install.sh

# Run installation with your domain
./install.sh yourdomain.com
```

The script will automatically:
- Update system packages
- Install Node.js, Docker, Nginx, PM2
- Configure firewall
- Set up SSL certificates
- Start all services
- Configure automatic renewals

### Step 4: Verify Installation
After installation completes, check:

1. **Application Status**:
   ```bash
   pm2 status
   docker-compose ps
   ```

2. **Access Your Site**:
   - Visit `https://yourdomain.com`
   - Should see Zloer Communication interface

3. **Check Logs**:
   ```bash
   pm2 logs zloer-app
   docker-compose logs
   ```

## 🔧 Configuration Files

### Important Files Locations:
- **Application**: `/opt/zloer/`
- **Logs**: `/opt/zloer/logs/`
- **SSL Certificates**: `/etc/letsencrypt/live/yourdomain.com/`
- **Nginx Config**: `/opt/zloer/nginx.conf`
- **STUN Server Config**: `/opt/zloer/coturn.conf`

### Environment Variables:
The application uses these environment variables:
- `NODE_ENV=production`
- `DOMAIN=yourdomain.com`
- `PORT=3000`

## 🌐 Domain Connection Process

### DNS Configuration:
1. **A Records** (Required):
   ```
   yourdomain.com     → your-server-ip
   www.yourdomain.com → your-server-ip
   ```

2. **Optional CNAME**:
   ```
   zloer.yourdomain.com → yourdomain.com
   ```

### SSL Certificate:
The installation script automatically:
- Obtains SSL certificates from Let's Encrypt
- Configures automatic renewal
- Sets up HTTPS redirects

## 🔥 Firewall Configuration
The script automatically opens these ports:
- **80/tcp**: HTTP (redirects to HTTPS)
- **443/tcp**: HTTPS
- **3478/udp**: STUN server
- **49152-65535/udp**: TURN relay ports

## 📊 Monitoring & Management

### PM2 Commands:
```bash
pm2 status              # Check app status
pm2 logs zloer-app      # View logs
pm2 restart zloer-app   # Restart app
pm2 stop zloer-app      # Stop app
pm2 start zloer-app     # Start app
```

### Docker Commands:
```bash
docker-compose ps       # Check services
docker-compose logs     # View all logs
docker-compose restart  # Restart all services
docker-compose down     # Stop all services
docker-compose up -d    # Start all services
```

### Health Check:
Visit `https://yourdomain.com/health` to see server status.

## 🔧 Troubleshooting

### Common Issues:

1. **SSL Certificate Failed**:
   ```bash
   sudo certbot --nginx -d yourdomain.com --force-renewal
   ```

2. **Port Already in Use**:
   ```bash
   sudo netstat -tulpn | grep :80
   sudo netstat -tulpn | grep :443
   ```

3. **Docker Issues**:
   ```bash
   docker-compose down
   docker-compose up -d --force-recreate
   ```

4. **STUN Server Not Working**:
   - Check your server's public IP in `coturn.conf`
   - Ensure UDP ports 3478 and 49152-65535 are open

### Log Locations:
- **Application Logs**: `/opt/zloer/logs/`
- **Nginx Logs**: `/var/log/nginx/`
- **Coturn Logs**: `/var/log/coturn.log`
- **PM2 Logs**: `pm2 logs`

## 🔄 Updates & Maintenance

### Update Application:
```bash
cd /opt/zloer
git pull origin main  # If using git
npm install --production
pm2 restart zloer-app
```

### SSL Certificate Renewal:
Automatic renewal is configured, but you can manually renew:
```bash
sudo certbot renew
docker-compose restart nginx
```

### Backup Important Data:
```bash
# Backup configuration
tar -czf zloer-backup-$(date +%Y%m%d).tar.gz /opt/zloer/
```

## 🎮 Testing WebRTC Connection

After deployment, test your WebRTC connection:

1. **Open two browser tabs** to `https://yourdomain.com`
2. **Create a room** in one tab
3. **Join the same room** in the second tab
4. **Check connection stats** using the stats overlay
5. **Verify STUN server** is working (should show your domain in stats)

## 🆘 Support

If you encounter issues:
1. Check the logs first: `pm2 logs zloer-app`
2. Verify DNS propagation: `nslookup yourdomain.com`
3. Test SSL: `curl -I https://yourdomain.com`
4. Check firewall: `sudo ufw status`

## 🎉 Success!

Once deployed, your Zloer Communication server will be available at:
- **Main URL**: `https://yourdomain.com`
- **Health Check**: `https://yourdomain.com/health`
- **Direct Room**: `https://yourdomain.com/room/ROOM_ID`

Your users can now connect from anywhere in the world using your own STUN server for optimal WebRTC performance!