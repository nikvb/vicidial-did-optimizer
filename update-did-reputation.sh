#!/bin/bash

# DID Reputation Update Script with Debug Output
# Runs daily to update phone number reputation from RoboKiller

LOG_FILE="/var/log/did-reputation-$(date +%Y%m%d).log"
SCRIPT_DIR="/home/na/didapi/temp_clone"

echo "========================================" >> $LOG_FILE
echo "DID Reputation Update Started: $(date)" >> $LOG_FILE
echo "========================================" >> $LOG_FILE

# Set environment variables for debug output
export NODE_ENV=production
export DEBUG=*
export CRAWL4AI_VERBOSE=true

# Change to script directory
cd $SCRIPT_DIR

# Run the bulk update with debug output
echo "Running bulk reputation update..." >> $LOG_FILE
node bulk_update_reputation_fast.js >> $LOG_FILE 2>&1

# Check exit status
if [ $? -eq 0 ]; then
    echo "✅ Reputation update completed successfully at $(date)" >> $LOG_FILE
else
    echo "❌ Reputation update failed at $(date)" >> $LOG_FILE
fi

echo "========================================" >> $LOG_FILE
echo "" >> $LOG_FILE

# Keep only last 30 days of logs
find /var/log -name "did-reputation-*.log" -mtime +30 -delete