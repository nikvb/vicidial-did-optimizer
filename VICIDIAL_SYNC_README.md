# VICIdial Call Results Sync - Setup Guide

## Overview

This integration automatically syncs call results from VICIdial's `vicidial_log` table to the DID Optimizer API every minute.

## Components

1. **process-call-results.pl** - Perl script that polls VICIdial database (recommended for VICIdial servers)
   - Alternative: **process-call-results.js** - Node.js version (requires Node.js installation)
2. **API Endpoint** - `/api/v1/call-results` in server-full.js
3. **Cron Job** - Runs every minute to process new calls
4. **Checkpoint File** - `/tmp/did-optimizer-last-check.txt` tracks sync progress

## Setup Instructions

### 1. VICIdial Database Configuration

The sync script automatically reads VICIdial database credentials from `/etc/astguiclient.conf` (standard VICIdial configuration file).

**No additional database configuration needed!** The script uses the same database credentials as VICIdial itself.

If `/etc/astguiclient.conf` doesn't exist on your system, the script will fall back to:
- Environment variables (VICIDIAL_DB_HOST, VICIDIAL_DB_USER, etc.)
- Default values (localhost, cron, 1234, asterisk)

### 2. DID Optimizer API Configuration

Add API configuration to `/etc/asterisk/dids.conf` (same file used by AGI script):

```ini
[general]
# DID Optimizer API
api_base_url=http://localhost:5000
api_key=your_api_key_here

# These are optional - script reads from /etc/astguiclient.conf instead
# db_host=localhost
# db_user=cron
# db_pass=1234
# db_name=asterisk
```

**Configuration Priority:**
1. `/etc/astguiclient.conf` - VICIdial database configuration (VARDB_* variables)
2. `/etc/asterisk/dids.conf` - DID Optimizer API configuration (api_base_url, api_key)
3. Environment variables - Override for testing
4. Defaults - Fallback values

### 2. Grant Database Access

The sync script needs READ access to VICIdial's `vicidial_log` table:

```sql
-- Connect to MariaDB as root
mysql -u root -p

-- Grant access to the cron user
GRANT SELECT ON asterisk.vicidial_log TO 'cron'@'localhost' IDENTIFIED BY '1234';
FLUSH PRIVILEGES;

-- Verify access
mysql -u cron -p1234 -e "SELECT COUNT(*) FROM asterisk.vicidial_log;"
```

### 3. Install Required Perl Modules

The Perl script requires these modules (usually pre-installed on VICIdial servers):

```bash
# Check if modules are installed
./test-perl-sync.sh

# If modules are missing, install via apt (Debian/Ubuntu)
sudo apt-get install libdbi-perl libdbd-mysql-perl libjson-perl libwww-perl

# Or via CPAN
sudo cpan DBI DBD::mysql LWP::UserAgent JSON
```

### 4. Test the Sync Script

Run manually first to verify it works:

```bash
cd /home/na/didapi

# Run test script to verify dependencies
./test-perl-sync.sh

# If all checks pass, run the sync script
perl process-call-results.pl
```

Expected output:
```
🚀 Starting call results sync...
✅ Connected to VICIdial database
📅 Last check: 2024-10-24 12:00:00
📞 Found 15 new call results
✓ 1634567890.123: CAMPAIGN001/5551234567 → SALE (45s)
✓ 1634567891.124: CAMPAIGN001/5559876543 → NA (0s)
...
📊 Summary: 15 processed, 0 failed in 1.23s
💾 Saved checkpoint: 2024-10-24 12:15:00
✅ Sync completed successfully
```

### 5. Install Cron Job

Run the setup script:

```bash
cd /home/na/didapi
./setup-vicidial-sync-cron.sh
```

This will:
- Create log file at `/var/log/did-optimizer-sync.log`
- Add cron job to run every minute
- Display current cron configuration

### 6. Monitor the Sync

**View live sync activity:**
```bash
tail -f /var/log/did-optimizer-sync.log
```

**Check recent summaries:**
```bash
grep "Summary:" /var/log/did-optimizer-sync.log | tail -10
```

**View checkpoint status:**
```bash
cat /tmp/did-optimizer-last-check.txt
```

## How It Works

### Data Flow

```
┌─────────────────┐
│  VICIdial Call  │
│   Completes     │
└────────┬────────┘
         │
         v
┌─────────────────┐
│ vicidial_log    │
│  (MyISAM)       │
└────────┬────────┘
         │
         │ (Every minute)
         v
┌─────────────────┐
│ Cron Job runs   │
│ process-call-   │
│ results.js      │
└────────┬────────┘
         │
         │ SELECT new records
         │ WHERE end_epoch > last_check
         v
┌─────────────────┐
│ POST /api/v1/   │
│ call-results    │
└────────┬────────┘
         │
         v
┌─────────────────┐
│ MongoDB         │
│ CallRecord      │
│ + AuditLog      │
└─────────────────┘
```

### Polling Logic

1. **Read Checkpoint** - Get last processed timestamp from `/tmp/did-optimizer-last-check.txt`
2. **Query VICIdial** - SELECT calls WHERE `end_epoch` > checkpoint LIMIT 500
3. **Process Batch** - Send each call to API endpoint
4. **Update Checkpoint** - Save latest `end_epoch` as new checkpoint
5. **Repeat** - Next cron run starts from new checkpoint

### Duplicate Prevention

