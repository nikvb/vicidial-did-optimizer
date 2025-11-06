# VICIdial DID Optimizer - Script Overview

This document explains the different scripts in this repository and which ones to use.

## 📋 Current Production Scripts

### 1. AGI Scripts (DID Selection)

#### **vicidial-did-optimizer-production.agi** ⭐ PRODUCTION
- **Status**: Currently in use
- **Purpose**: Selects optimal DID for outbound VICIdial calls
- **Location**: `/home/na/didapi/vicidial-did-optimizer-production.agi`
- **Installation**: Copy to `/usr/share/astguiclient/`
- **Configuration**: Reads from `/etc/asterisk/dids.conf`
- **Features**:
  - Privacy mode support
  - File-based caching (5-minute TTL)
  - Geographic matching via API
  - Comprehensive logging
  - Fallback DID support
  - Performance tracking

**Usage in Asterisk dialplan:**
```
exten => _X.,1,AGI(vicidial-did-optimizer-production.agi)
exten => _X.,n,Dial(...)
```

#### vicidial-did-optimizer-config.pl
- **Status**: Development/testing version
- **Purpose**: Config-based AGI script (alternative implementation)
- **Configuration**: Reads from `/etc/asterisk/dids.conf`
- **Notes**: Not currently in production use

#### vicidial-did-optimizer.pl
- **Status**: Original version (deprecated)
- **Purpose**: First implementation of DID optimizer
- **Notes**: Replaced by production AGI script

### 2. Call Results Sync Scripts

#### **process-call-results.pl** ⭐ RECOMMENDED
- **Status**: Production-ready
- **Purpose**: Syncs completed calls from VICIdial to DID Optimizer API
- **Configuration**: Reads from `/etc/asterisk/dids.conf` (same as AGI script)
- **Features**:
  - Polls `vicidial_log` table every minute
  - Checkpoint-based synchronization
  - Batch processing (500 calls/run)
  - Duplicate prevention
  - Comprehensive logging
  - No external dependencies beyond standard Perl modules

**Why Perl?** Pre-installed on all VICIdial servers, same language as VICIdial core.

**Installation:**
```bash
cd /home/na/didapi
./test-perl-sync.sh      # Check dependencies
./setup-vicidial-sync-cron.sh  # Install cron job
```

#### process-call-results.js
- **Status**: Alternative implementation
- **Purpose**: Node.js version of call results sync
- **Configuration**: Reads from `.env` file
- **Notes**: Requires Node.js installation, not typical on VICIdial servers
- **Use case**: Standalone installations or servers with Node.js

## 📁 Configuration Files

### /etc/asterisk/dids.conf ⭐ MAIN CONFIG
This is the **single source of truth** for all production scripts.

**Required fields:**
```ini
[general]
# API Configuration
api_base_url=http://localhost:5000
api_key=did_xxxxx
fallback_did=+18005551234

# Database Configuration (for sync script)
db_host=localhost
db_user=cron
db_pass=1234
db_name=asterisk

# Logging
log_file=/var/log/astguiclient/did_optimizer.log
debug=1

# Performance
cache_enabled=1
cache_ttl=300
```

**Scripts that read this file:**
- ✅ vicidial-did-optimizer-production.agi
- ✅ vicidial-did-optimizer-config.pl
- ✅ process-call-results.pl

### .env
- **Purpose**: Alternative configuration for Node.js scripts
- **Used by**: process-call-results.js, server-full.js

## 🔄 Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    VICIdial Call Flow                        │
└─────────────────────────────────────────────────────────────┘

1. Outbound Call Initiated
   │
   ├─→ Asterisk Dialplan
   │    └─→ AGI(vicidial-did-optimizer-production.agi)
   │         └─→ Reads /etc/asterisk/dids.conf
   │         └─→ Calls API: GET /api/v1/dids/next
   │         └─→ Returns optimal DID
   │
2. Call Completed
   │
   ├─→ VICIdial writes to vicidial_log table
   │
3. Sync (every minute)
   │
   ├─→ Cron runs process-call-results.pl
   │    └─→ Reads /etc/asterisk/dids.conf
   │    └─→ Queries vicidial_log WHERE end_epoch > checkpoint
   │    └─→ Posts to API: POST /api/v1/call-results
   │    └─→ Updates checkpoint file
   │
4. Analytics
   │
   └─→ DID Optimizer tracks:
        - Call success rates per DID
        - Geographic performance
        - Agent performance
        - Campaign metrics
