#!/bin/bash

# Get auth token
echo "Getting auth token..."
TOKEN=$(curl -s -X POST https://dids.amdy.io/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"client@test3.com","password":"password123"}' | grep -o '"token":"[^"]*' | cut -d'"' -f4)

echo "Token: ${TOKEN:0:20}..."

# Sync campaigns
echo -e "\nSyncing campaigns..."
curl -s -X POST https://dids.amdy.io/api/v1/settings/vicidial/sync-campaigns \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
