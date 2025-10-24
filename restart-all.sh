#!/bin/bash

###############################################################################
# DID Optimizer - Restart All Servers
###############################################################################

echo "🔄 Restarting All Servers..."
echo ""

./stop-production.sh
./stop-dev.sh

echo ""
echo "⏳ Waiting 2 seconds..."
sleep 2
echo ""

./start-production.sh
echo ""
./start-dev.sh
echo ""

echo "✅ Restart complete!"
echo ""
./status.sh
