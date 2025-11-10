#!/bin/bash

# Setup VICIdial Call Results Sync Cron Job
# This script installs a cron job to sync VICIdial call results every minute

SCRIPT_DIR="/home/na/didapi"
SCRIPT_PATH="$SCRIPT_DIR/process-call-results.pl"
LOG_FILE="/var/log/did-optimizer-sync.log"
CRON_USER="root"

echo "🔧 Setting up VICIdial Call Results Sync Cron Job..."
echo ""

# Check if script exists
if [ ! -f "$SCRIPT_PATH" ]; then
    echo "❌ Error: Script not found at $SCRIPT_PATH"
    exit 1
fi

# Make script executable
chmod +x "$SCRIPT_PATH"
echo "✓ Made script executable"

# Create log file if it doesn't exist
touch "$LOG_FILE"
chmod 644 "$LOG_FILE"
echo "✓ Created log file: $LOG_FILE"

# Create cron job entry
CRON_JOB="* * * * * cd $SCRIPT_DIR && /usr/bin/perl $SCRIPT_PATH >> $LOG_FILE 2>&1"

# Check if cron job already exists
crontab -l 2>/dev/null | grep -F "$SCRIPT_PATH" > /dev/null
if [ $? -eq 0 ]; then
    echo "⚠️  Cron job already exists. Removing old entry..."
    crontab -l 2>/dev/null | grep -v "$SCRIPT_PATH" | crontab -
fi

# Add new cron job
(crontab -l 2>/dev/null; echo "$CRON_JOB") | crontab -

echo "✓ Added cron job"
echo ""
echo "📋 Cron Configuration:"
echo "   Frequency: Every minute (* * * * *)"
echo "   Script: $SCRIPT_PATH"
echo "   Log: $LOG_FILE"
echo ""

# Display current crontab
echo "📝 Current crontab entries:"
crontab -l | grep -v "^#" | grep -v "^$"
echo ""

echo "✅ Setup complete!"
echo ""
echo "📊 To monitor the sync:"
echo "   tail -f $LOG_FILE"
echo ""
echo "🔍 To check sync status:"
echo "   grep 'Summary:' $LOG_FILE | tail -5"
echo ""
echo "⏸️  To disable the cron job:"
echo "   crontab -e"
echo "   (Comment out or remove the line containing: $SCRIPT_PATH)"
echo ""
