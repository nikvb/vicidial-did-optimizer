# 📋 VICIdial Dialplan Modification - Step-by-Step Guide

## Quick Method (Automated)

```bash
# Run the installer which handles everything:
sudo ./install-vicidial-integration.sh
```

## Manual Method - Detailed Steps

### Step 1: Backup Your Current Dialplan

```bash
# ALWAYS backup first!
sudo cp /etc/asterisk/extensions.conf /etc/asterisk/extensions.conf.backup.$(date +%Y%m%d_%H%M%S)
```

### Step 2: Locate Your VICIdial Dialplan Section

```bash
# Open the extensions.conf file
sudo nano /etc/asterisk/extensions.conf

# Search for [vicidial-auto] context (press Ctrl+W and type "vicidial-auto")
```

### Step 3: Add DID Optimizer Context BEFORE [vicidial-auto]

**Find this section in your extensions.conf:**
```asterisk
[vicidial-auto]
exten => _91NXXNXXXXXX,1,AGI(agi://127.0.0.1:4577/call_log)
exten => _91NXXNXXXXXX,2,Dial(${TESTSIPTRUNK}/${EXTEN:2},,To)
exten => _91NXXNXXXXXX,3,Hangup
```

**Add this BEFORE the [vicidial-auto] context:**
```asterisk
; ============================================
; DID OPTIMIZER INTEGRATION - INSERT THIS BEFORE [vicidial-auto]
; ============================================

[did-optimizer]
; Process calls from campaigns using COMPAT_DID_OPTIMIZER
exten => _X.,1,NoOp(=== DID Optimizer: Processing ${EXTEN} ===)
exten => _X.,n,Set(CUSTOMER_PHONE=${EXTEN})
exten => _X.,n,Set(CAMPAIGN_ID=${campaign})
exten => _X.,n,Set(AGENT_ID=${agent})

; Get customer location from database
exten => _X.,n,MYSQL(Connect connid localhost cron 1234 asterisk)
exten => _X.,n,MYSQL(Query resultid ${connid} SELECT state,postal_code FROM vicidial_list WHERE phone_number='${CUSTOMER_PHONE}' LIMIT 1)
exten => _X.,n,MYSQL(Fetch fetchid ${resultid} CUSTOMER_STATE CUSTOMER_ZIP)
exten => _X.,n,MYSQL(Clear ${resultid})
exten => _X.,n,MYSQL(Disconnect ${connid})

; Call DID optimizer
exten => _X.,n,System(/usr/share/astguiclient/vicidial-did-optimizer-config.pl "${CAMPAIGN_ID}" "${AGENT_ID}" "${CUSTOMER_PHONE}" "${CUSTOMER_STATE}" "${CUSTOMER_ZIP}" > /tmp/did_${CAMPAIGN_ID}_${UNIQUEID})

; Set optimized caller ID
exten => _X.,n,Set(SELECTED_DID=${FILE(/tmp/did_${CAMPAIGN_ID}_${UNIQUEID})})
exten => _X.,n,System(rm -f /tmp/did_${CAMPAIGN_ID}_${UNIQUEID})
exten => _X.,n,Set(CALLERID(num)=${SELECTED_DID})
exten => _X.,n,NoOp(DID Optimizer: Selected ${SELECTED_DID})
exten => _X.,n,Goto(vicidial-auto,${EXTEN},1)

; Report results after call
exten => h,1,System(/usr/share/astguiclient/vicidial-did-optimizer-config.pl --report "${CAMPAIGN_ID}" "${CUSTOMER_PHONE}" "${DIALSTATUS}" "${ANSWEREDTIME}" "${disposition}")
exten => h,n,Hangup()
```

### Step 4: Modify [vicidial-auto] Context

**Find the first line of [vicidial-auto] and add this intercept:**

```asterisk
[vicidial-auto]
; ADD THIS AS THE VERY FIRST LINE - intercepts DID optimizer campaigns
exten => _X.,1,GotoIf($["${CALLERID(num)}" = "COMPAT_DID_OPTIMIZER"]?did-optimizer,${EXTEN},1)

; Your existing dialplan continues below (renumber if needed)
exten => _X.,n,AGI(agi://127.0.0.1:4577/call_log)
; ... rest of your existing dialplan ...
```

### Step 5: Save and Exit

