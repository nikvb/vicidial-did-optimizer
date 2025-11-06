# 🚀 VICIdial DID Optimizer - Quick Setup Guide

Complete VICIdial integration in **10-15 minutes** with our web-based setup tools.

## 📋 Prerequisites

- VICIdial server with root/sudo access
- DID Optimizer Pro account at https://dids.amdy.io
- Basic familiarity with VICIdial Admin interface

---

## ⚡ Quick Installation Steps

### Step 1: Configure VICIdial API User (2 minutes)

1. Log in to your VICIdial admin panel
2. Navigate to **Admin → Users**
3. Create or modify an API user:
   - Set **User Level** to **8** or higher (9 recommended)
   - Enable **View Reports** permission
   - Enable all **API Permissions** (or at minimum: `version`, `campaigns_list`)
4. Navigate to **Admin → User Groups**
5. Find your API user's group
6. Set **Allowed Campaigns** field to exactly **`-ALL`** (with the dash)
7. Click **Submit**

> **Important**: The Allowed Campaigns field must be exactly `-ALL` for the API to access all campaigns.

### Step 2: Configure DID Optimizer Settings (2 minutes)

1. Log in to DID Optimizer Pro at https://dids.amdy.io
2. Go to **Settings → VICIdial Integration**
3. Enter your VICIdial connection details:
   - **Hostname**: Your VICIdial server hostname or IP (e.g., `vicidial.yourcompany.com`)
   - **Username**: API user from Step 1
   - **Password**: API user password
4. Click **Test Connection** to verify
5. Once successful, click **Sync Campaigns** to import your campaigns

### Step 3: Download Configuration File (1 minute)

1. Still in **Settings → VICIdial Integration**
2. Scroll to **Integration Setup**
3. Click **Download dids.conf**
4. Save the file

### Step 4: Upload Configuration to VICIdial Server (2 minutes)

Transfer the downloaded `dids.conf` file to your VICIdial server:

```bash
# Option 1: Using SCP (from your local machine)
scp dids.conf root@your-vicidial-server:/etc/asterisk/dids.conf

# Option 2: Using SFTP or WinSCP (if on Windows)
# Upload dids.conf to /etc/asterisk/dids.conf

# Set proper permissions
sudo chmod 600 /etc/asterisk/dids.conf
```

### Step 5: Install AGI Script (3 minutes)

Download and run the installation script on your VICIdial server:

```bash
# Download installation script
cd /tmp
wget https://raw.githubusercontent.com/nikvb/vicidial-did-optimizer/main/vicidial-integration/install-agi.sh

# Make executable
chmod +x install-agi.sh

# Run installation (requires sudo)
sudo ./install-agi.sh
```

The install script will:
- ✓ Check VICIdial environment
- ✓ Install required Perl modules
- ✓ Download and install AGI script
- ✓ Set proper permissions
- ✓ Create log directory
- ✓ Verify installation

### Step 6: Generate Modified Dialplan (2 minutes)

Use the DID Optimizer web interface to automatically generate your modified dialplan:

1. **In VICIdial Admin**, go to **Admin → Carriers**
   - Select your carrier
   - Copy the entire **Dialplan Entry** content

2. **In DID Optimizer** at https://dids.amdy.io:
   - Go to **Settings → VICIdial Integration**
   - Scroll to **Step 2: Generate Modified Dialplan**
   - Paste your carrier's dialplan into the text area
   - Click **Generate Modified Dialplan**

3. **Copy the Generated Dialplan**:
   - The generator automatically inserts DID Optimizer AGI calls
   - Click the **Copy** button to copy the modified dialplan

4. **Update Your Carrier in VICIdial**:
   - Go back to **VICIdial Admin → Carriers**
   - Replace the **Dialplan Entry** with the generated version
   - Click **Submit**

> **Important**: The generator preserves all your existing VICIdial functionality (call logging, dial commands, etc.) and intelligently inserts the DID Optimizer AGI script at the correct position.

### Step 7: Test the Integration (2 minutes)

1. Make a test call through VICIdial
2. Monitor the logs:
   ```bash
   tail -f /var/log/astguiclient/did-optimizer.log
   ```
3. You should see DID selection activity in the logs
4. Check the DID Optimizer dashboard at https://dids.amdy.io for call records

---

## ✅ Verification Checklist

- [ ] VICIdial API user created with level 8+
- [ ] Allowed Campaigns set to `-ALL`
- [ ] VICIdial connection test successful
- [ ] Campaigns synced successfully
- [ ] dids.conf downloaded and uploaded to `/etc/asterisk/dids.conf`
- [ ] dids.conf permissions set to 600
- [ ] AGI script installed at `/var/lib/asterisk/agi-bin/vicidial-did-optimizer.agi`
- [ ] AGI script executable (755 permissions)
- [ ] Perl dependencies installed
- [ ] Dialplan generated and updated in VICIdial Carriers
- [ ] Test call completed successfully
- [ ] Logs showing DID selection activity
- [ ] Dashboard showing call records

---

## 🔧 How It Works

### Call Flow:
1. **Customer call initiated** through VICIdial
2. **Asterisk executes dialplan** which calls the AGI script
3. **AGI script reads configuration** from `/etc/asterisk/dids.conf`
4. **API request made** to DID Optimizer with customer phone, campaign, agent
5. **Optimal DID selected** based on geographic proximity and rotation rules
6. **Caller ID set** to the selected DID via `${OPTIMIZER_DID}` variable
7. **Call proceeds** with optimized DID
8. **Call tracked** in DID Optimizer dashboard

