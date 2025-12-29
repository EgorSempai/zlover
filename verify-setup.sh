#!/bin/bash

# Zloer Communication Server Verification Script
# Run after installation to verify everything is working

DOMAIN=${1:-"localhost"}
echo "🔍 Verifying Zloer Communication Server setup for: $DOMAIN"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print status
print_status() {
    if [ $1 -eq 0 ]; then
        echo -e "${GREEN}✅ $2${NC}"
    else
        echo -e "${RED}❌ $2${NC}"
    fi
}

echo ""
echo "🔧 System Services Check"
echo "========================"

# Check if PM2 is running
pm2 status > /dev/null 2>&1
print_status $? "PM2 process manager"

# Check if Docker is running
docker ps > /dev/null 2>&1
print_status $? "Docker service"

# Check if Nginx is running
systemctl is-active --quiet nginx
print_status $? "Nginx web server"

echo ""
echo "🐳 Docker Services Check"
echo "========================"

# Check Docker Compose services
if [ -f "docker-compose.yml" ]; then
    # Check Zloer app
    docker-compose ps zloer-app | grep -q "Up"
    print_status $? "Zloer application container"
    
    # Check Coturn STUN server
    docker-compose ps coturn | grep -q "Up"
    print_status $? "Coturn STUN/TURN server"
    
    # Check Nginx container
    docker-compose ps nginx | grep -q "Up"
    print_status $? "Nginx container"
else
    echo -e "${YELLOW}⚠️ docker-compose.yml not found${NC}"
fi

echo ""
echo "🌐 Network Connectivity Check"
echo "============================="

# Check if ports are listening
netstat -tuln | grep -q ":80 "
print_status $? "Port 80 (HTTP) listening"

netstat -tuln | grep -q ":443 "
print_status $? "Port 443 (HTTPS) listening"

netstat -tuln | grep -q ":3000 "
print_status $? "Port 3000 (App) listening"

netstat -tuln | grep -q ":3478 "
print_status $? "Port 3478 (STUN) listening"

echo ""
echo "🔒 SSL Certificate Check"
echo "========================"

if [ "$DOMAIN" != "localhost" ]; then
    # Check SSL certificate
    openssl s_client -connect $DOMAIN:443 -servername $DOMAIN < /dev/null 2>/dev/null | grep -q "Verify return code: 0"
    print_status $? "SSL certificate valid"
    
    # Check certificate expiry
    EXPIRY=$(openssl s_client -connect $DOMAIN:443 -servername $DOMAIN < /dev/null 2>/dev/null | openssl x509 -noout -dates | grep notAfter | cut -d= -f2)
    if [ ! -z "$EXPIRY" ]; then
        echo -e "${GREEN}📅 SSL expires: $EXPIRY${NC}"
    fi
else
    echo -e "${YELLOW}⚠️ Skipping SSL check for localhost${NC}"
fi

echo ""
echo "🚀 Application Health Check"
echo "==========================="

# Check application health endpoint
if [ "$DOMAIN" = "localhost" ]; then
    HEALTH_URL="http://localhost:3000/health"
else
    HEALTH_URL="https://$DOMAIN/health"
fi

HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" $HEALTH_URL 2>/dev/null)
if [ "$HTTP_STATUS" = "200" ]; then
    print_status 0 "Application health endpoint ($HTTP_STATUS)"
    
    # Get health data
    HEALTH_DATA=$(curl -s $HEALTH_URL 2>/dev/null)
    if [ ! -z "$HEALTH_DATA" ]; then
        echo -e "${GREEN}📊 Health data: $HEALTH_DATA${NC}"
    fi
else
    print_status 1 "Application health endpoint ($HTTP_STATUS)"
fi

echo ""
echo "📁 File System Check"
echo "===================="

# Check important files exist
[ -f "server.js" ] && print_status 0 "server.js exists" || print_status 1 "server.js missing"
[ -f "package.json" ] && print_status 0 "package.json exists" || print_status 1 "package.json missing"
[ -f "ecosystem.config.js" ] && print_status 0 "ecosystem.config.js exists" || print_status 1 "ecosystem.config.js missing"
[ -d "public" ] && print_status 0 "public directory exists" || print_status 1 "public directory missing"
[ -d "logs" ] && print_status 0 "logs directory exists" || print_status 1 "logs directory missing"

echo ""
echo "🔥 Firewall Status"
echo "=================="

# Check UFW status
if command -v ufw > /dev/null; then
    ufw status | grep -q "Status: active"
    print_status $? "UFW firewall active"
    
    # Check required ports
    ufw status | grep -q "80/tcp"
    print_status $? "Port 80 allowed in firewall"
    
    ufw status | grep -q "443/tcp"
    print_status $? "Port 443 allowed in firewall"
    
    ufw status | grep -q "3478/udp"
    print_status $? "Port 3478 (STUN) allowed in firewall"
else
    echo -e "${YELLOW}⚠️ UFW not installed${NC}"
fi

echo ""
echo "📋 Summary"
echo "=========="

if [ "$DOMAIN" != "localhost" ]; then
    echo -e "${GREEN}🌐 Your Zloer server should be accessible at:${NC}"
    echo -e "   Main site: https://$DOMAIN"
    echo -e "   Health check: https://$DOMAIN/health"
    echo -e "   Direct room: https://$DOMAIN/room/YOUR_ROOM_ID"
else
    echo -e "${GREEN}🌐 Your Zloer server should be accessible at:${NC}"
    echo -e "   Main site: http://localhost:3000"
    echo -e "   Health check: http://localhost:3000/health"
fi

echo ""
echo -e "${GREEN}🎮 Test your WebRTC connection by:${NC}"
echo "   1. Opening two browser tabs"
echo "   2. Creating a room in one tab"
echo "   3. Joining the same room in the other tab"
echo "   4. Checking the connection stats overlay"

echo ""
echo "📊 Useful commands:"
echo "   pm2 status          - Check application status"
echo "   pm2 logs zloer-app  - View application logs"
echo "   docker-compose logs - View all service logs"
echo "   systemctl status nginx - Check Nginx status"

echo ""
echo -e "${GREEN}✅ Verification complete!${NC}"