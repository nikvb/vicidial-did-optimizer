# VICIdial Dialplan Integration Guide

## Overview
This guide shows how to integrate the DID Optimizer script into VICIdial's dialplan to automatically select optimal DIDs for outbound calls.

## Method 1: Campaign-Level Integration (Recommended)

### Step 1: Configure Campaign in VICIdial Admin

1. **Login to VICIdial Admin Interface**
2. **Navigate to:** Admin → Campaigns → Campaign Detail
3. **Select your campaign** to edit
4. **Find the "Outbound Caller ID" section**
5. **Set the following fields:**

```
Outbound Caller ID: COMPAT_DID_OPTIMIZER
Campaign CID Override: Y
```

### Step 2: Create Custom Dialplan Context

Create a new file: `/etc/asterisk/extensions-did-optimizer.conf`

```asterisk
; DID Optimizer Integration Context
; Include this in your main extensions.conf

[did-optimizer-outbound]
; This context handles DID optimization for outbound calls
; Variables available: ${campaign_id}, ${phone_number}, ${agent_id}

; Get customer location data from vicidial_list table
exten => _X.,1,NoOp(=== DID Optimizer: Starting call optimization ===)
exten => _X.,n,Set(CUSTOMER_PHONE=${EXTEN})
exten => _X.,n,Set(CAMPAIGN_ID=${campaign})
exten => _X.,n,Set(AGENT_ID=${agent})

; Get customer data from database
exten => _X.,n,AGI(agi://127.0.0.1:4577/call_log--HVcauses--PBX-${campaign}--${CUSTOMER_PHONE}--${AGENT_ID}--${epoch})
exten => _X.,n,Set(CUSTOMER_STATE=${customer_state})
exten => _X.,n,Set(CUSTOMER_ZIP=${customer_zip})

; Call DID optimizer script to get optimal DID
exten => _X.,n,System(/usr/share/astguiclient/vicidial-did-optimizer-config.pl "${CAMPAIGN_ID}" "${AGENT_ID}" "${CUSTOMER_PHONE}" "${CUSTOMER_STATE}" "${CUSTOMER_ZIP}" > /tmp/selected_did_${CAMPAIGN_ID}_${AGENT_ID})

; Read the selected DID
exten => _X.,n,Set(SELECTED_DID=${FILE(/tmp/selected_did_${CAMPAIGN_ID}_${AGENT_ID})})
exten => _X.,n,System(rm -f /tmp/selected_did_${CAMPAIGN_ID}_${AGENT_ID})

; Set the caller ID to the optimized DID
exten => _X.,n,Set(CALLERID(num)=${SELECTED_DID})
exten => _X.,n,Set(CALLERID(name)=)

; Log the selection
exten => _X.,n,NoOp(DID Optimizer: Selected ${SELECTED_DID} for campaign ${CAMPAIGN_ID}, customer ${CUSTOMER_PHONE})

; Continue with normal VICIdial outbound call processing
exten => _X.,n,Goto(vicidial-auto,${EXTEN},1)

; Handle call completion and report results
exten => h,1,NoOp(=== DID Optimizer: Call completed ===)
exten => h,n,Set(CALL_RESULT=${DIALSTATUS})
exten => h,n,Set(CALL_DURATION=${ANSWEREDTIME})
exten => h,n,Set(CALL_DISPOSITION=${disposition})

; Report call result to DID optimizer API
exten => h,n,System(/usr/share/astguiclient/vicidial-did-optimizer-config.pl --report "${CAMPAIGN_ID}" "${CUSTOMER_PHONE}" "${CALL_RESULT}" "${CALL_DURATION}" "${CALL_DISPOSITION}")

; Clean up
exten => h,n,NoOp(DID Optimizer: Results reported for ${CUSTOMER_PHONE})
```

### Step 3: Modify Main Extensions.conf

Add this line to `/etc/asterisk/extensions.conf`:

```asterisk
; Include DID Optimizer contexts
#include extensions-did-optimizer.conf

; Modify your existing outbound context
[vicidial-auto]
; Add DID optimization for campaigns using COMPAT_DID_OPTIMIZER
exten => _X.,1,GotoIf($["${CALLERID(num)}" = "COMPAT_DID_OPTIMIZER"]?did-optimizer-outbound,${EXTEN},1)

; Continue with existing VICIdial logic
exten => _X.,n,NoOp(Standard VICIdial outbound call)
; ... rest of your existing dialplan ...
```

