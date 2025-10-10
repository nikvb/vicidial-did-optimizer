# AGI Data Capture Summary - VICIdial DID Optimizer

## Overview
The enhanced AGI script (`vicidial-did-optimizer-enhanced.agi`) now captures **ALL available data** from both Asterisk AGI and VICIdial, including the critical **dialed phone number**.

## Critical Data Points

### 🎯 DIALED NUMBER (YES, IT'S CAPTURED!)
```perl
$data{dialed_number} = $input{extension}  # Raw dialed number from Asterisk
$data{dialed_number_clean}                # Cleaned (removes 9, 91, 8, 81 prefixes)
$data{dialed_area_code}                   # Extracted area code (first 3 digits)
$data{dialed_exchange}                    # Extracted exchange (digits 4-6)
$data{dialed_npa_nxx}                     # Combined NPA-NXX for routing
```

## Complete Data Capture Matrix

### 1. Standard AGI Variables (From Asterisk)
| Variable | Source | Description | Example |
|----------|--------|-------------|---------|
| **extension** | `$input{extension}` | **DIALED NUMBER** | "918005551234" |
| channel | `$input{channel}` | Channel name | "SIP/trunk-00000001" |
| uniqueid | `$input{uniqueid}` | Unique call ID | "1234567890.123" |
| callerid | `$input{callerid}` | Caller ID number | "4155551234" |
| calleridname | `$input{calleridname}` | Caller ID name | "John Doe" |
| context | `$input{context}` | Dialplan context | "vicidial-auto" |
| priority | `$input{priority}` | Dialplan priority | "1" |
| accountcode | `$input{accountcode}` | Account code | "ACCT123" |
| dnid | `$input{dnid}` | Dialed Number ID | "8005551234" |
| rdnis | `$input{rdnis}` | Redirected DNIS | "8005559999" |

### 2. VICIdial Campaign Data
| Variable | AGI Variable Names Checked | Description |
|----------|---------------------------|-------------|
| campaign_id | CAMPAIGN_ID, CAMPAIGN, CAMPCUST | Campaign identifier |
| campaign_name | CAMPAIGN_NAME | Human-readable name |
| dial_prefix | DIAL_PREFIX | Dial prefix (9, 91, etc.) |
| trunk | TRUNK, TRUNKX | Trunk/carrier to use |

### 3. Agent Information
| Variable | AGI Variable Names Checked | Description |
|----------|---------------------------|-------------|
| agent_id | AGENT_USER, AGENT, AGENTUSER, CIDname | Agent login ID |
| agent_name | AGENT_NAME | Agent full name |
| agent_phone | AGENT_PHONE | Agent phone/extension |
| agent_station | AGENT_STATION | Agent workstation |

### 4. Customer/Lead Data
| Variable | AGI Variable Names Checked | Description |
|----------|---------------------------|-------------|
| lead_id | LEAD_ID, LEADID, VENDLEADCODE | Lead identifier |
| list_id | LIST_ID, LISTID | List identifier |
| customer_phone | CUSTOMER_PHONE, PHONE_NUMBER | Customer's phone |
| customer_state | CUSTOMER_STATE, STATE, PROVINCE | State/Province |
| customer_zip | CUSTOMER_ZIP, POSTAL_CODE, ZIP | ZIP/Postal code |
| customer_city | CUSTOMER_CITY, CITY | City |
| customer_area_code | Extracted from phone | Area code |
| customer_first_name | FIRST_NAME | First name |
| customer_last_name | LAST_NAME | Last name |
| customer_address | ADDRESS1 | Street address |
| customer_email | EMAIL | Email address |

### 5. Call Routing Information
| Variable | Description | Example |
|----------|-------------|---------|
| dialed_number | Raw number dialed | "918005551234" |
| dialed_number_clean | Cleaned (no prefix) | "8005551234" |
| dialed_area_code | Area code of dialed | "800" |
| dialed_exchange | Exchange of dialed | "555" |
| dial_timeout | Timeout in seconds | "60" |
| carrier | Carrier name | "Telnyx" |

### 6. VICIdial Specific Data
| Variable | Description |
|----------|-------------|
| epoch | Unix timestamp |
| uniqueid_epoch | VICIdial unique ID |
| vendor_lead_code | Vendor's lead code |
| source_id | Lead source identifier |
| hopper_id | Hopper entry ID |
| hopper_priority | Priority in hopper |
| called_count | Times this lead called |
| gmt_offset | GMT offset of lead |
| local_time | Lead's local time |
| tz_code | Time zone code |

### 7. Custom Fields
The script automatically captures custom fields 01-10:
- custom_01 through custom_10

### 8. Recording & Status
| Variable | Description |
|----------|-------------|
| recording_id | Recording identifier |
| recording_filename | Recording file name |
| script | Script ID being used |
| status | Lead status |

## Data Sent to API

The enhanced script sends the following to the DID Optimizer API:

