#!/bin/bash

echo "🔧 Coturn Service Diagnostic & Fix Script"
echo "========================================"

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "❌ Please run as root: sudo ./fix-coturn.sh"
    exit 1
fi

echo "📋 Step 1: Checking Coturn installation..."
if ! command -v turnserver &> /dev/null; then
    echo "❌ Coturn not installed. Installing..."
    apt-get update
    apt-get install -y coturn
else
    echo "✅ Coturn is installed"
fi

echo ""
echo "📋 Step 2: Checking configuration file..."
if [ ! -f "/etc/coturn/turnserver.conf" ]; then
    echo "❌ Default config not found. Creating backup location..."
    mkdir -p /etc/coturn
fi

# Copy our config to the correct location
if [ -f "coturn.conf" ]; then
    echo "📁 Copying coturn.conf to /etc/coturn/turnserver.conf..."
    cp coturn.conf /etc/coturn/turnserver.conf
    echo "✅ Configuration copied"
else
    echo "❌ coturn.conf not found in current directory"
    exit 1
fi

echo ""
echo "📋 Step 3: Setting up log directory..."
mkdir -p /var/log
touch /var/log/coturn.log
chown turnserver:turnserver /var/log/coturn.log 2>/dev/null || echo "⚠️ turnserver user not found, using root"

echo ""
echo "📋 Step 4: Checking configuration syntax..."
turnserver --check-config -c /etc/coturn/turnserver.conf
if [ $? -eq 0 ]; then
    echo "✅ Configuration syntax is valid"
else
    echo "❌ Configuration has syntax errors"
    echo "📝 Checking for common issues..."
    
    # Check for certificate files
    if grep -q "cert=" /etc/coturn/turnserver.conf; then
        echo "🔍 Checking TLS certificates..."
        if [ ! -f "/etc/ssl/certs/ssl-cert-snakeoil.pem" ]; then
            echo "❌ TLS certificate not found. Installing ssl-cert..."
            apt-get install -y ssl-cert
        fi
    fi
fi

echo ""
echo "📋 Step 5: Testing port availability..."
netstat -tulpn | grep -E "(3478|5349|443)" || echo "ℹ️ Ports not in use (this is expected if coturn is stopped)"

echo ""
echo "📋 Step 6: Checking firewall status..."
ufw status | grep -E "(3478|443|49152:65535)" || echo "⚠️ Firewall rules may need to be added"

echo ""
echo "📋 Step 7: Enabling and starting Coturn service..."

# Enable coturn in default config
if [ -f "/etc/default/coturn" ]; then
    sed -i 's/#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn
    echo "✅ Enabled coturn in /etc/default/coturn"
fi

# Stop any existing service
systemctl stop coturn 2>/dev/null

# Start the service
echo "🚀 Starting coturn service..."
systemctl start coturn

# Check status
sleep 2
if systemctl is-active --quiet coturn; then
    echo "✅ Coturn service is running!"
    systemctl enable coturn
    echo "✅ Coturn service enabled for auto-start"
else
    echo "❌ Coturn service failed to start"
    echo "📋 Service status:"
    systemctl status coturn --no-pager
    echo ""
    echo "📋 Recent logs:"
    journalctl -u coturn --no-pager -n 20
    echo ""
    echo "💡 Common fixes:"
    echo "   1. Check if ports are already in use: netstat -tulpn | grep 3478"
    echo "   2. Check permissions: ls -la /var/log/coturn.log"
    echo "   3. Try running manually: turnserver -c /etc/coturn/turnserver.conf -v"
fi

echo ""
echo "📋 Step 8: Testing TURN server..."
if systemctl is-active --quiet coturn; then
    echo "🧪 Testing UDP port 3478..."
    nc -u -z -v 127.0.0.1 3478 2>&1 | head -1
    
    echo "🧪 Testing TCP port 3478..."
    nc -z -v 127.0.0.1 3478 2>&1 | head -1
    
    echo "🧪 Testing TLS port 443..."
    nc -z -v 127.0.0.1 443 2>&1 | head -1
fi

echo ""
echo "🎯 Next steps:"
echo "1. If coturn is running, test with: node test-turn.js"
echo "2. Check browser console for WebRTC connection logs"
echo "3. Monitor logs: sudo journalctl -u coturn -f"
echo ""
echo "🔧 Manual restart command: sudo systemctl restart coturn"
echo "📊 Check status: sudo systemctl status coturn"