# VICIdial DID Optimizer - Integration Files

Complete VICIdial integration using AGI-based approach with web-based setup tools.

## 📁 Files Included

### Core AGI Script
- **`vicidial-did-optimizer.agi`** - Production AGI script for real-time DID selection
  - Runs during call flow in Asterisk
  - Reads configuration from `/etc/asterisk/dids.conf`
  - Makes API requests to DID Optimizer for optimal DID selection
  - Sets `${OPTIMIZER_DID}` channel variable
  - Comprehensive logging and error handling
  - File-based caching for performance

### Call Results Sync
- **`process-call-results.pl`** - Syncs VICIdial call outcomes to DID Optimizer
  - Polls `vicidial_log` table every minute
  - Reports call results (answered, busy, no-answer, etc.)
  - Tracks call duration and disposition
  - Used for AI training and performance analytics
  - Auto-configured from VICIdial database
- **`install-call-results-sync.sh`** - One-line installer for call results sync
  - Downloads and installs sync script
  - Configures cron job (runs every minute)
  - Sets up logging
  - Verifies dependencies

### Installation Scripts
- **`install-agi.sh`** - AGI script installer (run this first)
  - Checks VICIdial environment
  - Installs required Perl modules
  - Downloads and installs AGI script
  - Sets proper permissions (755 for scripts, 600 for configs)
  - Creates log directory
  - Verifies installation

### Configuration File
- **`dids.conf`** - Template configuration file
  - API credentials and settings
  - Database configuration (auto-detected from VICIdial)
  - Geographic routing settings
  - Performance tuning options

## 🚀 Quick Installation (10-15 Minutes)

### Method 1: Web-Based Setup (Recommended)

1. **Configure VICIdial API User** (2 minutes)
   - Log in to VICIdial Admin
   - Go to **Admin → Users**
   - Create/modify API user with Level 8+
   - Enable "View Reports" permission
   - Go to **Admin → User Groups**
   - Set **Allowed Campaigns** to exactly **`-ALL`**

2. **Configure in DID Optimizer Web Interface** (2 minutes)
   - Log in to https://dids.amdy.io
   - Go to **Settings → VICIdial Integration**
   - Enter VICIdial hostname, username, password
   - Click **Test Connection** and **Sync Campaigns**

3. **Download Configuration File** (1 minute)
   - In **Settings → VICIdial Integration**
   - Click **Download dids.conf**
   - Upload to VICIdial server: `/etc/asterisk/dids.conf`
   ```bash
   scp dids.conf root@your-vicidial-server:/etc/asterisk/dids.conf
   sudo chmod 600 /etc/asterisk/dids.conf
   ```

4. **Install AGI Script** (3 minutes)
   ```bash
   cd /tmp
   wget https://raw.githubusercontent.com/nikvb/vicidial-did-optimizer/main/vicidial-integration/install-agi.sh
   chmod +x install-agi.sh
   sudo ./install-agi.sh
   ```

5. **Generate Modified Dialplan Using Website** (2 minutes)

   **IMPORTANT: Use the web-based dialplan generator - DO NOT edit files manually!**

   - **Step A**: In VICIdial Admin, go to **Admin → Carriers**
   - **Step B**: Select your carrier and copy the entire **Dialplan Entry** content
   - **Step C**: Go to https://dids.amdy.io and navigate to **Settings → VICIdial Integration**
   - **Step D**: Scroll to **"Step 2: Generate Modified Dialplan"** section
   - **Step E**: Paste your carrier's dialplan into the text area
   - **Step F**: Click **Generate Modified Dialplan** button
   - **Step G**: The generator will automatically insert the DID Optimizer AGI calls at the correct position
   - **Step H**: Click **Copy** button to copy the generated dialplan
   - **Step I**: Back in VICIdial Admin, replace your carrier's **Dialplan Entry** with the generated version
   - **Step J**: Click **Submit** - VICIdial automatically reloads the configuration

   **Why use the web generator?**
   - Automatically inserts AGI calls at the correct position
   - Preserves all existing VICIdial functionality
   - Handles different dialplan patterns correctly
   - No risk of syntax errors
   - Includes proper variable passing

6. **Test Integration** (2 minutes)
   ```bash
   # Make a test call
   tail -f /var/log/astguiclient/did-optimizer.log
   ```
   - Check DID Optimizer dashboard for call records

