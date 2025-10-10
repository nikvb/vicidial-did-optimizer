# VICIdial DID Optimizer - Testing Procedures

## Overview
This document provides comprehensive testing procedures to verify the correct installation and operation of the DID Optimizer integration with VICIdial. Follow these procedures after completing the dialplan setup.

## Test Environment Requirements

### Prerequisites
- VICIdial system with at least one configured campaign
- DID Optimizer API running at `http://api3.amdy.io:5000`
- Valid API key configured in `/etc/asterisk/dids.conf`
- At least one test agent account
- Test phone numbers for placing calls
- Access to Asterisk CLI and VICIdial admin interface

### Test Data Setup
```sql
-- Create test campaign in VICIdial database
INSERT INTO vicidial_campaigns (campaign_id, campaign_name, active, dial_prefix)
VALUES ('TEST001', 'DID Optimizer Test Campaign', 'Y', '9');

-- Create test user
INSERT INTO vicidial_users (user, pass, full_name, user_level)
VALUES ('6666', '1234', 'Test Agent', '1');
```

## Phase 1: Component Testing

### Test 1.1: Configuration File Validation
```bash
# Run the verification script
sudo ./verify-dialplan-setup.sh

# Expected output: All green checkmarks
# Document any failures for troubleshooting
```

### Test 1.2: API Connectivity
```bash
# Test health endpoint
curl -I http://api3.amdy.io:5000/api/v1/health \
     -H "x-api-key: did_315b95e7b2107598f4c5c6f51d21b3ac1768892fa81c1bb3ea38756bb1c2b43e"

# Expected: HTTP 200 OK

# Test DID selection endpoint
curl -X GET "http://api3.amdy.io:5000/api/v1/dids/next?campaign_id=TEST001&agent_id=6666" \
     -H "x-api-key: did_315b95e7b2107598f4c5c6f51d21b3ac1768892fa81c1bb3ea38756bb1c2b43e" \
     | python3 -m json.tool

# Expected: JSON response with phoneNumber field
```

### Test 1.3: AGI Script Execution
```bash
# Test AGI script directly
cat > /tmp/test-agi-input.txt << 'EOF'
agi_request: vicidial-did-optimizer.agi
agi_channel: SIP/test-00000001
agi_language: en
agi_type: SIP
agi_uniqueid: 1234567890.1
agi_callerid: 4155551234
agi_context: default
agi_extension: 18005551234
agi_priority: 1

EOF

# Run test
sudo -u asterisk bash -c "export CAMPAIGN_ID=TEST001; export AGENT_USER=6666; /usr/share/astguiclient/vicidial-did-optimizer.agi < /tmp/test-agi-input.txt"

# Expected: Output should include SET VARIABLE commands
```

### Test 1.4: Dialplan Context Verification
```bash
# Check if context exists
asterisk -rx "dialplan show did-optimizer"

# Expected: Shows the did-optimizer context with extensions

# Check for AGI references
asterisk -rx "dialplan show" | grep -i "did-optimizer"

# Expected: Shows references to the AGI script
```

## Phase 2: Integration Testing

### Test 2.1: Manual Dial Test

#### Setup
1. Login to VICIdial agent interface:
   ```
   URL: http://your-vicidial-server/agc/vicidial.php
   Phone Login: 6666
   Phone Password: 1234
   Campaign: TEST001
   ```

2. Open Asterisk CLI monitoring:
   ```bash
   asterisk -rvvv
   CLI> core set verbose 5
   ```

3. Monitor DID optimizer log:
   ```bash
   tail -f /var/log/astguiclient/did-optimizer.log
   ```

#### Test Procedure
1. Set agent to READY status
2. Click Manual Dial
3. Enter test number: 8005551234
4. Click DIAL

#### Expected Results
- Asterisk CLI shows AGI execution
- DID optimizer log shows API request
- Call uses DID from API, not default campaign CID
- Different DIDs on successive calls (rotation)

### Test 2.2: Auto-Dial Test