### Query Parameters
```
GET /api/v1/dids/next?
  campaign_id={campaign}
  &agent_id={agent}
  &dialed_number={cleaned_dialed_number}     ← YES! DIALED NUMBER!
  &customer_phone={customer_phone}
  &customer_state={state}
  &customer_zip={zip}
  &customer_city={city}
  &customer_area_code={area_code}
  &lead_id={lead_id}
  &list_id={list_id}
  &vendor_lead_code={vendor_code}
  &uniqueid={call_id}
  &called_count={count}
  &hopper_priority={priority}
  &dialed_area_code={dialed_area}           ← Area code of dialed number
  &dialed_exchange={dialed_exchange}        ← Exchange of dialed number
```

### HTTP Headers
```
x-api-key: {api_key}
Content-Type: application/json
X-Request-ID: {uniqueid}
X-Campaign-ID: {campaign_id}
X-Agent-ID: {agent_id}
X-Dialed-Number: {dialed_number_clean}     ← Also in header!
```

## Variables Set After API Call

The script sets these variables for use in the dialplan:

```asterisk
OPTIMIZER_DID         # Selected DID to use
OPTIMIZER_STATUS      # SUCCESS or FAILURE
OPTIMIZER_FALLBACK    # YES or NO (if fallback used)
OPTIMIZER_TIMESTAMP   # Unix timestamp
OPTIMIZER_DIALED      # The number that was dialed
OPTIMIZER_PROVIDER    # DID provider name
OPTIMIZER_STATE       # DID state location
OPTIMIZER_AREACODE    # DID area code
OPTIMIZER_SCORE       # DID reputation score
OPTIMIZER_DID_ID      # Database ID of selected DID
```

## Statistics Logging

The enhanced statistics log now includes:
```csv
timestamp,selected_did,response_time,is_fallback,campaign,agent,dialed_number,customer_state,dialed_area_code
1704067200,+14155551234,0.234,0,CAMP001,1001,8005551234,CA,800
```

## Usage in Dialplan

To use all this data in your dialplan:

```asterisk
; Capture the dialed number and pass to AGI
exten => _91NXXNXXXXXX,1,NoOp(Dialing ${EXTEN} via DID Optimizer)
exten => _91NXXNXXXXXX,n,AGI(vicidial-did-optimizer-enhanced.agi)
exten => _91NXXNXXXXXX,n,NoOp(Selected DID: ${OPTIMIZER_DID} for dialed: ${OPTIMIZER_DIALED})
exten => _91NXXNXXXXXX,n,Set(CALLERID(num)=${OPTIMIZER_DID})
exten => _91NXXNXXXXXX,n,Dial(SIP/${EXTEN:1}@carrier,,tTo)
```

## Testing with All Data

Test the enhanced script with full data capture:

```bash
# Create comprehensive test
cat > /tmp/test-enhanced-agi.txt << 'EOF'
agi_request: vicidial-did-optimizer-enhanced.agi
agi_channel: SIP/trunk-00000001
agi_language: en
agi_type: SIP
agi_uniqueid: 1234567890.123
agi_callerid: 4155551234
agi_calleridname: Test Customer
agi_context: vicidial-auto
agi_extension: 918005551234
agi_priority: 1
agi_accountcode: ACCT123
agi_dnid: 8005551234

EOF

# Set VICIdial variables
export CAMPAIGN_ID="TEST001"
export AGENT_USER="1001"
export CUSTOMER_STATE="CA"
export CUSTOMER_ZIP="94102"
export LEAD_ID="12345"
export LIST_ID="100"

# Run test
sudo -u asterisk /home/na/didapi/vicidial-did-optimizer-enhanced.agi < /tmp/test-enhanced-agi.txt
```

## Key Improvements in Enhanced Version

1. **Captures Dialed Number**: From `$input{extension}` - the actual number being dialed
2. **Cleans Dial Prefixes**: Removes 9, 91, 8, 81 prefixes automatically
3. **Extracts Geographic Data**: Area code and exchange from dialed number
4. **Sends Complete Data to API**: All relevant call data for intelligent DID selection
5. **Comprehensive Logging**: Logs all data for debugging and analytics
6. **Enhanced Statistics**: Tracks dialed numbers in statistics

## Verification

To verify the dialed number is being captured:

```bash
# Watch the log for dialed numbers
tail -f /var/log/astguiclient/did-optimizer.log | grep "Dialed:"

# Check statistics for dialed numbers
cut -d',' -f7 /var/log/astguiclient/did-optimizer-stats.log | tail -20
```

## Conclusion

**YES, the enhanced script captures ALL data including the dialed phone number!** The dialed number comes from the AGI `extension` field and is:
- Captured as both raw and cleaned versions
- Sent to the API as `dialed_number` parameter
- Included in HTTP headers
- Logged in statistics
- Available for geographic matching (area code/exchange)

This ensures your DID Optimizer can make intelligent decisions based on:
- Where the call is going (dialed number)
- Who is making the call (agent)
- What campaign it's for
- Customer location information
- Call history and priority