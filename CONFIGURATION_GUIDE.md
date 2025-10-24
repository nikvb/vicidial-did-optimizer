# VICIdial DID Optimizer - Configuration Guide

## Overview

The DID Optimizer uses a **two-file configuration system** that aligns with VICIdial standards:

1. **`/etc/astguiclient.conf`** - VICIdial database configuration (standard VICIdial file)
2. **`/etc/asterisk/dids.conf`** - DID Optimizer API configuration

This design ensures the sync script uses the same database credentials as VICIdial itself, eliminating configuration drift and simplifying maintenance.

## Configuration Files

### 1. `/etc/astguiclient.conf` - Database Configuration

This is the **standard VICIdial configuration file** that already exists on all VICIdial installations.

**Purpose**: Provides database connection credentials for VICIdial database

**Format**: Perl hash syntax
```perl
# VICIdial Database Configuration
$VARDB_server => 'localhost';
$VARDB_database => 'asterisk';
$VARDB_user => 'cron';
$VARDB_pass => '1234';
$VARDB_port => '3306';
```

**Scripts that read this**:
- ✅ `process-call-results.pl` (DID Optimizer sync script)
- ✅ All VICIdial core scripts
- ✅ VICIdial cron jobs

**Important**:
- This file is managed by VICIdial
- **No changes needed** - sync script reads existing file
- Permissions: `644` or `600`, owned by `root` or `asterisk`

### 2. `/etc/asterisk/dids.conf` - DID Optimizer API Configuration

This file contains DID Optimizer-specific settings.

**Purpose**: API endpoint and authentication for DID Optimizer

**Format**: INI-style configuration
```ini
[general]
# DID Optimizer API Configuration
api_base_url=http://localhost:5000
api_key=did_2b359460617736dadfc0c87e328148828201597f70f07a4edeb94ffed21ed549
api_timeout=10
max_retries=3

# Fallback DID when API is unavailable
fallback_did=+18005551234

# Logging
log_file=/var/log/astguiclient/did_optimizer.log
debug=1

# Optional: Database override (usually not needed - reads from astguiclient.conf)
# db_host=localhost
# db_user=cron
# db_pass=1234
# db_name=asterisk

# Cache Settings
cache_enabled=1
cache_ttl=300
```

**Scripts that read this**:
- ✅ `vicidial-did-optimizer-production.agi` (AGI script for DID selection)
- ✅ `process-call-results.pl` (Call results sync script)

**Permissions**:
```bash
sudo chown asterisk:asterisk /etc/asterisk/dids.conf
sudo chmod 600 /etc/asterisk/dids.conf
```

## Configuration Priority

The sync script (`process-call-results.pl`) loads configuration in this order:

### Priority 1: Defaults
```perl
db_host => 'localhost'
db_user => 'cron'
db_pass => '1234'
db_name => 'asterisk'
db_port => '3306'
api_base_url => 'http://localhost:5000'
```

### Priority 2: `/etc/astguiclient.conf` (VICIdial standard)
Overrides database configuration:
- `$VARDB_server` → `db_host`
- `$VARDB_database` → `db_name`
- `$VARDB_user` → `db_user`
- `$VARDB_pass` → `db_pass`
- `$VARDB_port` → `db_port`

### Priority 3: `/etc/asterisk/dids.conf` (DID Optimizer)
Overrides API and optional database configuration:
- `api_base_url` → API URL
- `api_key` → API authentication
- `db_host`, `db_user`, `db_pass`, `db_name` → Optional database override

### Priority 4: Environment Variables (highest)
```bash
API_KEY=xxx                      # API key override
DID_OPTIMIZER_API_URL=xxx        # API URL override
VICIDIAL_DB_HOST=xxx             # Database host override
VICIDIAL_DB_USER=xxx             # Database user override
VICIDIAL_DB_PASSWORD=xxx         # Database password override
VICIDIAL_DB_NAME=xxx             # Database name override
```

## Setup Instructions

### New Installation

