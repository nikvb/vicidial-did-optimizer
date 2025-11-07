#!/bin/bash

# Change to the script directory
cd /home/na/didapi

# Load environment variables
source /home/na/didapi/.env 2>/dev/null || true

# Run the reputation scanner with daily update frequency
/usr/bin/node bulk_update_reputation_fast.js >> /var/log/reputation_scanner.log 2>&1