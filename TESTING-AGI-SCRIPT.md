# Testing VICIdial DID Optimizer AGI Script

## Debug Logging - Enabled by Default ✅

The AGI script has **TWO types of logging**:

### 1. `force_log()` - ALWAYS ENABLED (No configuration needed)
- **Bypasses ALL config checks**
- **Logs 100% of the time** regardless of settings
- Used for all detailed verbose debugging
- Writes to: `/var/log/astguiclient/did-optimizer.log`

### 2. `log_message()` - Requires config flag
- Respects `debug_mode` and `log_level` in `/etc/asterisk/dids.conf`
- Only for legacy/INFO level messages

**All the detailed verbose logging uses `force_log()`, so debugging is ON by default!**

---

## How to Call the Script from VICIdial

The AGI script accepts the phone number as an argument (recommended):

```
exten => _X.,1,AGI(vicidial-did-optimizer-production.agi,${PHONE_NUMBER})
```

**Order of phone number sources (priority):**
1. **AGI argument** (passed to script) - RECOMMENDED ✅
2. **Channel variable** PHONE_NUMBER or CUSTOMER_PHONE
3. **Extension field** (fallback - has prefixes, less reliable)

## Manual Testing (Without Asterisk)

### Option 1: Simple Test (Recommended)

```bash
cd /home/na/didapi
./test-agi-simple.sh
```

This simulates an Asterisk call with:
- Phone number: 18005551234 (via AGI argument)
- Caller ID: 5551234567
- Channel: SIP/trunk-00000123
- Unique ID: 1760138000.123

### Option 2: Perl Test Script

```bash
cd /home/na/didapi
./test-agi-manual.pl
```

More detailed output with structured test environment.

---

## View the Logs

### View Last 50 Lines
```bash
tail -50 /var/log/astguiclient/did-optimizer.log
```

### Watch in Real-Time
```bash
tail -f /var/log/astguiclient/did-optimizer.log
```

### View Full Log
```bash
cat /var/log/astguiclient/did-optimizer.log
```

### Search for Errors
```bash
grep ERROR /var/log/astguiclient/did-optimizer.log
```

### Search for API Calls
```bash
grep API /var/log/astguiclient/did-optimizer.log
```

---

## What the Log Will Show

When you run the test, you'll see detailed logs like:

```
[2025-10-10 23:30:00] [STARTUP] ==================== AGI SCRIPT STARTED ====================
[2025-10-10 23:30:00] [STARTUP] Initializing Asterisk AGI interface...
[2025-10-10 23:30:00] [STARTUP] AGI interface initialized successfully
[2025-10-10 23:30:00] [STARTUP] Reading AGI input parameters...
[2025-10-10 23:30:00] [STARTUP] AGI Input received - Channel: SIP/trunk-00000123 Extension: 18005551234 UniqueID: 1760138000.123
[2025-10-10 23:30:00] [CONFIG] Reading configuration from /etc/asterisk/dids.conf...
[2025-10-10 23:30:00] [CONFIG] Configuration loaded successfully
[2025-10-10 23:30:00] [CONFIG] API Base URL: http://api3.amdy.io:5000
[2025-10-10 23:30:00] [CONFIG] API Key: did_315b95e7b2107598...
[2025-10-10 23:30:00] [CONFIG] Fallback DID: +15551234567
[2025-10-10 23:30:00] [DATA] ======== COLLECTING CALL DATA ========
[2025-10-10 23:30:00] [DATA] --- Collecting AGI Input Variables ---
[2025-10-10 23:30:00] [DATA] AGI Input - extension: 18005551234
[2025-10-10 23:30:00] [DATA] --- Processing Dialed Number ---
[2025-10-10 23:30:00] [DATA] Raw dialed number: 18005551234
[2025-10-10 23:30:00] [DATA] Cleaned dialed number: 8005551234
[2025-10-10 23:30:00] [DATA] Extracted area code: 800, exchange: 555
[2025-10-10 23:30:00] [API] ======== CALLING DID OPTIMIZER API ========
[2025-10-10 23:30:00] [API] --- API Attempt 1 of 3 ---
[2025-10-10 23:30:00] [API] Full API URL: http://api3.amdy.io:5000/api/v1/dids/next?campaign_id=DEFAULT&agent_id=0&dialed_number=8005551234&dialed_area_code=800
[2025-10-10 23:30:00] [API] --- Making HTTP GET Request ---
[2025-10-10 23:30:00] [API] --- API Response Received ---
[2025-10-10 23:30:00] [API] HTTP Status: 200 OK
[2025-10-10 23:30:00] [API] ✓ HTTP Request SUCCESSFUL (2xx status)
[2025-10-10 23:30:00] [API] Response Content Length: 234 bytes
[2025-10-10 23:30:00] [API] Raw Response: {"success":true,"data":{"phoneNumber":"+14753368063",...}}
[2025-10-10 23:30:00] [API] JSON decoded successfully
[2025-10-10 23:30:00] [API] Response 'success' field: TRUE
[2025-10-10 23:30:00] [API] ✓ Phone number found in response: +14753368063
[2025-10-10 23:30:00] [API] Returning phone number: +14753368063
[2025-10-10 23:30:00] [COMPLETE] ======== DID SELECTION COMPLETED in 0.234 seconds ========
[2025-10-10 23:30:00] [COMPLETE] FINAL SELECTED DID: +14753368063
[2025-10-10 23:30:00] [EXIT] ==================== AGI SCRIPT EXITING ====================
```

---

## Troubleshooting

### If Log File Not Created

```bash
# Create log directory (on VICIdial server)
sudo mkdir -p /var/log/astguiclient
sudo chmod 777 /var/log/astguiclient
```

### If Script Fails to Run

1. Check configuration file exists:
   ```bash
   cat /etc/asterisk/dids.conf
   ```

2. Check script is executable:
   ```bash
   ls -la vicidial-did-optimizer-production.agi
   # Should show: -rwxr-xr-x
   ```

3. Check Perl modules are installed:
   ```bash
   perl -c vicidial-did-optimizer-production.agi
   ```

### Common Issues in Log

**Config File Missing:**
```
[ERROR] Configuration file not found: /etc/asterisk/dids.conf
```
→ Create `/etc/asterisk/dids.conf` with proper settings

**API Connection Failed:**
```
[API] ✗ HTTP Request FAILED
[API] Error: 500 Can't connect to api3.amdy.io:5000
```
→ Check API server is running and accessible

**JSON Parse Error:**
```
[API] ERROR: JSON decode failed: malformed JSON string
```
→ API returned invalid JSON response

**Empty Phone Number:**
```
[API] ✗ Response success=false OR phoneNumber missing
[API] phoneNumber field: MISSING/EMPTY
```
→ API returned success but no phone number in data

---

## Testing on VICIdial Server

When deploying to your VICIdial server:

1. Copy the script to VICIdial server
2. Make sure config file exists: `/etc/asterisk/dids.conf`
3. Run the test script: `./test-agi-simple.sh`
4. Check the log: `tail -f /var/log/astguiclient/did-optimizer.log`
5. Fix any configuration issues
6. Test with actual VICIdial call

The log will show you **exactly** why the script might be returning an empty DID.