**Step 1: Verify VICIdial Database Config**
```bash
# Check if astguiclient.conf exists
ls -l /etc/astguiclient.conf

# View database configuration (if file exists)
grep VARDB /etc/astguiclient.conf
```

If the file doesn't exist, you're not on a standard VICIdial server. See "Non-Standard Installation" below.

**Step 2: Create DID Optimizer Config**
```bash
# Create config file
sudo vi /etc/asterisk/dids.conf
```

Add this content:
```ini
[general]
api_base_url=http://localhost:5000
api_key=YOUR_API_KEY_HERE
fallback_did=+18005551234
log_file=/var/log/astguiclient/did_optimizer.log
debug=1
```

**Step 3: Set Permissions**
```bash
sudo chown asterisk:asterisk /etc/asterisk/dids.conf
sudo chmod 600 /etc/asterisk/dids.conf
```

**Step 4: Test Configuration**
```bash
cd /home/na/didapi
./test-perl-sync.sh
```

Expected output:
```
✅ VICIdial database config loaded from /etc/astguiclient.conf
✅ DID Optimizer config loaded from /etc/asterisk/dids.conf
📋 Final configuration:
   API URL: http://localhost:5000
   DB Host: localhost:3306
   DB Name: asterisk
   DB User: cron
✅ Connected to VICIdial database
```

### Non-Standard Installation

If you don't have `/etc/astguiclient.conf`, you have two options:

**Option A: Environment Variables** (Testing/Development)
```bash
export VICIDIAL_DB_HOST=localhost
export VICIDIAL_DB_USER=cron
export VICIDIAL_DB_PASSWORD=1234
export VICIDIAL_DB_NAME=asterisk
export API_KEY=your_api_key_here

perl process-call-results.pl
```

**Option B: Add Database Config to dids.conf** (Production)
```ini
[general]
# API Configuration
api_base_url=http://localhost:5000
api_key=your_api_key_here
fallback_did=+18005551234

# Database Configuration (since astguiclient.conf doesn't exist)
db_host=localhost
db_user=cron
db_pass=1234
db_name=asterisk
db_port=3306
```

## Configuration Examples

### Example 1: Standard VICIdial Server

**`/etc/astguiclient.conf`** (already exists):
```perl
$VARDB_server => 'localhost';
$VARDB_database => 'asterisk';
$VARDB_user => 'cron';
$VARDB_pass => '1234';
$VARDB_port => '3306';
```

**`/etc/asterisk/dids.conf`** (you create):
```ini
[general]
api_base_url=http://localhost:5000
api_key=did_315b95e7b2107598f4c5c6f51d21b3ac1768892fa81c1bb3ea38756bb1c2b43e
fallback_did=+18005551234
```

**Result**: Script reads DB config from astguiclient.conf, API config from dids.conf. ✅

### Example 2: Remote Database Server

**`/etc/astguiclient.conf`** (VICIdial managed):
```perl
$VARDB_server => '10.0.1.100';
$VARDB_database => 'asterisk';
$VARDB_user => 'vicidial';
$VARDB_pass => 'secret123';
$VARDB_port => '3306';
```

**`/etc/asterisk/dids.conf`**:
```ini
[general]
api_base_url=https://api.example.com
api_key=did_xxxxx
fallback_did=+18005551234
```

**Result**: Script automatically uses remote database from astguiclient.conf. ✅

### Example 3: Remote API Server

**`/etc/astguiclient.conf`** (local DB):
```perl
$VARDB_server => 'localhost';
$VARDB_database => 'asterisk';
$VARDB_user => 'cron';
$VARDB_pass => '1234';
```

**`/etc/asterisk/dids.conf`** (remote API):
```ini
[general]
api_base_url=https://dids.amdy.io
api_key=did_xxxxx
fallback_did=+18005551234
api_timeout=30
max_retries=5
```

**Result**: Reads from local VICIdial DB, syncs to remote API. ✅

## Troubleshooting

### Problem: "Cannot connect to VICIdial database"

**Check astguiclient.conf exists**:
```bash
ls -l /etc/astguiclient.conf
```

