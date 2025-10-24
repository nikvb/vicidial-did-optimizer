#!/bin/bash

###############################################################################
# DID Optimizer - Development Server Startup Script
# Port: 5001
# Database: did-optimizer-dev (development copy)
# Environment: .env.dev
###############################################################################

cd /home/na/didapi

echo "🛠️  Starting DID Optimizer - DEVELOPMENT Server"
echo "==============================================="
echo "Port: 5001"
echo "Database: did-optimizer-dev"
echo "Environment: development"
echo ""

# Check if server is already running
if lsof -Pi :5001 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    echo "⚠️  Server already running on port 5001"
    echo ""
    echo "To stop the server:"
    echo "  ./stop-dev.sh"
    echo ""
    echo "To restart:"
    echo "  ./stop-dev.sh && ./start-dev.sh"
    exit 1
fi

# Create logs directory if it doesn't exist
mkdir -p logs

# Load development environment (override production .env)
set -a
source .env.dev
set +a

# Ensure port is set to 5001
export PORT=5001
export NODE_ENV=development

# Start server in background
node server-full.js > logs/development.log 2>&1 &
PID=$!

echo "✅ Development server started!"
echo "   PID: $PID"
echo "   Port: 5001"
echo "   Logs: tail -f logs/development.log"
echo ""
echo "🔗 URLs:"
echo "   Frontend: http://localhost:5001"
echo "   API: http://localhost:5001"
echo "   Health: http://localhost:5001/api/v1/health"
echo ""
echo "📊 Monitoring:"
echo "   tail -f logs/development.log"
echo "   ps aux | grep $PID"
echo ""
echo "💡 Development Features:"
echo "   - Separate database (did-optimizer-dev)"
echo "   - Verbose logging enabled"
echo "   - Email verification skipped"
echo "   - Rate limiting: very permissive"
echo "   - Scraper: disabled"
echo ""
echo "⏹️  To stop:"
echo "   ./stop-dev.sh"
echo ""
echo "🔄 To view both servers:"
echo "   ./status.sh"