```

## 🚀 Quick Setup Guide

### For New VICIdial Installation

**1. Install AGI Script:**
```bash
# Copy production AGI script
sudo cp vicidial-did-optimizer-production.agi /usr/share/astguiclient/
sudo chmod +x /usr/share/astguiclient/vicidial-did-optimizer-production.agi

# Create configuration
sudo vi /etc/asterisk/dids.conf
# Add api_base_url, api_key, fallback_did, db_* settings

# Set permissions
sudo chmod 600 /etc/asterisk/dids.conf

# Test
perl /usr/share/astguiclient/vicidial-did-optimizer-production.agi --test
```

**2. Update Asterisk Dialplan:**
```
; In your outbound context
exten => _X.,1,AGI(vicidial-did-optimizer-production.agi)
exten => _X.,n,Set(CALLERID(num)=${DID_NUMBER})
exten => _X.,n,Dial(...)
```

**3. Install Call Results Sync:**
```bash
# Test dependencies
./test-perl-sync.sh

# Install missing modules (if needed)
sudo apt-get install libdbi-perl libdbd-mysql-perl libjson-perl libwww-perl

# Install cron job
./setup-vicidial-sync-cron.sh

# Monitor
tail -f /var/log/did-optimizer-sync.log
```

## 📊 Monitoring

### AGI Script Logs
```bash
# Main log
tail -f /var/log/astguiclient/did_optimizer.log

# Asterisk full log
tail -f /var/log/asterisk/full | grep "did_optimizer"
```

### Call Results Sync Logs
```bash
# Live monitoring
tail -f /var/log/did-optimizer-sync.log

# Recent summaries
grep "Summary:" /var/log/did-optimizer-sync.log | tail -10

# Check for errors
grep "❌" /var/log/did-optimizer-sync.log | tail -20
```

### Checkpoint Status
```bash
# Current checkpoint
cat /tmp/did-optimizer-last-check.txt

# Time since last update
ls -lh /tmp/did-optimizer-last-check.txt
```

## 🔧 Maintenance

### Update Configuration

**For all production scripts:**
```bash
# Edit the single config file
sudo vi /etc/asterisk/dids.conf

# Test AGI script
perl /usr/share/astguiclient/vicidial-did-optimizer-production.agi --test

# Test sync script
perl /home/na/didapi/process-call-results.pl
```

### Update Scripts from GitHub

```bash
cd /home/na/didapi
git pull origin main

# Update AGI script in production location
sudo cp vicidial-did-optimizer-production.agi /usr/share/astguiclient/
sudo chmod +x /usr/share/astguiclient/vicidial-did-optimizer-production.agi

# Sync script updates automatically (runs from /home/na/didapi)
```

### Troubleshooting

**AGI script not working:**
```bash
# Check configuration
perl vicidial-did-optimizer-production.agi --test

# Check permissions
ls -l /etc/asterisk/dids.conf
# Should be: -rw------- asterisk asterisk

# Check API connectivity
curl -H "x-api-key: YOUR_KEY" http://localhost:5000/api/v1/health
```

**Sync script not running:**
```bash
# Check cron job
crontab -l | grep process-call-results

# Check dependencies
./test-perl-sync.sh

# Test manually
perl process-call-results.pl

# Check database access
mysql -u cron -p1234 -e "SELECT COUNT(*) FROM asterisk.vicidial_log;"
```

## 📚 Documentation Files

- **VICIDIAL_SYNC_README.md** - Complete sync setup guide
- **PERL_IMPLEMENTATION.md** - Perl sync script details
- **VICIDIAL_CALL_RESULT_INTEGRATION.md** - Integration architecture
- **SERVICE_MANAGEMENT.md** - Service management guide
- **SCRIPT_OVERVIEW.md** - This file

## 🎯 Summary

**For DID Selection (AGI):**
- ✅ Use: `vicidial-did-optimizer-production.agi`
- 📍 Location: `/usr/share/astguiclient/`
- ⚙️ Config: `/etc/asterisk/dids.conf`

**For Call Results Sync:**
- ✅ Use: `process-call-results.pl`
- 📍 Location: `/home/na/didapi/`
- ⚙️ Config: `/etc/asterisk/dids.conf`
- ⏰ Runs: Every minute via cron

**Configuration:**
- ✅ Single file: `/etc/asterisk/dids.conf`
- 🔒 Permissions: `600` owned by `asterisk:asterisk`
- 📝 Fields: `api_base_url`, `api_key`, `fallback_did`, `db_*`

Everything reads from one config file for consistency and ease of management!
