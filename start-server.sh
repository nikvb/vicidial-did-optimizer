#!/bin/bash
# DID Optimizer Server Start Script with Logging

# Set the working directory
cd /home/na/didapi

# Create logs directory if it doesn't exist
mkdir -p logs

# Set the log file with timestamp
LOG_FILE="logs/server-$(date +%Y%m%d).log"

# Start the server and redirect output to log file
echo "Starting DID Optimizer Server..."
echo "Logs will be written to: $LOG_FILE"
echo "To view logs in real-time: tail -f $LOG_FILE"
echo ""

# Run the server with both stdout and stderr redirected to log file
PORT=5000 node server-full.js 2>&1 | tee -a "$LOG_FILE"
