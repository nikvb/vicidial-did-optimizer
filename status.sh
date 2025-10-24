#!/bin/bash

###############################################################################
# DID Optimizer - Server Status
# Shows status of both production and development servers
###############################################################################

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║           DID Optimizer - Server Status                       ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Production Server (Port 5000)
echo "🏭 PRODUCTION SERVER (Port 5000)"
echo "================================"
PID_PROD=$(lsof -ti:5000 2>/dev/null)
if [ -z "$PID_PROD" ]; then
    echo "Status: ❌ NOT RUNNING"
    echo "Start:  ./start-production.sh"
else
    echo "Status: ✅ RUNNING"
    echo "PID:    $PID_PROD"
    echo "Port:   5000"
    echo "DB:     did-optimizer (production)"
    echo "URL:    https://dids.amdy.io"
    echo "Logs:   tail -f logs/production.log"
    echo "Stop:   ./stop-production.sh"

    # Show memory/CPU usage
    MEM=$(ps aux | awk -v pid=$PID_PROD '$2 == pid {print $4}')
    CPU=$(ps aux | awk -v pid=$PID_PROD '$2 == pid {print $3}')
    UPTIME=$(ps -p $PID_PROD -o etime= | tr -d ' ')
    echo "Uptime: $UPTIME"
    echo "CPU:    ${CPU}%"
    echo "Memory: ${MEM}%"
fi
echo ""

# Development Server (Port 5001)
echo "🛠️  DEVELOPMENT SERVER (Port 5001)"
echo "================================="
PID_DEV=$(lsof -ti:5001 2>/dev/null)
if [ -z "$PID_DEV" ]; then
    echo "Status: ❌ NOT RUNNING"
    echo "Start:  ./start-dev.sh"
else
    echo "Status: ✅ RUNNING"
    echo "PID:    $PID_DEV"
    echo "Port:   5001"
    echo "DB:     did-optimizer-dev (development)"
    echo "URL:    http://localhost:5001"
    echo "Logs:   tail -f logs/development.log"
    echo "Stop:   ./stop-dev.sh"

    # Show memory/CPU usage
    MEM=$(ps aux | awk -v pid=$PID_DEV '$2 == pid {print $4}')
    CPU=$(ps aux | awk -v pid=$PID_DEV '$2 == pid {print $3}')
    UPTIME=$(ps -p $PID_DEV -o etime= | tr -d ' ')
    echo "Uptime: $UPTIME"
    echo "CPU:    ${CPU}%"
    echo "Memory: ${MEM}%"
fi
echo ""

# MongoDB Status
echo "📊 DATABASE STATUS"
echo "=================="
if mongosh --quiet --eval "db.version()" >/dev/null 2>&1; then
    MONGO_VERSION=$(mongosh --quiet --eval "db.version()" 2>/dev/null)
    echo "MongoDB: ✅ RUNNING (version $MONGO_VERSION)"

    # Count documents in each database
    PROD_COUNT=$(mongosh "did-optimizer" --quiet --eval "db.dids.countDocuments()" 2>/dev/null || echo "0")
    DEV_COUNT=$(mongosh "did-optimizer-dev" --quiet --eval "db.dids.countDocuments()" 2>/dev/null || echo "0")

    echo "Production DB DIDs: $PROD_COUNT"
    echo "Development DB DIDs: $DEV_COUNT"
else
    echo "MongoDB: ❌ NOT RUNNING"
fi
echo ""

# Disk Space
echo "💾 DISK SPACE"
echo "============="
df -h /home/na/didapi | tail -1 | awk '{print "Usage: "$3" / "$2" ("$5")"}'
echo ""

# Recent Logs
if [ -f "logs/production.log" ] && [ ! -z "$PID_PROD" ]; then
    echo "📝 RECENT PRODUCTION LOGS (last 5 lines)"
    echo "========================================="
    tail -5 logs/production.log
    echo ""
fi

if [ -f "logs/development.log" ] && [ ! -z "$PID_DEV" ]; then
    echo "📝 RECENT DEVELOPMENT LOGS (last 5 lines)"
    echo "=========================================="
    tail -5 logs/development.log
    echo ""
fi

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                     Quick Commands                             ║"
echo "╠════════════════════════════════════════════════════════════════╣"
echo "║ Start Production:   ./start-production.sh                      ║"
echo "║ Start Development:  ./start-dev.sh                             ║"
echo "║ Stop Production:    ./stop-production.sh                       ║"
echo "║ Stop Development:   ./stop-dev.sh                              ║"
echo "║ Status:             ./status.sh                                ║"
echo "║ Restart Both:       ./restart-all.sh                           ║"
echo "╚════════════════════════════════════════════════════════════════╝"