### Data Used for DID Selection:
- **Customer Phone Number**: For area code and geographic detection
- **Campaign ID**: For campaign-specific rotation rules
- **Agent ID**: For agent-specific tracking
- **Customer Location**: State and ZIP code (if available from VICIdial database)

---

## 🚨 Troubleshooting

### Connection Test Fails

**Error**: "Hostname not found" or "Connection refused"
- **Solution**: Verify VICIdial hostname is correct and accessible from DID Optimizer servers
- **Check**: Try accessing `https://YOUR-HOSTNAME/vicidial/non_agent_api.php` in a browser

**Error**: "Authentication failed"
- **Solution**: Verify username and password are correct
- **Check**: Test logging into VICIdial admin panel with same credentials

**Error**: "Permission denied"
- **Solution**: Ensure API user has "view reports" enabled and all API permissions
- **Check**: User level should be 8 or higher

### Campaign Sync Fails

**Error**: "THIS USER HAS NO VIEWABLE CAMPAIGNS"
- **Solution**: Set Allowed Campaigns to exactly `-ALL` in user group settings
- **Check**: Run this SQL query to verify:
  ```sql
  SELECT user_group, allowed_campaigns
  FROM vicidial_user_groups
  WHERE user_group = 'YOUR_GROUP_NAME';
  ```
- **Expected**: Field should contain `-ALL` pattern

### AGI Script Not Working

**Check logs**:
```bash
tail -f /var/log/astguiclient/did-optimizer.log
```

**Common issues**:
- Missing Perl modules: Run `sudo ./install-agi.sh` again
- Config file not found: Verify `/etc/asterisk/dids.conf` exists and has correct permissions
- API key invalid: Re-download dids.conf from web interface
- Network connectivity: Test API connection with:
  ```bash
  curl -H "x-api-key: YOUR_API_KEY" https://dids.amdy.io/api/v1/health
  ```

### Dialplan Not Working

**Verify dialplan in VICIdial**:
1. Log into VICIdial Admin
2. Go to **Admin → Carriers**
3. Check that your carrier's dialplan entry includes the AGI script calls
4. Look for `AGI(vicidial-did-optimizer.agi)` in the dialplan

**Check AGI execution in logs**:
```bash
tail -f /var/log/astguiclient/did-optimizer.log
```

**Verify dial pattern**:
- Ensure your carrier dialplan pattern matches your outbound calls
- Common patterns: `_91NXXNXXXXXX` (11 digits), `_9NXXNXXXXXX` (10 digits)
- Test by making a call and checking the logs

### No Call Records in Dashboard

1. **Check logs**: Verify AGI script is running and selecting DIDs
2. **Check API connectivity**: Ensure VICIdial server can reach https://dids.amdy.io
3. **Check firewall**: Make sure outbound HTTPS (port 443) is allowed
4. **Verify API key**: Re-download dids.conf if API key might be incorrect

---

## 📁 Configuration File Reference

**Location:** `/etc/asterisk/dids.conf`

**Key Settings:**
```ini
[general]
# API Configuration
api_base_url=https://dids.amdy.io
api_key=YOUR_API_KEY_HERE
api_timeout=10
max_retries=3

# Fallback DID when API is unavailable
fallback_did=+18005551234

# Logging Configuration
log_file=/var/log/astguiclient/did-optimizer.log
debug=1

# Database Configuration for Customer Data (VICIdial)
db_host=localhost
db_user=cron
db_pass=1234
db_name=asterisk

# Performance Settings
daily_usage_limit=200
max_distance_miles=500

# Geographic Settings
enable_geographic_routing=1
enable_state_fallback=1
enable_area_code_detection=1
```

---

## 🎯 Advanced Configuration

### Custom API Timeout

Edit `/etc/asterisk/dids.conf`:

```ini
[general]
api_timeout=10          # Increase if API is slow
max_retries=3           # Number of retry attempts
```

### Enable Debug Logging

Edit `/etc/asterisk/dids.conf`:

```ini
[general]
debug=1                 # Set to 1 for verbose logging
```

### Geographic Routing

Edit `/etc/asterisk/dids.conf`:

```ini
[general]
enable_geographic_routing=1
enable_state_fallback=1
max_distance_miles=500
```

### Daily Usage Limits

Edit `/etc/asterisk/dids.conf`:

```ini
[general]
daily_usage_limit=200   # Calls per DID per day
```

---

## 🎊 What's Next?

After successful installation:

1. **Configure DIDs**: Add your phone numbers in the DID Management page
2. **Set up Rotation Rules**: Configure rotation strategies per campaign
3. **Monitor Analytics**: View real-time performance in the Dashboard
4. **Enable AI Training**: Allow the system to learn from call outcomes
5. **Set up Alerts**: Configure notifications for DID pool depletion

---

## 📞 Support

- **Documentation**: https://docs.dids.amdy.io
- **Web Interface**: https://dids.amdy.io
- **GitHub**: https://github.com/nikvb/vicidial-did-optimizer
- **Support Email**: support@amdy.io

---

**Total Installation Time**: ~10-15 minutes

Your VICIdial system now provides intelligent, data-driven DID optimization with comprehensive call tracking!
