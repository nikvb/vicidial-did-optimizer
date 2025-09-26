# VICIdial Integration Files

This directory contains all files needed to integrate the DID Optimizer with VICIdial.

## 📁 Files Included

### Installation Script
- **`install-vicidial-integration-autodetect.sh`** - Main installation script with auto-detection capabilities
  - Auto-detects VICIdial database settings from `/etc/astguiclient.conf`
  - Auto-detects AGI directory location
  - Installs all required files automatically
  - Configures Asterisk dialplan

### AGI Scripts
- **`agi-did-optimizer-autodetect.agi`** - Main AGI script with database auto-detection
- **`agi-did-optimizer-report.agi`** - Script for reporting call outcomes back to the API
- **`did-optimizer-quick.pl`** - Quick inline Perl script for simple DID lookups

### Configuration Files
- **`dids.conf`** - Main configuration file (installed to `/etc/asterisk/`)
- **`vicidial-dialplan-agi.conf`** - Asterisk dialplan configuration snippet

### Integration Scripts
- **`vicidial-did-optimizer-config.pl`** - Main Perl script for VICIdial integration

## 🚀 Installation

### Quick Install (Recommended)

```bash
# Run as root on your VICIdial server
sudo ./install-vicidial-integration-autodetect.sh
```

### Manual Installation

1. **Copy configuration file:**
```bash
sudo cp dids.conf /etc/asterisk/
sudo chown asterisk:asterisk /etc/asterisk/dids.conf
sudo chmod 600 /etc/asterisk/dids.conf
```

2. **Edit `/etc/asterisk/dids.conf`:**
```ini
[general]
api_base_url=http://your-did-optimizer-server:5000
api_key=YOUR_API_KEY_HERE
fallback_did=+18005551234
```

3. **Install AGI scripts:**
```bash
# Find your AGI directory (usually /var/lib/asterisk/agi-bin)
AGI_DIR=/var/lib/asterisk/agi-bin

sudo cp agi-did-optimizer-autodetect.agi $AGI_DIR/agi-did-optimizer.agi
sudo cp agi-did-optimizer-report.agi $AGI_DIR/
sudo cp did-optimizer-quick.pl $AGI_DIR/
sudo chown asterisk:asterisk $AGI_DIR/agi-did-optimizer*.agi
sudo chmod +x $AGI_DIR/agi-did-optimizer*.agi
```

4. **Install the main integration script:**
```bash
sudo cp vicidial-did-optimizer-config.pl /usr/share/astguiclient/
sudo chmod +x /usr/share/astguiclient/vicidial-did-optimizer-config.pl
```

5. **Install Perl dependencies:**
```bash
sudo apt-get install libwww-perl libjson-perl libdbi-perl libdbd-mysql-perl
```

6. **Update Asterisk dialplan:**
Add the contents of `vicidial-dialplan-agi.conf` to your `/etc/asterisk/extensions.conf`

7. **Reload Asterisk:**
```bash
asterisk -rx "reload"
```

## 🔧 Configuration

### API Settings

Edit `/etc/asterisk/dids.conf`:

```ini
[general]
# API Configuration (REQUIRED)
api_base_url=http://your-server:5000    # Your DID Optimizer API server
api_key=YOUR_SECURE_API_KEY_HERE       # API key from your DID Optimizer
api_timeout=10                          # Timeout in seconds
max_retries=3                           # Number of retries on failure

# Fallback DID (REQUIRED)
fallback_did=+18005551234               # DID to use when API is unavailable

# Logging
log_file=/var/log/astguiclient/did_optimizer.log
debug=1                                 # Set to 1 for verbose logging

# Performance Settings
daily_usage_limit=200                   # Max uses per DID per day
max_distance_miles=500                  # Max distance for geographic matching

# Features
enable_geographic_routing=1             # Enable geographic proximity matching
enable_state_fallback=1                 # Fallback to same state if no local match
enable_area_code_detection=1            # Detect and match area codes
```

### Database Settings (Auto-detected)

The installer auto-detects database settings from `/etc/astguiclient.conf`.
To override, uncomment these lines in `/etc/asterisk/dids.conf`:

```ini
# db_host=localhost
# db_user=cron
# db_pass=1234
# db_name=asterisk
# db_port=3306
```

## 🧪 Testing

### Test the Perl script directly:
```bash
/usr/share/astguiclient/vicidial-did-optimizer-config.pl --test
```

### Test with parameters:
```bash
/usr/share/astguiclient/vicidial-did-optimizer-config.pl \
  "TEST_CAMPAIGN" "1001" "4155551234" "CA" "94102"
```

### Check logs:
```bash
tail -f /var/log/astguiclient/did_optimizer.log
```

### Test AGI script:
```bash
# From Asterisk CLI
asterisk -rx "agi exec agi-did-optimizer.agi TEST_CAMPAIGN,1001,4155551234"
```

## 📊 Monitoring

### View real-time logs:
```bash
tail -f /var/log/astguiclient/did_optimizer.log
```

### Check API connectivity:
```bash
curl -H "x-api-key: YOUR_API_KEY" http://your-server:5000/api/v1/health
```

### Monitor DID usage:
The DID Optimizer dashboard provides real-time monitoring of:
- DID usage statistics
- Success rates
- Geographic distribution
- Reputation scores

## 🆘 Troubleshooting

### Common Issues

1. **"API connection failed"**
   - Verify API server is running
   - Check firewall rules
   - Verify API key is correct

2. **"No DIDs available"**
   - Check if DIDs are loaded in the database
   - Verify tenant configuration
   - Check reputation scores (DIDs with score <50 are filtered)

3. **"Permission denied" errors**
   - Ensure files are owned by `asterisk` user
   - Check file permissions (scripts need +x)

4. **Database connection issues**
   - Verify `/etc/astguiclient.conf` exists
   - Check database credentials
   - Test database connectivity

### Debug Mode

Enable debug mode in `/etc/asterisk/dids.conf`:
```ini
debug=1
```

Then check logs for detailed information:
```bash
grep "DID_OPTIMIZER" /var/log/astguiclient/did_optimizer.log
```

## 📝 Notes

- The system automatically filters out DIDs with reputation scores below 50
- DIDs are rotated using a round-robin algorithm with daily usage limits
- Geographic matching uses the Haversine formula for accurate distance calculations
- All API calls include retry logic with exponential backoff
- The fallback DID is used only when the API is completely unavailable

## 📞 Support

For issues or questions:
- GitHub Issues: https://github.com/nikvb/vicidial-did-optimizer/issues
- Documentation: https://github.com/nikvb/vicidial-did-optimizer/wiki