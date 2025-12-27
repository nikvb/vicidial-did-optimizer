#!/bin/bash

# Change to the script directory
cd /home/na/didapi

# Lock file to prevent overlapping runs
LOCKFILE="/tmp/reputation_scanner.lock"
LOGFILE="/var/log/reputation_scanner.log"

# Check if already running
if [ -f "$LOCKFILE" ]; then
    PID=$(cat "$LOCKFILE")
    if ps -p "$PID" > /dev/null 2>&1; then
        echo "$(date): Scanner already running (PID: $PID), skipping..." >> "$LOGFILE"
        exit 0
    else
        echo "$(date): Stale lock file found, removing..." >> "$LOGFILE"
        rm -f "$LOCKFILE"
    fi
fi

# Check if bulk update is already running
SCRAPER_COUNT=$(pgrep -f "bulk_update_reputation.py" | wc -l)
if [ "$SCRAPER_COUNT" -gt 1 ]; then
    echo "$(date): Bulk updater already running ($SCRAPER_COUNT processes), skipping..." >> "$LOGFILE"
    exit 0
fi

# Create lock file
echo $$ > "$LOCKFILE"

# Load environment variables
source /home/na/didapi/.env 2>/dev/null || true

# Run the fast Python-based reputation scanner
# Updates DIDs not checked in 48 hours at ~60 requests/sec with proxy rotation
echo "$(date): Starting fast Python reputation scanner..." >> "$LOGFILE"
/usr/bin/python3 scripts/bulk_update_reputation.py --concurrency 50 >> "$LOGFILE" 2>&1
EXIT_CODE=$?

# Remove lock file
rm -f "$LOCKFILE"

echo "$(date): Reputation scanner finished (exit code: $EXIT_CODE)" >> "$LOGFILE"
