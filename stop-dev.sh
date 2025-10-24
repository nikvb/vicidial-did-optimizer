#!/bin/bash

###############################################################################
# DID Optimizer - Stop Development Server
###############################################################################

echo "🛑 Stopping Development Server (Port 5001)..."

PID=$(lsof -ti:5001 2>/dev/null)

if [ -z "$PID" ]; then
    echo "❌ Development server is not running on port 5001"
    exit 1
fi

echo "   PID: $PID"
kill $PID

# Wait for process to stop
sleep 2

# Check if still running
if lsof -ti:5001 >/dev/null 2>&1 ; then
    echo "⚠️  Process still running, force killing..."
    kill -9 $PID
    sleep 1
fi

if ! lsof -ti:5001 >/dev/null 2>&1 ; then
    echo "✅ Development server stopped successfully"
else
    echo "❌ Failed to stop development server"
    exit 1
fi