```bash
# In nano:
# Press Ctrl+X
# Press Y to save
# Press Enter to confirm filename
```

### Step 6: Check Syntax

```bash
# Verify dialplan syntax
sudo asterisk -rx "dialplan show did-optimizer"

# Check for errors
sudo asterisk -rx "core show hints" | grep -i error
```

### Step 7: Reload Dialplan

```bash
# Reload the dialplan
sudo asterisk -rx "dialplan reload"

# Verify it loaded
sudo asterisk -rx "dialplan show did-optimizer"
```

## 🔍 Where Exactly to Place the Code

### Visual Guide:

```asterisk
; === YOUR EXISTING FILE STRUCTURE ===

[globals]
; ... global variables ...

[default]
; ... default context ...

; ⬇️ INSERT DID-OPTIMIZER HERE ⬇️
[did-optimizer]
; ... our new code ...

[vicidial-auto]  ; ← MODIFY FIRST LINE HERE
exten => _X.,1,GotoIf(...)  ; ← ADD THIS LINE
; ... existing vicidial code ...

[other-contexts]
; ... rest of file ...
```

## 💡 Important Notes

### Line Numbers Matter!
- The `GotoIf` line MUST be priority 1 (first line executed)
- If your [vicidial-auto] already has `exten => _X.,1,...` then:
  1. Renumber existing lines: 1→2, 2→3, etc.
  2. Insert our GotoIf as the new priority 1

### Example Renumbering:

**Before:**
```asterisk
[vicidial-auto]
exten => _X.,1,AGI(agi://127.0.0.1:4577/call_log)
exten => _X.,2,Dial(...)
```

**After:**
```asterisk
[vicidial-auto]
exten => _X.,1,GotoIf($["${CALLERID(num)}" = "COMPAT_DID_OPTIMIZER"]?did-optimizer,${EXTEN},1)
exten => _X.,2,AGI(agi://127.0.0.1:4577/call_log)
exten => _X.,3,Dial(...)
```

## 🧪 Testing Your Changes

### 1. Test Context Loading:
```bash
# Should show your did-optimizer context
sudo asterisk -rx "dialplan show did-optimizer"
```

### 2. Test Script Access:
```bash
# Test as asterisk user
sudo -u asterisk /usr/share/astguiclient/vicidial-did-optimizer-config.pl --test
```

### 3. Watch Console During Test Call:
```bash
# In one terminal, watch Asterisk console
sudo asterisk -rvvv

# Look for:
# "=== DID Optimizer: Processing..."
# "DID Optimizer: Selected +1XXX..."
```

### 4. Check Logs:
```bash
tail -f /var/log/asterisk/messages
tail -f /var/log/astguiclient/did_optimizer.log
```

## ⚠️ Common Issues & Fixes

### "No such context 'did-optimizer'"
- The context wasn't added properly
- Check placement (must be before [vicidial-auto])
- Reload: `asterisk -rx "dialplan reload"`

### "Permission denied" on script
```bash
sudo chown asterisk:asterisk /usr/share/astguiclient/vicidial-did-optimizer-config.pl
sudo chmod +x /usr/share/astguiclient/vicidial-did-optimizer-config.pl
```

### Calls not using optimizer
- Check campaign settings: Outbound Caller ID must be `COMPAT_DID_OPTIMIZER`
- Verify GotoIf is priority 1 in [vicidial-auto]

### "MYSQL command not found"
- Your Asterisk may not have MySQL support
- Alternative: Use the simpler version in `vicidial-dialplan-simple.conf`

## 🎯 Quick Verification Checklist

✅ Backed up extensions.conf  
✅ Added [did-optimizer] context before [vicidial-auto]  
✅ Modified first line of [vicidial-auto] with GotoIf  
✅ Script installed at `/usr/share/astguiclient/`  
✅ Config file at `/etc/asterisk/dids.conf`  
✅ Dialplan reloaded  
✅ Campaign set to use `COMPAT_DID_OPTIMIZER`  

## 📞 Making a Test Call

1. Set campaign Outbound Caller ID to `COMPAT_DID_OPTIMIZER`
2. Place a test call
3. Watch Asterisk console for DID selection messages
4. Check `/var/log/astguiclient/did_optimizer.log`

That's it! Your dialplan is now integrated with the DID Optimizer.