7. **Install Call Results Sync (Optional - Recommended)** (2 minutes)

   **IMPORTANT: This syncs VICIdial call outcomes back to DID Optimizer for AI training and performance analytics.**

   One-line installer:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/nikvb/vicidial-did-optimizer/main/vicidial-integration/install-call-results-sync.sh | sudo bash
   ```

   **What it does**:
   - Installs Perl dependencies (DBI, DBD::mysql, LWP::UserAgent, JSON)
   - Downloads and installs `process-call-results.pl`
   - Creates cron job to sync call results every minute
   - Automatically reads config from `/etc/asterisk/dids.conf`
   - Logs to `/var/log/did-optimizer-sync.log`

   **Monitor sync**:
   ```bash
   # View real-time sync logs
   tail -f /var/log/did-optimizer-sync.log

   # Check recent syncs
   grep 'Summary:' /var/log/did-optimizer-sync.log | tail -5
   ```

### Method 2: Command Line Installation (Advanced)

For advanced users who prefer command-line tools:

1. **Install AGI Script**
   ```bash
   cd /tmp
   wget https://raw.githubusercontent.com/nikvb/vicidial-did-optimizer/main/vicidial-integration/install-agi.sh
   chmod +x install-agi.sh
   sudo ./install-agi.sh
   ```

2. **Get API Key from Website**
   - Log in to https://dids.amdy.io
   - Go to **Settings → API Keys**
   - Create or copy your API key

3. **Configure dids.conf**
   ```bash
   sudo nano /etc/asterisk/dids.conf
   ```

   Update these required settings:
   ```ini
   [general]
   api_base_url=https://dids.amdy.io
   api_key=YOUR_API_KEY_HERE
   fallback_did=+18005551234

   # Database settings (usually auto-detected from /etc/astguiclient.conf)
   db_host=localhost
   db_user=cron
   db_pass=1234
   db_name=asterisk
   ```

4. **Generate Dialplan Using Website**

   **IMPORTANT: Even for command-line installation, use the web-based dialplan generator!**

   - Go to https://dids.amdy.io → **Settings → VICIdial Integration**
   - Copy your carrier's dialplan from **VICIdial Admin → Carriers**
   - Paste into the dialplan generator
   - Click **Generate Modified Dialplan**
   - Copy the generated dialplan back to VICIdial Admin
   - Click **Submit** in VICIdial Admin

   **DO NOT manually edit dialplan files** - the generator ensures correct integration.

## 🔧 Configuration Reference

### Required Settings (in `/etc/asterisk/dids.conf`)

```ini
[general]
# API Configuration (REQUIRED)
api_base_url=https://dids.amdy.io
api_key=YOUR_API_KEY_HERE
api_timeout=10
max_retries=3

# Fallback DID (REQUIRED - used when API unavailable)
fallback_did=+18005551234

# Logging
log_file=/var/log/astguiclient/did-optimizer.log
debug=1

# Database Configuration (usually auto-detected from /etc/astguiclient.conf)
db_host=localhost
db_user=cron
db_pass=1234
db_name=asterisk
db_port=3306

# Performance Settings
daily_usage_limit=200
max_distance_miles=500

# Geographic Settings
enable_geographic_routing=1
enable_state_fallback=1
enable_area_code_detection=1
```

## 📊 How It Works

### Call Flow

1. **Customer call initiated** through VICIdial
2. **Asterisk executes dialplan** which calls the AGI script
3. **AGI script reads configuration** from `/etc/asterisk/dids.conf`
4. **API request made** to DID Optimizer with:
   - Customer phone number
   - Campaign ID
   - Agent ID (if available)
   - Customer state/ZIP (if available from VICIdial database)
5. **Optimal DID selected** based on:
   - Geographic proximity to customer
   - Rotation rules and daily limits
   - Reputation scores
   - Campaign-specific settings
6. **Caller ID set** to the selected DID via `${OPTIMIZER_DID}` variable
7. **Call proceeds** with optimized DID
8. **Call tracked** in DID Optimizer dashboard

### Data Used for DID Selection

- **Customer Phone Number**: Area code and geographic detection
- **Campaign ID**: Campaign-specific rotation rules
- **Agent ID**: Agent-specific tracking
- **Customer Location**: State and ZIP code (from VICIdial database)
- **Time of Day**: For pattern analysis
- **Call History**: Previous outcomes and performance

## 🧪 Testing & Verification

### Test AGI Script
```bash
# Test with sample data
sudo -u asterisk /var/lib/asterisk/agi-bin/vicidial-did-optimizer.agi TEST001 1001 4155551234

# Expected output: Selected DID and debug information
```

### Monitor Logs
```bash
# Real-time log monitoring
tail -f /var/log/astguiclient/did-optimizer.log

# Search for errors
grep ERROR /var/log/astguiclient/did-optimizer.log

# View recent selections
grep "Selected DID" /var/log/astguiclient/did-optimizer.log | tail -20
```

### Test API Connection
```bash
curl -H "x-api-key: YOUR_API_KEY" https://dids.amdy.io/api/v1/health
```

### Verify in VICIdial
1. Make a test call through VICIdial
2. Check Asterisk logs: `asterisk -rx "core show channels verbose"`
3. Verify caller ID shows optimized DID
4. Check DID Optimizer dashboard for call record

## 🔥 Troubleshooting

### AGI Script Not Running

**Check AGI script exists and is executable:**
```bash
ls -la /var/lib/asterisk/agi-bin/vicidial-did-optimizer.agi
# Should show: -rwxr-xr-x (755 permissions)
```

**Check Perl modules:**
```bash
perl -e 'use LWP::UserAgent; use JSON; use URI::Escape; use Cache::FileCache; use Asterisk::AGI; print "OK\n"'
```

**Check logs:**
```bash
tail -100 /var/log/astguiclient/did-optimizer.log
```

### API Connection Failed

**Verify configuration:**
```bash
grep -E "^(api_base_url|api_key)" /etc/asterisk/dids.conf
```

**Test connectivity:**
```bash
curl -v -H "x-api-key: YOUR_API_KEY" https://dids.amdy.io/api/v1/health
```

**Check firewall:**
```bash
# Ensure outbound HTTPS (port 443) is allowed
sudo iptables -L OUTPUT -n | grep 443
```

### No DIDs Returned

**Possible causes:**
1. No DIDs loaded in DID Optimizer database
2. All DIDs at daily usage limit (200 calls/day default)
3. Reputation scores too low (< 50 filtered out)
4. Geographic filters too restrictive

**Check in DID Optimizer:**
- Go to **DID Management** page
- Verify DIDs are active and have good reputation
- Check usage statistics

### Configuration File Not Found

```bash
# Verify file exists
ls -la /etc/asterisk/dids.conf

