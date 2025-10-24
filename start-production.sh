#!/bin/bash

###############################################################################
# DID Optimizer - Production Server Startup Script
# Port: 5000
# Database: did-optimizer (production)
# Environment: .env
###############################################################################

cd /home/na/didapi

echo "🚀 Starting DID Optimizer - PRODUCTION Server"
echo "==============================================="
echo "Port: 5000"
echo "Database: did-optimizer"
echo "Environment: production"
echo ""

# Check if server is already running
if lsof -Pi :5000 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    echo "⚠️  Server already running on port 5000"
    echo ""
    echo "To stop the server:"
    echo "  ./stop-production.sh"
    echo ""
    echo "To restart:"
    echo "  ./stop-production.sh && ./start-production.sh"
    exit 1
fi

# Create logs directory if it doesn't exist
mkdir -p logs

# Ensure production environment variables are loaded
export $(grep -v '^#' .env | xargs)

# Ensure port is set to 5000
export PORT=5000
export NODE_ENV=production

# Start server in background
node server-full.js > logs/production.log 2>&1 &
PID=$!

echo "✅ Production server started!"
echo "   PID: $PID"
echo "   Port: 5000"
echo "   Logs: tail -f logs/production.log"
echo ""
echo "🔗 URLs:"
echo "   Frontend: https://dids.amdy.io"
echo "   API: https://endpoint.amdy.io"
echo "   Health: https://endpoint.amdy.io/api/v1/health"
echo ""
echo "📊 Monitoring:"
echo "   tail -f logs/production.log"
echo "   ps aux | grep $PID"
echo ""
echo "⏹️  To stop:"
echo "   ./stop-production.sh"
echo ""
echo "🔄 To view both servers:"
echo "   ./status.sh"
