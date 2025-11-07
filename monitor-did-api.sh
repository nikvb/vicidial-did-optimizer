#!/bin/bash
# DID API Monitoring Script
# Usage: ./monitor-did-api.sh

echo "==============================================="
echo "    DID Optimizer API - System Monitor"
echo "==============================================="
echo ""

# Service status
echo "🔧 Service Status:"
sudo systemctl status did-api.service --no-pager | head -15
echo ""

# Port check
echo "🌐 Port Status:"
lsof -i :5000 || echo "⚠️  Port 5000 not in use"
echo ""

# Recent logs
echo "📋 Recent Logs (last 10 lines):"
sudo tail -10 /var/log/did-api/output.log
echo ""

# Error logs
echo "❌ Recent Errors (last 5 lines):"
sudo tail -5 /var/log/did-api/error.log 2>/dev/null || echo "No errors logged"
echo ""

# API Health Check
echo "🏥 API Health Check:"
API_KEY="did_315b95e7b2107598f4c5c6f51d21b3ac1768892fa81c1bb3ea38756bb1c2b43e"
RESPONSE=$(curl -s -w "\n%{http_code}" "http://api3.amdy.io:5000/api/v1/dids/next?campaign_id=MONITOR&agent_id=999" -H "x-api-key: $API_KEY")
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ API is responding (HTTP $HTTP_CODE)"
    echo "$BODY" | head -c 200
    echo "..."
else
    echo "⚠️  API returned HTTP $HTTP_CODE"
    echo "$BODY"
fi
echo ""

# Resource usage
echo "💾 Resource Usage:"
PID=$(pgrep -f "node.*server-full.js" | head -1)
if [ -n "$PID" ]; then
    ps aux | head -1
    ps aux | grep "$PID" | grep -v grep
else
    echo "⚠️  Process not found"
fi
echo ""

# MongoDB status
echo "🗄️  MongoDB Status:"
systemctl is-active mongod.service && echo "✅ MongoDB is running" || echo "⚠️  MongoDB is not running"
echo ""

echo "==============================================="
echo "Monitoring complete at $(date)"
echo "==============================================="