#### Setup
1. Create test list with 10 phone numbers:
   ```sql
   -- Add test leads to list
   INSERT INTO vicidial_list (list_id, phone_number, status, first_name, last_name)
   VALUES
   (101, '8005551001', 'NEW', 'Test', 'Lead1'),
   (101, '8005551002', 'NEW', 'Test', 'Lead2'),
   -- ... add more test numbers
   ```

2. Configure campaign for auto-dial:
   - Dial Method: RATIO
   - Auto Dial Level: 1.0
   - Campaign Lists: Include list 101

#### Test Procedure
1. Login agent to campaign
2. Set to READY
3. Wait for auto-dial to place calls
4. Monitor DID selection for each call

#### Expected Results
- Each call gets different DID (rotation)
- No errors in AGI execution
- Call records show selected DIDs

### Test 2.3: Geographic Matching Test

#### Setup
Create leads with state information:
```sql
INSERT INTO vicidial_list (list_id, phone_number, state, postal_code)
VALUES
(102, '4155551234', 'CA', '94102'),
(102, '2125551234', 'NY', '10001'),
(102, '3125551234', 'IL', '60601');
```

#### Test Procedure
1. Dial each lead manually
2. Check selected DID for each call

#### Expected Results
- California lead gets California DID (if available)
- New York lead gets New York DID (if available)
- Geographic matching working correctly

## Phase 3: Load Testing

### Test 3.1: Concurrent Call Test

#### Setup
```bash
# Create concurrent call script
cat > /tmp/concurrent-test.sh << 'EOF'
#!/bin/bash
for i in {1..10}; do
    (curl -X GET "http://api3.amdy.io:5000/api/v1/dids/next?campaign_id=TEST001&agent_id=600$i" \
         -H "x-api-key: did_315b95e7b2107598f4c5c6f51d21b3ac1768892fa81c1bb3ea38756bb1c2b43e" \
         > /tmp/did-test-$i.log 2>&1) &
done
wait
echo "All requests completed"
EOF

chmod +x /tmp/concurrent-test.sh
```

#### Test Procedure
```bash
# Run concurrent test
/tmp/concurrent-test.sh

# Check results
for i in {1..10}; do
    echo "Request $i:"
    cat /tmp/did-test-$i.log | python3 -m json.tool | grep phoneNumber
done
```

#### Expected Results
- All requests succeed
- Different DIDs returned (rotation working)
- Response time under 1 second

### Test 3.2: High Volume Test

#### Setup
Configure campaign for high volume:
- Auto Dial Level: 3.0
- Add 100 test leads to list

#### Test Procedure
1. Login 5 agents to campaign
2. Set all to READY
3. Monitor for 10 minutes

#### Expected Results
- No API timeouts
- DID rotation continues working
- No duplicate DIDs in same time window

## Phase 4: Failure Testing

### Test 4.1: API Failure Test

#### Test Procedure
1. Temporarily stop API service:
   ```bash
   # Find and stop the API service
   ps aux | grep "node server-full.js"
   # Stop the process
   ```

2. Place test call through VICIdial

#### Expected Results
- Fallback DID is used (+18005551234)
- Call completes successfully
- Error logged in did-optimizer.log

3. Restart API service:
   ```bash
   PORT=5000 node /home/na/didapi/server-full.js &
   ```

### Test 4.2: Invalid API Key Test

#### Test Procedure
1. Temporarily modify API key in config:
   ```bash
   sudo cp /etc/asterisk/dids.conf /etc/asterisk/dids.conf.backup
   sudo sed -i 's/api_key=.*/api_key=invalid_key_test/' /etc/asterisk/dids.conf
   ```

2. Place test call

#### Expected Results
- Fallback DID used
- Authentication error in logs
- Call still completes

3. Restore configuration:
   ```bash
   sudo mv /etc/asterisk/dids.conf.backup /etc/asterisk/dids.conf
   ```

### Test 4.3: Network Timeout Test

#### Test Procedure
1. Add artificial delay to test timeout:
   ```bash
   # Use iptables to add delay (requires root)
   sudo tc qdisc add dev eth0 root netem delay 6000ms
   ```

2. Place test call

#### Expected Results
- Timeout after 5 seconds (configured timeout)
- Fallback DID used
- Timeout error logged

3. Remove delay:
   ```bash
   sudo tc qdisc del dev eth0 root netem
   ```