## Method 2: AGI Script Integration (Advanced)

### Step 1: Create AGI Wrapper Script

Create `/usr/share/astguiclient/agi-bin/did_optimizer.agi`:

```bash
#!/bin/bash

# DID Optimizer AGI Script
# Called from VICIdial dialplan to get optimal DID

# Read AGI environment
while read line; do
    if [ -z "$line" ]; then
        break
    fi
    eval "export AGI_${line//[:= ]/_}"
done

# Get parameters
CAMPAIGN_ID="$1"
AGENT_ID="$2"
CUSTOMER_PHONE="$3"
CUSTOMER_STATE="$4"
CUSTOMER_ZIP="$5"

# Call DID optimizer
SELECTED_DID=$(/usr/share/astguiclient/vicidial-did-optimizer-config.pl "$CAMPAIGN_ID" "$AGENT_ID" "$CUSTOMER_PHONE" "$CUSTOMER_STATE" "$CUSTOMER_ZIP" 2>/dev/null)

# Return result to Asterisk
echo "SET VARIABLE OPTIMIZED_DID \"$SELECTED_DID\""
echo "VERBOSE \"DID Optimizer selected: $SELECTED_DID\" 1"

exit 0
```

Make it executable:
```bash
chmod +x /usr/share/astguiclient/agi-bin/did_optimizer.agi
```

### Step 2: AGI Dialplan Context

```asterisk
[did-optimizer-agi]
; AGI-based DID optimization

exten => _X.,1,NoOp(=== DID Optimizer AGI: Starting ===)
exten => _X.,n,Set(CUSTOMER_PHONE=${EXTEN})
exten => _X.,n,Set(CAMPAIGN_ID=${campaign})
exten => _X.,n,Set(AGENT_ID=${agent})

; Get customer data from vicidial_list
exten => _X.,n,MYSQL(Connect connid localhost cron 1234 asterisk)
exten => _X.,n,MYSQL(Query resultid ${connid} SELECT state,postal_code FROM vicidial_list WHERE phone_number='${CUSTOMER_PHONE}' LIMIT 1)
exten => _X.,n,MYSQL(Fetch fetchid ${resultid} CUSTOMER_STATE CUSTOMER_ZIP)
exten => _X.,n,MYSQL(Clear ${resultid})
exten => _X.,n,MYSQL(Disconnect ${connid})

; Call DID optimizer AGI
exten => _X.,n,AGI(did_optimizer.agi,${CAMPAIGN_ID},${AGENT_ID},${CUSTOMER_PHONE},${CUSTOMER_STATE},${CUSTOMER_ZIP})

; Set the optimized caller ID
exten => _X.,n,Set(CALLERID(num)=${OPTIMIZED_DID})
exten => _X.,n,NoOp(DID Optimizer: Using ${OPTIMIZED_DID} for ${CUSTOMER_PHONE})

; Continue with normal call flow
exten => _X.,n,Goto(vicidial-auto,${EXTEN},1)
```

## Method 3: VICIdial Custom Script Integration

### Step 1: Modify VICIdial Campaign Settings

1. **Login to VICIdial Admin**
2. **Go to:** Admin → Campaigns → Campaign Detail
3. **Find "Dial Statuses" section**
4. **Add custom script in "Campaign Script" field:**

```
DID_OPTIMIZER
```

### Step 2: Create VICIdial Custom Script

Create `/usr/share/astguiclient/ADMIN_area_text/templates/DID_OPTIMIZER.txt`:

```bash
#!/bin/bash
# VICIdial DID Optimizer Custom Script

CAMPAIGN_ID="$1"
PHONE_NUMBER="$2"
AGENT_ID="$3"

# Get customer location from VICIdial database
CUSTOMER_DATA=$(mysql -h localhost -u cron -p1234 -D asterisk -e "
SELECT state, postal_code
FROM vicidial_list
WHERE phone_number='$PHONE_NUMBER'
LIMIT 1" -s -N)

CUSTOMER_STATE=$(echo "$CUSTOMER_DATA" | cut -f1)
CUSTOMER_ZIP=$(echo "$CUSTOMER_DATA" | cut -f2)

# Get optimal DID
SELECTED_DID=$(/usr/share/astguiclient/vicidial-did-optimizer-config.pl "$CAMPAIGN_ID" "$AGENT_ID" "$PHONE_NUMBER" "$CUSTOMER_STATE" "$CUSTOMER_ZIP")

# Update the lead record with selected DID
mysql -h localhost -u cron -p1234 -D asterisk -e "
UPDATE vicidial_list
SET alt_phone='$SELECTED_DID'
WHERE phone_number='$PHONE_NUMBER'"

echo "DID_OPTIMIZER: Selected $SELECTED_DID for $PHONE_NUMBER"
```

