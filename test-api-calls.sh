#!/bin/bash
# Make test API calls to VICIdial DID endpoint

API_KEY="did_315b95e7b2107598f4c5c6f51d21b3ac1768892fa81c1bb3ea38756bb1c2b43e"

echo "Making 5 test API calls..."
for i in {1..5}; do
  echo "Call $i:"
  curl -s -X GET "http://api3.amdy.io:5000/api/v1/dids/next?campaign_id=TEST_CAMP_001&agent_id=AGENT_$i&customer_phone=555123456$i&customer_state=CA&customer_area_code=415" \
    -H "x-api-key: $API_KEY" | python3 -c "import sys, json; d = json.load(sys.stdin); print(f'  DID: {d.get(\"did\", {}).get(\"number\", \"N/A\")}')"
  sleep 0.5
done

echo ""
echo "Done! Checking CallRecords count..."
