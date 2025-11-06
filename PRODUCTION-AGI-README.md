# Production-Ready AGI Script for VICIdial DID Optimizer

## Overview
The production AGI script (`vicidial-did-optimizer-production.agi`) provides realistic data capture with built-in privacy protection for GDPR/CCPA compliance.

## Key Corrections from Earlier Versions

### What We ACTUALLY Get from VICIdial

#### Always Available (from Asterisk AGI):
- **extension** - The dialed number (e.g., "918005551234")
- **channel** - Channel name (e.g., "SIP/trunk-00000001")
- **uniqueid** - Unique call identifier
- **context** - Dialplan context (e.g., "vicidial-auto")
- **priority** - Dialplan priority
- **accountcode** - If set in dialplan

#### Must Be Set in Dialplan:
```asterisk
; These variables must be explicitly set in your campaign dialplan:
exten => _X.,1,Set(CAMPAIGN_ID=${CAMPAIGN})
exten => _X.,n,Set(AGENT_USER=${CIDname})
exten => _X.,n,Set(LEAD_ID=${LEADID})        ; IF available
exten => _X.,n,Set(LIST_ID=${LISTID})        ; IF available
exten => _X.,n,Set(STATE=${STATE})           ; IF in lead data
exten => _X.,n,Set(ZIP=${ZIP})               ; IF in lead data
```

#### What We DON'T Automatically Get:
- ❌ Full agent details (name, station, etc.)
- ❌ Complete campaign configuration
- ❌ Customer personal information (unless passed)
- ❌ Custom fields (unless explicitly set)
- ❌ Call history data

## Privacy Mode Feature

### Configuration
In `/etc/asterisk/dids.conf`:
```ini
; Privacy mode: 0=OFF (default), 1=ON
privacy_mode=0
```

### Privacy Mode Comparison

| Data Type | Privacy OFF (0) | Privacy ON (1) |
|-----------|-----------------|----------------|
| Dialed Number | Full number sent | Full number sent (needed for routing) |
| Campaign ID | Sent | Sent |
| Agent ID | Sent | Sent |
| Customer Phone | Full number sent | Only area code + SHA256 hash |
| Lead ID | Actual ID sent | SHA256 hash only |
| Customer State | Sent | Sent (needed for geo-routing) |
| Customer ZIP | Sent | NOT sent |
| Customer City | Sent | NOT sent |
| Customer Name | Sent if available | NOT sent |
| Logs | Full details | Phone numbers masked |
| Statistics | Full numbers | Numbers shown as "REDACTED" |

### When to Use Privacy Mode

**Enable Privacy Mode (=1) when:**
- Operating in GDPR regions (EU)
- Subject to CCPA (California)
- Handling sensitive customer data
- Required by company privacy policy
- Testing with production data

**Keep Privacy Mode OFF (=0) when:**
- Need precise geographic matching
- Require detailed analytics
- Operating in regions without privacy requirements
- Using test data only

## Installation

### 1. Choose Your Script Version

```bash
# For production with privacy considerations:
sudo cp /home/na/didapi/vicidial-did-optimizer-production.agi \
        /usr/share/astguiclient/vicidial-did-optimizer.agi

# Make executable
sudo chmod +x /usr/share/astguiclient/vicidial-did-optimizer.agi
```

### 2. Configure Privacy Settings

```bash
# Copy template
sudo cp /home/na/didapi/dids.conf.template /etc/asterisk/dids.conf

# Edit configuration
sudo nano /etc/asterisk/dids.conf

# Key settings to review:
# - privacy_mode (0 or 1)
# - debug_mode (0 for production)
# - log_level (WARNING or ERROR for production)
```

### 3. Update Campaign Dialplan

In VICIdial Admin → Campaign → Custom Dialplan Entry:
```asterisk
; Minimum required variables
exten => _X.,1,Set(CAMPAIGN_ID=${CAMPAIGN})
exten => _X.,n,Set(AGENT_USER=${AGENT})

; Optional: Add customer data IF you need geographic matching
; AND privacy_mode=0 or you only need state-level matching
exten => _X.,n,Set(LEAD_ID=${LEADID})
exten => _X.,n,Set(STATE=${STATE})
exten => _X.,n,Set(ZIP=${ZIP})

exten => _X.,n,Return()
```

### 4. Carrier Dialplan

```asterisk
; Route through DID optimizer
exten => _91NXXNXXXXXX,1,AGI(vicidial-did-optimizer.agi)
exten => _91NXXNXXXXXX,n,Set(CALLERID(num)=${OPTIMIZER_DID})
exten => _91NXXNXXXXXX,n,Dial(SIP/${EXTEN:1}@carrier,,tTo)
exten => _91NXXNXXXXXX,n,Hangup()
```