**If missing**: Add database config to `/etc/asterisk/dids.conf`:
```ini
db_host=localhost
db_user=cron
db_pass=1234
db_name=asterisk
```

**Test database connection**:
```bash
mysql -h localhost -u cron -p1234 -e "SELECT COUNT(*) FROM asterisk.vicidial_log;"
```

### Problem: "API key not found"

**Check dids.conf**:
```bash
sudo cat /etc/asterisk/dids.conf | grep api_key
```

**If missing**: Add to `/etc/asterisk/dids.conf`:
```ini
api_key=your_api_key_here
```

**Or use environment variable**:
```bash
export API_KEY=your_api_key_here
perl process-call-results.pl
```

### Problem: "Permission denied reading config file"

**Fix permissions**:
```bash
sudo chmod 644 /etc/astguiclient.conf
sudo chmod 600 /etc/asterisk/dids.conf
sudo chown asterisk:asterisk /etc/asterisk/dids.conf
```

### Problem: Script reads wrong database

**Check configuration priority**:
```bash
perl process-call-results.pl 2>&1 | head -20
```

Look for these log messages:
- `✅ VICIdial database config loaded from /etc/astguiclient.conf`
- `✅ DID Optimizer config loaded from /etc/asterisk/dids.conf`
- `📋 Final configuration:`

**Override with environment variable**:
```bash
export VICIDIAL_DB_HOST=correct_host
perl process-call-results.pl
```

## Viewing Effective Configuration

Run the sync script with verbose logging to see what configuration it loaded:

```bash
perl process-call-results.pl 2>&1 | grep -E "(✅|📋|ℹ️)"
```

Expected output:
```
[2024-10-24T12:00:00] ℹ️  VICIdial config file /etc/astguiclient.conf not found
[2024-10-24T12:00:00] ✅ DID Optimizer config loaded from /etc/asterisk/dids.conf
[2024-10-24T12:00:00] 📋 Final configuration:
[2024-10-24T12:00:00]    API URL: http://localhost:5000
[2024-10-24T12:00:00]    DB Host: localhost:3306
[2024-10-24T12:00:00]    DB Name: asterisk
[2024-10-24T12:00:00]    DB User: cron
```

## Best Practices

1. **Keep database config in astguiclient.conf** (VICIdial standard)
2. **Keep API config in dids.conf** (DID Optimizer specific)
3. **Use environment variables for testing only**
4. **Set secure permissions on dids.conf** (`chmod 600`)
5. **Never commit dids.conf to git** (contains API keys)
6. **Use same database credentials as VICIdial** (no config drift)

## Security Recommendations

### File Permissions
```bash
# astguiclient.conf - readable by all VICIdial processes
sudo chmod 644 /etc/astguiclient.conf
sudo chown root:root /etc/astguiclient.conf

# dids.conf - readable only by asterisk user (contains API key)
sudo chmod 600 /etc/asterisk/dids.conf
sudo chown asterisk:asterisk /etc/asterisk/dids.conf
```

### API Key Security
- ✅ Store in `/etc/asterisk/dids.conf` with mode `600`
- ✅ Use different API keys for each VICIdial server
- ✅ Rotate API keys periodically
- ❌ Never commit API keys to git
- ❌ Never log full API key in debug output
- ❌ Never store in world-readable files

### Network Security
- Use HTTPS for remote API endpoints (`api_base_url=https://...`)
- Use VPN or SSH tunnel for remote database connections
- Restrict database access by IP address
- Use firewall rules to limit API access

## Summary

**For standard VICIdial installations**:
- ✅ Database: Read from `/etc/astguiclient.conf` (no configuration needed)
- ✅ API: Configure in `/etc/asterisk/dids.conf`
- ✅ Result: Single source of truth for database credentials

**For non-standard installations**:
- Add database config to `/etc/asterisk/dids.conf`
- Or use environment variables

**Testing configuration**:
```bash
cd /home/na/didapi
./test-perl-sync.sh
```

This ensures your sync script always uses the same database credentials as VICIdial! 🎯
