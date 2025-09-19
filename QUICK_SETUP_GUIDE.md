# 🚀 VICIdial DID Optimizer - Quick Setup Guide

## 📋 Summary

Your VICIdial DID Optimizer integration is ready with **centralized configuration management**. All API keys and settings are now stored in `/etc/asterisk/dids.conf` for better security and maintenance.

## ⚡ Quick Installation (3 Steps)

### Step 1: Run Auto-Installer
```bash
# On your VICIdial server, run:
sudo ./install-vicidial-integration.sh
```

### Step 2: Configure API Settings
```bash
# Edit the configuration file:
sudo nano /etc/asterisk/dids.conf

# Update these lines:
api_base_url=http://your-did-server.com:3001
api_key=your_actual_api_key_here
```

### Step 3: Configure VICIdial Campaign
1. Login to **VICIdial Admin Interface**
2. Go to **Admin → Campaigns → [Your Campaign]**
3. Set **"Outbound Caller ID"** to: `COMPAT_DID_OPTIMIZER`
4. Set **"Campaign CID Override"** to: `Y`
5. Click **"SUBMIT"**

**🎉 Done!** Your campaign now uses intelligent DID optimization.

---

## 🔧 Manual Installation (If Auto-Installer Fails)

### 1. Install Files
```bash
# Copy configuration
sudo cp dids.conf /etc/asterisk/
sudo chown asterisk:asterisk /etc/asterisk/dids.conf
sudo chmod 600 /etc/asterisk/dids.conf

# Copy script
sudo cp vicidial-did-optimizer-config.pl /usr/share/astguiclient/
sudo chmod +x /usr/share/astguiclient/vicidial-did-optimizer-config.pl

# Create log directory
sudo mkdir -p /var/log/astguiclient
sudo chown asterisk:asterisk /var/log/astguiclient
```

### 2. Install Dependencies
```bash
# For Debian/Ubuntu:
sudo apt-get install libwww-perl libjson-perl libdbi-perl libdbd-mysql-perl

# OR using CPAN:
sudo cpan install LWP::UserAgent JSON DBI DBD::mysql
```

### 3. Add Dialplan Integration

**Edit `/etc/asterisk/extensions.conf` and add:**

```asterisk
; DID Optimizer Integration
[did-optimizer]
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

; Report call results
exten => h,1,System(/usr/share/astguiclient/vicidial-did-optimizer-config.pl --report "${CAMPAIGN_ID}" "${CUSTOMER_PHONE}" "${DIALSTATUS}" "${ANSWEREDTIME}" "${disposition}")
exten => h,n,Hangup()

; Modify your existing [vicidial-auto] context - ADD THIS AS FIRST LINE:
[vicidial-auto]
exten => _X.,1,GotoIf($["${CALLERID(num)}" = "COMPAT_DID_OPTIMIZER"]?did-optimizer,${EXTEN},1)
; ... rest of your existing dialplan ...
```

### 4. Reload Asterisk
```bash
sudo asterisk -rx "dialplan reload"
```

---

## 🧪 Testing

### Test Script Functionality
```bash
# Test configuration loading:
sudo -u asterisk /usr/share/astguiclient/vicidial-did-optimizer-config.pl --config

# Test API connection:
sudo -u asterisk /usr/share/astguiclient/vicidial-did-optimizer-config.pl --test

# Test DID selection:
sudo -u asterisk /usr/share/astguiclient/vicidial-did-optimizer-config.pl "TEST001" "1001" "4155551234" "CA" "94102"
```

### Monitor Logs
```bash
# Watch DID optimizer logs:
tail -f /var/log/astguiclient/did_optimizer.log

# Watch Asterisk logs:
tail -f /var/log/asterisk/messages
```

---

## 📁 Configuration File Reference

**Location:** `/etc/asterisk/dids.conf`

**Key Settings:**
```ini
[general]
# Your DID Optimizer server
api_base_url=http://your-server.com:3001
api_key=your_api_key_here

# Database connection (usually no changes needed)
db_host=localhost
db_user=cron
db_pass=1234
db_name=asterisk

# Optimization settings
daily_usage_limit=200
max_distance_miles=500
enable_geographic_routing=1

# Logging
log_file=/var/log/astguiclient/did_optimizer.log
debug=1
```

**Security:** The config file has restrictive permissions (600) and is only readable by the asterisk user.

---

## 🎯 How It Works

### Campaign Flow:
1. **VICIdial starts outbound call** with caller ID `COMPAT_DID_OPTIMIZER`
2. **Asterisk dialplan detects** the special caller ID and routes to DID optimizer
3. **Script queries database** for customer location (state, ZIP)
4. **API call made** to DID Optimizer with campaign, agent, and location data
5. **Optimal DID selected** based on geographic proximity and daily usage limits
6. **Caller ID updated** to the selected DID
7. **Call proceeds** with optimized DID
8. **Results reported** back to API for AI training after call completion

### Data Collected for AI Training:
- **Customer Demographics:** State, ZIP, age, gender, lead source
- **Call Context:** Time of day, day of week, agent performance
- **Geographic Data:** Distance between customer and DID location
- **Call Outcomes:** Duration, result, disposition

---

## 🚨 Troubleshooting

### Common Issues:

**❌ "API key not configured"**
```bash
# Solution: Update the config file
sudo nano /etc/asterisk/dids.conf
# Set: api_key=your_actual_key_here
```

**❌ "Permission denied"**
```bash
# Solution: Fix file permissions
sudo chown asterisk:asterisk /etc/asterisk/dids.conf
sudo chmod 600 /etc/asterisk/dids.conf
sudo chown asterisk:asterisk /usr/share/astguiclient/vicidial-did-optimizer-config.pl
sudo chmod +x /usr/share/astguiclient/vicidial-did-optimizer-config.pl
```

**❌ "Can't locate JSON.pm"**
```bash
# Solution: Install Perl dependencies
sudo apt-get install libwww-perl libjson-perl libdbi-perl libdbd-mysql-perl
```

**❌ "No DIDs found"**
- Check if your DID Optimizer server is running
- Verify API key and URL in `/etc/asterisk/dids.conf`
- Check server logs for API connectivity

### Support Commands:
```bash
# Check script permissions:
ls -la /usr/share/astguiclient/vicidial-did-optimizer-config.pl

# Check config file:
sudo cat /etc/asterisk/dids.conf

# Test API connectivity:
curl -H "x-api-key: YOUR_KEY" http://your-server:3001/api/v1/vicidial/health
```

---

## 🎊 Success Indicators

When working correctly, you'll see:

✅ **In Asterisk logs:**
```
DID Optimizer: Selected +14155551001 for campaign SALES001
```

✅ **In DID Optimizer logs:**
```
[2024-01-15 10:30:45] [INFO] Selected DID: +14155551001 (algorithm: geographic)
```

✅ **In VICIdial:**
- Outbound calls display local DIDs for customers
- Call logs show optimized caller IDs
- Improved answer rates due to local presence

Your VICIdial system now provides intelligent, data-driven DID optimization with comprehensive AI training data collection!