## Testing

### Test Basic Functionality
```bash
# Test without customer data
cat > /tmp/test-basic.txt << 'EOF'
agi_request: vicidial-did-optimizer.agi
agi_channel: SIP/test-00000001
agi_uniqueid: 1234567890.1
agi_context: default
agi_extension: 918005551234
agi_priority: 1

EOF

export CAMPAIGN_ID="TEST001"
export AGENT_USER="1001"

sudo -u asterisk /usr/share/astguiclient/vicidial-did-optimizer.agi < /tmp/test-basic.txt
```

### Test Privacy Mode
```bash
# First test with privacy OFF
sudo sed -i 's/privacy_mode=.*/privacy_mode=0/' /etc/asterisk/dids.conf

export CUSTOMER_PHONE="4155551234"
export STATE="CA"
export ZIP="94102"
export LEAD_ID="12345"

sudo -u asterisk /usr/share/astguiclient/vicidial-did-optimizer.agi < /tmp/test-basic.txt

# Check what was logged
tail -5 /var/log/astguiclient/did-optimizer.log

# Now test with privacy ON
sudo sed -i 's/privacy_mode=.*/privacy_mode=1/' /etc/asterisk/dids.conf

sudo -u asterisk /usr/share/astguiclient/vicidial-did-optimizer.agi < /tmp/test-basic.txt

# Check privacy masking in logs
tail -5 /var/log/astguiclient/did-optimizer.log
# Should show masked phone numbers and "REDACTED" in places
```

## Monitoring

### Check Privacy Mode Status
```bash
# Current setting
grep "privacy_mode=" /etc/asterisk/dids.conf

# Check if privacy is working in logs
grep "Privacy mode ON" /var/log/astguiclient/did-optimizer.log | tail -5

# Look for masked data
grep "REDACTED" /var/log/astguiclient/did-optimizer-stats.log | tail -5
```

### Performance Monitoring
```bash
# Average response time
awk -F',' '{sum+=$3; count++} END {printf "Avg: %.3fs\n", sum/count}' \
    /var/log/astguiclient/did-optimizer-stats.log

# Fallback usage rate
awk -F',' '$4==1 {fallback++} END {printf "Fallback rate: %.1f%%\n",
    (fallback/NR)*100}' /var/log/astguiclient/did-optimizer-stats.log
```

## Compliance Considerations

### GDPR Compliance
- Enable `privacy_mode=1`
- Implement log rotation with deletion
- Document data processing in privacy policy
- Provide data export/deletion capabilities

### CCPA Compliance
- Enable `privacy_mode=1` for California residents
- Maintain opt-out mechanisms
- Document data usage

### HIPAA Considerations
- Use `privacy_mode=1`
- Encrypt logs at rest
- Implement audit logging
- Restrict access to statistics

## Troubleshooting

### Issue: Not getting customer data
**Solution:** Check campaign dialplan sets variables:
```bash
asterisk -rx "dialplan show" | grep -A5 "CAMPAIGN_ID"
```

### Issue: Privacy mode not working
**Solution:** Verify configuration:
```bash
# Check config
grep privacy_mode /etc/asterisk/dids.conf

# Test directly
perl -e 'print "Privacy: " . ($ENV{PRIVACY_MODE} || "not set") . "\n"'
```

### Issue: Geographic matching not working
**Solution:** In privacy mode, only state and area code are used:
- Ensure STATE variable is set in dialplan
- Area code is extracted from dialed number
- Full ZIP is NOT available in privacy mode

## Production Checklist

- [ ] Choose appropriate script version
- [ ] Set `privacy_mode` based on requirements
- [ ] Set `debug_mode=0`
- [ ] Set `log_level=WARNING` or `ERROR`
- [ ] Enable caching (`cache_enabled=1`)
- [ ] Configure log rotation
- [ ] Test fallback DID functionality
- [ ] Verify campaign dialplan variables
- [ ] Test with actual agent login
- [ ] Monitor initial calls closely
- [ ] Document privacy settings for compliance

## Summary

The production AGI script provides:
1. **Realistic data capture** - Only data actually available from VICIdial
2. **Privacy protection** - Optional PII masking for compliance
3. **Efficient operation** - Caching and optimized logging
4. **Fallback safety** - Guaranteed DID even if API fails
5. **Compliance ready** - GDPR/CCPA compatible with privacy mode

Use `privacy_mode=1` when handling real customer data in production, especially in regulated environments.