## Phase 5: Performance Testing

### Test 5.1: Response Time Measurement

#### Test Script
```bash
cat > /tmp/performance-test.sh << 'EOF'
#!/bin/bash

echo "DID Optimizer Performance Test"
echo "=============================="

TOTAL_REQUESTS=100
SUCCESS_COUNT=0
TOTAL_TIME=0

for i in $(seq 1 $TOTAL_REQUESTS); do
    START=$(date +%s.%N)

    RESPONSE=$(curl -s -w "\n%{http_code}" \
        "http://api3.amdy.io:5000/api/v1/dids/next?campaign_id=PERF&agent_id=$i" \
        -H "x-api-key: did_315b95e7b2107598f4c5c6f51d21b3ac1768892fa81c1bb3ea38756bb1c2b43e")

    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    END=$(date +%s.%N)

    DURATION=$(echo "$END - $START" | bc)

    if [ "$HTTP_CODE" = "200" ]; then
        SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
        TOTAL_TIME=$(echo "$TOTAL_TIME + $DURATION" | bc)
        echo "Request $i: Success - ${DURATION}s"
    else
        echo "Request $i: Failed - HTTP $HTTP_CODE"
    fi

    sleep 0.1
done

AVG_TIME=$(echo "scale=3; $TOTAL_TIME / $SUCCESS_COUNT" | bc)

echo ""
echo "Results:"
echo "- Total Requests: $TOTAL_REQUESTS"
echo "- Successful: $SUCCESS_COUNT"
echo "- Failed: $((TOTAL_REQUESTS - SUCCESS_COUNT))"
echo "- Average Response Time: ${AVG_TIME}s"
EOF

chmod +x /tmp/performance-test.sh
```

#### Test Procedure
```bash
/tmp/performance-test.sh
```

#### Expected Results
- 100% success rate
- Average response time < 500ms
- No errors or timeouts

### Test 5.2: Cache Performance Test

#### Test Procedure
1. Enable cache in configuration
2. Make repeated requests with same parameters:
   ```bash
   for i in {1..10}; do
       time curl -s "http://api3.amdy.io:5000/api/v1/dids/next?campaign_id=CACHE&agent_id=1001" \
            -H "x-api-key: did_315b95e7b2107598f4c5c6f51d21b3ac1768892fa81c1bb3ea38756bb1c2b43e" \
            > /dev/null
   done
   ```

#### Expected Results
- First request: ~200-500ms
- Subsequent requests: < 50ms (cache hits)

## Phase 6: Production Validation

### Test 6.1: Live Campaign Test

#### Prerequisites
- Production campaign configured
- Real agents logged in
- Actual phone numbers in list

#### Test Procedure
1. Enable DID optimizer for one campaign
2. Monitor for 1 hour
3. Collect metrics

#### Metrics to Track
```sql
-- Query to check DID usage
SELECT
    callerid_number,
    COUNT(*) as call_count,
    AVG(talk_time) as avg_talk_time,
    SUM(CASE WHEN status = 'SALE' THEN 1 ELSE 0 END) as sales
FROM vicidial_log
WHERE campaign_id = 'TEST001'
    AND call_date > NOW() - INTERVAL 1 HOUR
GROUP BY callerid_number
ORDER BY call_count DESC;
```

### Test 6.2: A/B Testing

#### Setup
- Campaign A: Using DID Optimizer
- Campaign B: Using static DIDs
- Same list, similar agents

#### Metrics to Compare
- Connection rate
- Average talk time
- Conversion rate
- Agent wait time

## Monitoring and Alerting

### Real-Time Monitoring Commands

```bash
# Watch DID selection in real-time
tail -f /var/log/astguiclient/did-optimizer.log | grep "Selected DID"

# Monitor API response times
tail -f /var/log/astguiclient/did-optimizer.log | grep "completed in"

# Check for errors
tail -f /var/log/astguiclient/did-optimizer.log | grep ERROR

# Monitor cache hits
tail -f /var/log/astguiclient/did-optimizer.log | grep "Cache hit"
```

### Daily Health Check Script