The API endpoint checks for existing records using `uniqueid` to prevent duplicates:

```javascript
const existingRecord = await CallRecord.findOne({
  tenantId: req.tenant._id,
  'metadata.uniqueid': uniqueid
});
```

## Synced Data Fields

From `vicidial_log` table:

| VICIdial Field | API Field | Description |
|---------------|-----------|-------------|
| uniqueid | uniqueid | Asterisk unique call ID |
| lead_id | leadId | Lead identifier |
| list_id | listId | List identifier |
| campaign_id | campaignId | Campaign identifier |
| phone_number | phoneNumber | Called phone number |
| phone_code | phoneCode | Phone code/prefix |
| status | disposition | Call disposition (SALE, NA, etc.) |
| length_in_sec | duration | Call duration in seconds |
| user | agentId | Agent user ID |
| user_group | userGroup | Agent group |
| term_reason | termReason | Termination reason |
| comments | comments | Call comments |
| alt_dial | altDial | Alternate dial |
| called_count | calledCount | Number of times called |
| call_date | callDate | Call date/time |
| start_epoch | startEpoch | Call start timestamp |
| end_epoch | endEpoch | Call end timestamp |

## Disposition Mapping

VICIdial dispositions are mapped to DID Optimizer call results:

| VICIdial Status | DID Optimizer Result |
|----------------|---------------------|
| SALE, A | answered |
| DNC, B | dnc |
| NA, NO | no_answer |
| BUSY | busy |
| DROP, AMD | dropped |
| Other | completed |

## Troubleshooting

### No calls being synced

1. **Check VICIdial database connection:**
```bash
mysql -u cron -p1234 -e "SELECT COUNT(*) FROM asterisk.vicidial_log WHERE end_epoch > UNIX_TIMESTAMP(DATE_SUB(NOW(), INTERVAL 1 HOUR));"
```

2. **Check API key:**
```bash
curl -X POST http://localhost:5000/api/v1/health \
  -H "x-api-key: YOUR_API_KEY"
```

3. **Check log for errors:**
```bash
tail -100 /var/log/did-optimizer-sync.log | grep "❌"
```

### Checkpoint stuck/behind

Reset the checkpoint to sync recent calls:

```bash
# Reset to 1 hour ago
date -d "1 hour ago" "+%Y-%m-%d %H:%M:%S" > /tmp/did-optimizer-last-check.txt

# Or reset to specific time
echo "2024-10-24 12:00:00" > /tmp/did-optimizer-last-check.txt
```

### High volume causing delays

Increase batch size in `process-call-results.pl`:

```perl
my $BATCH_SIZE = 1000; # Increase from 500
```

Or run more frequently (every 30 seconds):

```cron
*/1 * * * * sleep 30 && cd /home/na/didapi && /usr/bin/perl process-call-results.pl >> /var/log/did-optimizer-sync.log 2>&1
```

### Database connection errors

Check VICIdial database credentials:

```bash
mysql -u cron -p1234 -e "SELECT 1;"
```

Verify user has SELECT permission:

```sql
SHOW GRANTS FOR 'cron'@'localhost';
```

## Performance Considerations

- **MyISAM tables** - VICIdial uses MyISAM, which has full table locking
- **Polling frequency** - Every minute is safe for most installations
- **Batch size** - 500 records per run handles ~30,000 calls/hour
- **Checkpoint file** - Uses file system for simplicity and reliability
- **API timeout** - 10 seconds per call API request

## Maintenance

### Log Rotation

Add to `/etc/logrotate.d/did-optimizer`:

```
/var/log/did-optimizer-sync.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
}
```

### Monitoring

Set up alerts for sync failures:

```bash
# Check for failures in last hour
FAILURES=$(grep -c "failed:" /var/log/did-optimizer-sync.log | tail -60)
if [ $FAILURES -gt 10 ]; then
    echo "Alert: High sync failure rate"
fi
```

## API Endpoints

### POST /api/v1/call-results

Submit a call result from VICIdial.

**Headers:**
```
x-api-key: YOUR_API_KEY
Content-Type: application/json
```

**Request Body:**
```json
{
  "uniqueid": "1634567890.123",
  "leadId": "12345",
  "campaignId": "CAMPAIGN001",
  "phoneNumber": "5551234567",
  "disposition": "SALE",
  "duration": 45,
  "agentId": "agent001",
  "timestamp": 1634567890
}
```

**Response:**
```json
{
  "success": true,
  "message": "Call result recorded",
  "data": {
    "recordId": "507f1f77bcf86cd799439011",
    "uniqueid": "1634567890.123",
    "disposition": "SALE"
  }
}
```

## Files

- `/home/na/didapi/process-call-results.pl` - Perl sync script (recommended)
- `/home/na/didapi/process-call-results.js` - Node.js sync script (alternative)
- `/home/na/didapi/test-perl-sync.sh` - Dependency checker and test script
- `/home/na/didapi/setup-vicidial-sync-cron.sh` - Cron setup script
- `/home/na/didapi/.env` - Configuration file
- `/var/log/did-optimizer-sync.log` - Sync log file
- `/tmp/did-optimizer-last-check.txt` - Checkpoint file
- `/home/na/didapi/server-full.js` - API endpoint (line 702)

## Support

For issues or questions, check:
1. Log file: `/var/log/did-optimizer-sync.log`
2. VICIdial database connectivity
3. API key validity
4. Checkpoint file permissions
