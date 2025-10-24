#!/bin/bash

###############################################################################
# DID Optimizer - Stop Production Server
###############################################################################

echo "🛑 Stopping Production Server (Port 5000)..."

PID=$(lsof -ti:5000 2>/dev/null)

if [ -z "$PID" ]; then
    echo "❌ Production server is not running on port 5000"
    exit 1
fi

echo "   PID: $PID"
kill $PID

# Wait for process to stop
sleep 2

# Check if still running
if lsof -ti:5000 >/dev/null 2>&1 ; then
    echo "⚠️  Process still running, force killing..."
    kill -9 $PID
    sleep 1
fi

if ! lsof -ti:5000 >/dev/null 2>&1 ; then
    echo "✅ Production server stopped successfully"
else
    echo "❌ Failed to stop production server"
    exit 1
fi