```bash
cat > /tmp/daily-health-check.sh << 'EOF'
#!/bin/bash

echo "DID Optimizer Daily Health Check"
echo "================================"
date

# Check API availability
API_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    http://api3.amdy.io:5000/api/v1/health \
    -H "x-api-key: did_315b95e7b2107598f4c5c6f51d21b3ac1768892fa81c1bb3ea38756bb1c2b43e")

echo "API Status: $API_STATUS"

# Check error rate
ERROR_COUNT=$(grep -c ERROR /var/log/astguiclient/did-optimizer.log)
echo "Total Errors: $ERROR_COUNT"

# Check fallback usage
FALLBACK_COUNT=$(grep -c "fallback DID" /var/log/astguiclient/did-optimizer.log)
echo "Fallback Usage: $FALLBACK_COUNT"

# Check average response time
AVG_TIME=$(grep "completed in" /var/log/astguiclient/did-optimizer.log | \
           tail -100 | \
           sed 's/.*completed in \([0-9.]*\).*/\1/' | \
           awk '{sum+=$1} END {print sum/NR}')
echo "Avg Response Time (last 100): ${AVG_TIME}s"

# Check DID rotation
UNIQUE_DIDS=$(grep "Selected DID" /var/log/astguiclient/did-optimizer.log | \
              tail -100 | \
              cut -d: -f2 | \
              sort -u | \
              wc -l)
echo "Unique DIDs (last 100 calls): $UNIQUE_DIDS"
EOF

chmod +x /tmp/daily-health-check.sh
```

## Troubleshooting Guide

### Common Issues and Solutions

#### Issue: No DID selection occurring
```bash
# Check 1: Verify AGI is being called
asterisk -rx "core show channels verbose" | grep optimizer

# Check 2: Verify variables are set
asterisk -rx "dialplan show" | grep CAMPAIGN_ID

# Solution: Update campaign custom dialplan entry
```

#### Issue: Always using fallback DID
```bash
# Check 1: Test API directly
curl -v "http://api3.amdy.io:5000/api/v1/dids/next?campaign_id=TEST" \
     -H "x-api-key: your_key"

# Check 2: Verify tenant has DIDs
# Run check-user-api.cjs to verify

# Solution: Ensure DIDs are active in database
```

#### Issue: Slow response times
```bash
# Check 1: Network latency
ping api3.amdy.io

# Check 2: API server load
# Check server-full.js process CPU usage

# Solution: Enable caching, optimize API queries
```

## Test Report Template

### Test Execution Summary
```
Date: ___________
Tester: ___________
Environment: [ ] Development [ ] Staging [ ] Production

Phase 1 - Component Testing:
[ ] Configuration Validation - Pass/Fail
[ ] API Connectivity - Pass/Fail
[ ] AGI Script Execution - Pass/Fail
[ ] Dialplan Verification - Pass/Fail

Phase 2 - Integration Testing:
[ ] Manual Dial Test - Pass/Fail
[ ] Auto-Dial Test - Pass/Fail
[ ] Geographic Matching - Pass/Fail

Phase 3 - Load Testing:
[ ] Concurrent Calls - Pass/Fail
[ ] High Volume - Pass/Fail

Phase 4 - Failure Testing:
[ ] API Failure - Pass/Fail
[ ] Invalid Key - Pass/Fail
[ ] Network Timeout - Pass/Fail

Phase 5 - Performance Testing:
[ ] Response Time - _____ ms average
[ ] Cache Performance - Pass/Fail

Phase 6 - Production Validation:
[ ] Live Campaign - Pass/Fail
[ ] A/B Testing - Results: _____

Overall Result: [ ] PASS [ ] FAIL

Notes:
_________________________________
_________________________________
_________________________________
```

## Conclusion

These testing procedures ensure comprehensive validation of the DID Optimizer integration. Execute all phases before deploying to production. Document any deviations or issues encountered during testing.

For support, refer to:
- VICIDIAL-DIALPLAN-SETUP.md
- AGI-SCRIPT-CONFIGURATION.md
- API-DOCUMENTATION.md

---
Document Version: 1.0
Last Updated: 2024
Compatible with: VICIdial 2.14+, Asterisk 13.x/16.x