## Installation Steps

### 1. Deploy Scripts
```bash
# Copy configuration file
sudo cp dids.conf /etc/asterisk/
sudo chmod 600 /etc/asterisk/dids.conf

# Copy integration script
sudo cp vicidial-did-optimizer-config.pl /usr/share/astguiclient/
sudo chmod +x /usr/share/astguiclient/vicidial-did-optimizer-config.pl

# Create log directory
sudo mkdir -p /var/log/astguiclient
```

### 2. Install Dependencies
```bash
# For Perl script
sudo cpan install LWP::UserAgent JSON DBI DBD::mysql

# For AGI script
sudo apt-get install mysql-client
```

### 3. Configure VICIdial Campaign

1. **Campaign Detail → Outbound Caller ID:**
   - Set to: `COMPAT_DID_OPTIMIZER`
   - Enable: "Campaign CID Override: Y"

2. **Save campaign settings**

### 4. Test Integration
```bash
# Test script directly
sudo -u asterisk /usr/share/astguiclient/vicidial-did-optimizer-config.pl --test

# Test with sample data
sudo -u asterisk /usr/share/astguiclient/vicidial-did-optimizer-config.pl "CAMPAIGN001" "1001" "4155551234" "CA" "94102"
```

## Advanced Configuration

### Real-time Customer Location Lookup

For enhanced geographic targeting, add this to your dialplan:

```asterisk
; Enhanced customer location lookup
exten => _X.,n,AGI(agi://127.0.0.1:4577/VD_hangup--PBX-${campaign}--${CUSTOMER_PHONE})
exten => _X.,n,Set(CUSTOMER_STATE=${customer_state})
exten => _X.,n,Set(CUSTOMER_ZIP=${customer_zip})
exten => _X.,n,Set(CUSTOMER_COORDS=${customer_latitude},${customer_longitude})

; Pass coordinates to DID optimizer
exten => _X.,n,System(/usr/share/astguiclient/vicidial-did-optimizer-config.pl "${CAMPAIGN_ID}" "${AGENT_ID}" "${CUSTOMER_PHONE}" "${CUSTOMER_STATE}" "${CUSTOMER_ZIP}" "${CUSTOMER_COORDS}")
```

### Multiple Campaign Support

```asterisk
; Route different campaigns to different optimization strategies
exten => _X.,1,GotoIf($["${campaign}" = "SALES"]?sales-optimization:default-optimization)

exten => _X.,n(sales-optimization),System(/usr/share/astguiclient/vicidial-did-optimizer-config.pl "${campaign}" "${agent}" "${EXTEN}" "${customer_state}" "${customer_zip}")
exten => _X.,n,Goto(continue-call)

exten => _X.,n(default-optimization),System(/usr/share/astguiclient/vicidial-did-optimizer-config.pl "${campaign}" "${agent}" "${EXTEN}")
exten => _X.,n,Goto(continue-call)

exten => _X.,n(continue-call),Set(CALLERID(num)=${FILE(/tmp/selected_did_${campaign}_${agent})})
```

## Troubleshooting

### 1. Check Script Permissions
```bash
ls -la /usr/share/astguiclient/vicidial-did-optimizer-config.pl
# Should show: -rwxr-xr-x asterisk asterisk
```

### 2. Check Configuration
```bash
sudo -u asterisk /usr/share/astguiclient/vicidial-did-optimizer-config.pl --config
```

### 3. Check Logs
```bash
tail -f /var/log/astguiclient/did_optimizer.log
tail -f /var/log/asterisk/messages
```

### 4. Test API Connection
```bash
sudo -u asterisk /usr/share/astguiclient/vicidial-did-optimizer-config.pl --test
```

## Integration Complete

Once configured, VICIdial will automatically:

1. **Detect campaigns** using `COMPAT_DID_OPTIMIZER` caller ID
2. **Extract customer location** from the vicidial_list database
3. **Call the DID optimizer** to get the best DID
4. **Set the caller ID** to the selected DID
5. **Report call results** back to the API for AI training

The system provides intelligent, automated DID selection with comprehensive data collection for continuous optimization.