# Should show: -rw------- (600 permissions)

# Re-download from web interface if missing
# Or copy from vicidial-integration/dids.conf
```

### Database Connection Issues

**Check VICIdial database config:**
```bash
cat /etc/astguiclient.conf | grep VARDB
```

**Test database connection:**
```bash
mysql -h localhost -u cron -p1234 asterisk -e "SELECT COUNT(*) FROM vicidial_list LIMIT 1"
```

### Call Results Sync Not Working

**Check if sync is installed:**
```bash
ls -la /usr/local/bin/did-optimizer/process-call-results.pl
crontab -l | grep process-call-results
```

**Monitor sync activity:**
```bash
# View real-time logs
tail -f /var/log/did-optimizer-sync.log

# Check recent syncs
grep 'Summary:' /var/log/did-optimizer-sync.log | tail -10

# Check for errors
grep 'ERROR\|Failed\|failed' /var/log/did-optimizer-sync.log
```

**Verify API configuration:**
```bash
grep 'api_key' /etc/asterisk/dids.conf
# Should NOT show: api_key=YOUR_API_KEY_HERE
```

**Manual test:**
```bash
# Run sync manually to see output
sudo perl /usr/local/bin/did-optimizer/process-call-results.pl
```

**Common issues:**
- API key not configured in `/etc/asterisk/dids.conf`
- VICIdial database credentials incorrect
- Perl modules missing (DBI, DBD::mysql, LWP::UserAgent, JSON)
- Network connectivity to DID Optimizer API

## 📝 File Locations

After installation, files will be located at:

- **AGI Script**: `/var/lib/asterisk/agi-bin/vicidial-did-optimizer.agi`
- **Configuration**: `/etc/asterisk/dids.conf`
- **Logs**: `/var/log/astguiclient/did-optimizer.log`
- **Cache**: `/tmp/did_optimizer/` (auto-created)

**Call Results Sync (if installed):**
- **Sync Script**: `/usr/local/bin/did-optimizer/process-call-results.pl`
- **Sync Logs**: `/var/log/did-optimizer-sync.log`
- **State File**: `/tmp/did-optimizer-last-check.txt`
- **Cron Job**: Runs every minute via root crontab

## ✅ Verification Checklist

Installation complete when:

- [ ] VICIdial API user created (level 8+)
- [ ] Allowed Campaigns set to `-ALL`
- [ ] VICIdial connection tested in web interface
- [ ] Campaigns synced from VICIdial
- [ ] dids.conf downloaded and uploaded to `/etc/asterisk/dids.conf`
- [ ] dids.conf permissions set to 600
- [ ] AGI script installed at `/var/lib/asterisk/agi-bin/vicidial-did-optimizer.agi`
- [ ] AGI script has 755 permissions
- [ ] Perl dependencies installed (LWP::UserAgent, JSON, etc.)
- [ ] Dialplan generated and updated in VICIdial Carriers
- [ ] Test call completed successfully
- [ ] Logs showing DID selection activity
- [ ] Dashboard showing call records

**Optional (but recommended):**
- [ ] Call results sync installed (`install-call-results-sync.sh`)
- [ ] Cron job running every minute
- [ ] Sync logs showing successful uploads (`/var/log/did-optimizer-sync.log`)

## 🎯 Advanced Configuration

### Custom API Timeout
```ini
[general]
api_timeout=15          # Increase for slow networks
max_retries=5           # More retries for reliability
```

### Geographic Routing
```ini
[general]
enable_geographic_routing=1
enable_state_fallback=1
max_distance_miles=500
```

### Usage Limits
```ini
[general]
daily_usage_limit=200   # Calls per DID per day
```

### Debug Logging
```ini
[general]
debug=1                 # Verbose logging
```

## 📞 Support

- **Documentation**: Full integration guide at https://github.com/nikvb/vicidial-did-optimizer/blob/main/QUICK_SETUP_GUIDE.md
- **Web Interface**: https://dids.amdy.io
- **GitHub Issues**: https://github.com/nikvb/vicidial-did-optimizer/issues
- **Support Email**: support@amdy.io

---

**Total Installation Time**: 10-15 minutes with web-based setup

Your VICIdial system will automatically optimize caller ID selection for improved answer rates and call performance!
