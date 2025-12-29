#!/bin/bash

# Zloer Communication Server Installation Script
# Run with: bash install.sh your-domain.com

set -e

DOMAIN=${1:-"your-domain.com"}
echo "🚀 Installing Zloer Communication Server for domain: $DOMAIN"

# Update system
echo "📦 Updating system packages..."
sudo apt update && sudo apt upgrade -y

# Install required packages
echo "🔧 Installing required packages..."
sudo apt install -y curl wget git nginx certbot python3-certbot-nginx docker.io docker-compose nodejs npm ufw

# Configure firewall for TURN server
echo "🔥 Configuring firewall for TURN..."
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 3478/udp
sudo ufw allow 3478/tcp
sudo ufw allow 5349/tcp
sudo ufw allow 5349/udp
sudo ufw allow 49152:65535/udp
sudo ufw --force enable

# Install Node.js 18 (LTS)
echo "📦 Installing Node.js 18..."
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 globally
echo "🔄 Installing PM2..."
sudo npm install -g pm2

# Create application directory
echo "📁 Setting up application directory..."
sudo mkdir -p /opt/zloer
sudo chown $USER:$USER /opt/zloer
cd /opt/zloer

# Copy application files (assuming they're in current directory)
echo "📋 Copying application files..."
cp -r * /opt/zloer/ 2>/dev/null || echo "Please copy your application files to /opt/zloer/"

# Install dependencies
echo "📦 Installing Node.js dependencies..."
npm install --production

# Create logs directory
mkdir -p logs

# Update configuration files with domain
echo "⚙️ Updating configuration files..."
sed -i "s/your-domain.com/$DOMAIN/g" ecosystem.config.js
sed -i "s/your-domain.com/$DOMAIN/g" docker-compose.yml
sed -i "s/your-domain.com/$DOMAIN/g" nginx.conf

# Get server's public IP
PUBLIC_IP=$(curl -s ifconfig.me)
echo "🌐 Detected public IP: $PUBLIC_IP"
sed -i "s/YOUR_SERVER_PUBLIC_IP/$PUBLIC_IP/g" coturn.conf

# Setup SSL certificates with Let's Encrypt
echo "🔒 Setting up SSL certificates..."
sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN --non-interactive --agree-tos --email admin@$DOMAIN

# Copy SSL certificates for Docker
sudo mkdir -p ssl
sudo cp /etc/letsencrypt/live/$DOMAIN/fullchain.pem ssl/cert.pem
sudo cp /etc/letsencrypt/live/$DOMAIN/privkey.pem ssl/privkey.pem
sudo chown $USER:$USER ssl/*

# Start services with Docker Compose
echo "🐳 Starting services with Docker..."
docker-compose up -d

# Setup PM2 startup
echo "🔄 Setting up PM2 startup..."
pm2 startup
pm2 start ecosystem.config.js --env production
pm2 save

# Setup log rotation
echo "📝 Setting up log rotation..."
sudo tee /etc/logrotate.d/zloer > /dev/null <<EOF
/opt/zloer/logs/*.log {
    daily
    missingok
    rotate 52
    compress
    notifempty
    create 644 $USER $USER
    postrotate
        pm2 reload zloer-app
    endscript
}
EOF

# Setup automatic SSL renewal
echo "🔄 Setting up automatic SSL renewal..."
(crontab -l 2>/dev/null; echo "0 12 * * * /usr/bin/certbot renew --quiet && docker-compose restart nginx") | crontab -

echo "✅ Installation completed!"
echo ""
echo "🌐 Your Zloer Communication server is now running at:"
echo "   https://$DOMAIN"
echo ""
echo "📊 Useful commands:"
echo "   pm2 status          - Check application status"
echo "   pm2 logs zloer-app  - View application logs"
echo "   pm2 restart zloer-app - Restart application"
echo "   docker-compose logs - View all service logs"
echo ""
echo "🔧 Configuration files:"
echo "   /opt/zloer/ecosystem.config.js - PM2 configuration"
echo "   /opt/zloer/docker-compose.yml  - Docker services"
echo "   /opt/zloer/nginx.conf          - Nginx configuration"
echo ""
echo "🎮 Your Zloer server is ready for gaming connections!"