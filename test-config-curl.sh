#!/bin/bash

echo "🔐 Logging in..."
curl -s https://dids.amdy.io/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"client@test3.com","password":"password123"}' \
  > /tmp/login-resp.json

TOKEN=$(cat /tmp/login-resp.json | python3 -c "import sys, json; print(json.load(sys.stdin)['data']['tokens']['accessToken'])" 2>/dev/null)

if [ -z "$TOKEN" ]; then
  echo "❌ Failed to get token"
  cat /tmp/login-resp.json
  exit 1
fi

echo "✅ Token obtained: ${TOKEN:0:20}..."
echo ""
echo "📥 Fetching config..."
curl -s "https://dids.amdy.io/api/v1/settings/vicidial/generate-config" \
  -H "Authorization: Bearer $TOKEN" | head -20
