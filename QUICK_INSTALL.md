# VICIdial DID Optimizer - Quick Installation Guide

This guide will help you integrate DID Optimizer Pro with your VICIdial system in under 10 minutes.

## Prerequisites

- VICIdial server with root/sudo access
- DID Optimizer Pro account (sign up at https://dids.amdy.io)
- Basic familiarity with Linux command line
- Asterisk dialplan configuration access

## Installation Steps

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
   - **Hostname**: Your VICIdial server hostname or IP (e.g., `vicidial.yourcompany.com` or `https://vicidial.yourcompany.com`)
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
sudo chown asterisk:asterisk /etc/asterisk/dids.conf
sudo chmod 600 /etc/asterisk/dids.conf
```

### Step 5: Install AGI Script (3 minutes)

Download and run the installation script on your VICIdial server:

```bash
# Download installation script
cd /tmp
wget https://raw.githubusercontent.com/YOUR_ORG/didapi/main/vicidial-integration/install-agi.sh

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

### Step 6: Configure Dialplan Integration (2 minutes)

Instead of manually editing dialplan files, use the DID Optimizer web interface to generate the modified dialplan:

1. Go to **Settings → VICIdial Integration** at https://dids.amdy.io
2. In the **Dialplan Generator** section:
   - Paste your existing carrier dialplan entry (from VICIdial Admin → Carriers)
   - Click **Generate Modified Dialplan**
   - Copy the generated dialplan with DID Optimizer integration
3. In VICIdial Admin:
   - Go to **Admin → Carriers**
   - Select your carrier
   - Paste the generated dialplan into the **Dialplan Entry** field
   - Click **Submit**

**Example:** If your current carrier dialplan is:
```asterisk
exten => _91NXXNXXXXXX,1,AGI(agi://127.0.0.1:4577/call_log)
exten => _91NXXNXXXXXX,n,Dial(SIP/mycarrier/${EXTEN:1},60,tTo)
exten => _91NXXNXXXXXX,n,Hangup
```

The generator will produce:
```asterisk
exten => _91NXXNXXXXXX,1,NoOp(DID Optimizer: ${EXTEN})
exten => _91NXXNXXXXXX,n,Set(CUSTOMER_PHONE=${EXTEN:1})
exten => _91NXXNXXXXXX,n,AGI(vicidial-did-optimizer.agi)
exten => _91NXXNXXXXXX,n,Set(CALLERID(num)=${OPTIMIZER_DID})
exten => _91NXXNXXXXXX,n,AGI(agi://127.0.0.1:4577/call_log)
exten => _91NXXNXXXXXX,n,Dial(SIP/mycarrier/${EXTEN:1},60,tTo)
exten => _91NXXNXXXXXX,n,Hangup
```

> **Note**: The generator automatically inserts the DID Optimizer AGI script before your existing call logging and dial commands, preserving all your VICIdial functionality.

### Step 7: Apply Changes (1 minute)

After updating the carrier dialplan in VICIdial Admin, VICIdial will automatically reload the configuration. No manual Asterisk reload is needed.

### Step 8: Test the Integration (2 minutes)

1. Make a test call through VICIdial
2. Monitor the logs:
   ```bash
   tail -f /var/log/astguiclient/did-optimizer.log
   ```
3. You should see DID selection activity in the logs
4. Check the DID Optimizer dashboard at https://dids.amdy.io for call records

## Verification Checklist

- [ ] VICIdial API user created with level 8+
- [ ] Allowed Campaigns set to `-ALL`
- [ ] VICIdial connection test successful
- [ ] Campaigns synced successfully
- [ ] dids.conf downloaded and uploaded to `/etc/asterisk/dids.conf`
- [ ] dids.conf permissions set to 600
- [ ] AGI script installed at `/var/lib/asterisk/agi-bin/vicidial-did-optimizer.agi`
- [ ] AGI script executable (755 permissions)
- [ ] Perl dependencies installed
- [ ] Dialplan configured and reloaded
- [ ] Test call completed successfully
- [ ] Logs showing DID selection activity
- [ ] Dashboard showing call records

## Troubleshooting

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

## Advanced Configuration

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

## Support

- **Documentation**: https://docs.dids.amdy.io
- **Web Interface**: https://dids.amdy.io
- **GitHub**: https://github.com/YOUR_ORG/didapi
- **Support Email**: support@amdy.io

## What's Next?

After successful installation:

1. **Configure DIDs**: Add your phone numbers in the DID Management page
2. **Set up Rotation Rules**: Configure rotation strategies per campaign
3. **Monitor Analytics**: View real-time performance in the Dashboard
4. **Enable AI Training**: Allow the system to learn from call outcomes
5. **Set up Alerts**: Configure notifications for DID pool depletion

---

**Total Installation Time**: ~10-15 minutes

**Need Help?** Contact support@amdy.io or check https://docs.dids.amdy.io
