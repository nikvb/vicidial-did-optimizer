#!/bin/bash

# DID Reputation Update Script with Debug Output
# Runs daily to update phone number reputation from RoboKiller

LOG_FILE="/var/log/did-reputation-$(date +%Y%m%d).log"
SCRIPT_DIR="/home/na/didapi"

echo "========================================" >> $LOG_FILE
echo "DID Reputation Update Started: $(date)" >> $LOG_FILE
echo "========================================" >> $LOG_FILE

# Change to script directory
cd $SCRIPT_DIR

# Run the fast Python-based bulk update with proxy rotation
# ~60 requests/sec, updates DIDs not checked in 48 hours
echo "Running fast Python reputation update..." >> $LOG_FILE
python3 scripts/bulk_update_reputation.py --concurrency 50 >> $LOG_FILE 2>&1

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