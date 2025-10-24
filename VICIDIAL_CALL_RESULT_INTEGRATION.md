# VICIdial Call Result Integration

## Overview
This document explains how to integrate call disposition/result reporting from VICIdial to the DID Optimizer API.

## VICIdial Call Flow Architecture

### 1. FastAGI Call_Log Process
VICIdial uses `AGI(agi://127.0.0.1:4577/call_log)` which connects to a FastAGI server that:
- Logs call details to VICIdial database
- Records dispositions (SALE, DNC, callback, etc.)
- Tracks call duration, agent info, campaign details

### 2. Integration Points

There are 3 main ways to capture call results:

#### Option A: Database Trigger (Recommended)
Monitor VICIdial's `vicidial_log` table and send updates to DID Optimizer API.

**Advantages:**
- Non-intrusive to VICIdial
- Captures all call data reliably
- No changes to dialplan needed

**Implementation:**
```sql
-- Create trigger on vicidial_log table
DELIMITER $$
CREATE TRIGGER after_call_disposition
AFTER UPDATE ON vicidial_log
FOR EACH ROW
BEGIN
    IF NEW.status != OLD.status AND NEW.status != '' THEN
        -- Call our API endpoint via MySQL UDF or external script
        -- Log: uniqueid, phone_number, status, length_in_sec, campaign_id
        INSERT INTO did_optimizer_queue (
            uniqueid,
            phone_number,
            status,
            duration,
            campaign_id,
            agent,
            created_at
        ) VALUES (
            NEW.uniqueid,
            NEW.phone_number,
            NEW.status,
            NEW.length_in_sec,
            NEW.campaign_id,
            NEW.user,
            NOW()
        );
    END IF;
END$$
DELIMITER ;
```

Then create a cron job to process the queue:
```bash
*/1 * * * * /home/na/didapi/process-call-results.js
```

#### Option B: Custom AGI Script
Create a custom AGI script that runs after call_log.

**Dialplan modification:**
```
exten => 8370,1,AGI(agi://127.0.0.1:4577/call_log)
exten => 8370,n,AGI(/var/lib/asterisk/agi-bin/did-optimizer-report.pl)
exten => 8370,n,Hangup()
```

**AGI Script** (`/var/lib/asterisk/agi-bin/did-optimizer-report.pl`):
```perl
#!/usr/bin/perl
use strict;
use Asterisk::AGI;
use LWP::UserAgent;
use JSON;

my $AGI = new Asterisk::AGI;
my %input = $AGI->ReadParse();

# Get channel variables
my $uniqueid = $AGI->get_variable('UNIQUEID');
my $phone = $AGI->get_variable('CALLERID(num)');
my $disposition = $AGI->get_variable('HANGUPCAUSE');
my $duration = $AGI->get_variable('ANSWEREDTIME');
my $campaign = $AGI->get_variable('campaign_id');
my $agent = $AGI->get_variable('agent');
my $did_used = $AGI->get_variable('DID_NUMBER'); # Our DID

# Send to DID Optimizer API
my $ua = LWP::UserAgent->new;
my $response = $ua->post(
    'http://localhost:5000/api/v1/call-results',
    Content_Type => 'application/json',
    Content => encode_json({
        uniqueid => $uniqueid,
        phoneNumber => $phone,
        didUsed => $did_used,
        disposition => $disposition,
        duration => $duration,
        campaignId => $campaign,
        agentId => $agent,
        timestamp => time()
    })
);

$AGI->verbose("DID Optimizer API response: " . $response->status_line, 1);
```

#### Option C: Asterisk Manager Interface (AMI) Events
Listen to AMI events for call completions.

**Node.js AMI Listener:**
```javascript
const ami = require('asterisk-manager');
const axios = require('axios');

const manager = ami(
  '127.0.0.1',
  5038,
  'admin',
  'password'
);

manager.on('hangup', async (evt) => {
  if (evt.channel.includes('VICIDIAL')) {
    const callData = {
      uniqueid: evt.uniqueid,
      phoneNumber: evt.calleridnum,
      duration: evt.duration,
      disposition: evt.cause,
      timestamp: new Date()
    };

    try {
      await axios.post('http://localhost:5000/api/v1/call-results', callData, {
        headers: { 'x-api-key': process.env.API_KEY }
      });
    } catch (error) {
      console.error('Failed to report call result:', error.message);
    }
  }
});

manager.connect();
```

## API Endpoint Implementation

Add this to `server-full.js`:

```javascript
// Call result reporting endpoint
app.post('/api/v1/call-results', authenticateAPIKey, async (req, res) => {
  try {
    const {
      uniqueid,
      phoneNumber,
      didUsed,
      disposition,
      duration,
      campaignId,
      agentId,
      timestamp
    } = req.body;

    // Find the DID that was used
    const did = await DID.findOne({
      phoneNumber: didUsed,
      tenantId: req.tenant._id
    });

    if (!did) {
      return res.status(404).json({
        success: false,
        error: 'DID not found'
      });
    }

    // Create call record
    const callRecord = new CallRecord({
      tenantId: req.tenant._id,
      didId: did._id,
      phoneNumber: phoneNumber,
      campaignId: campaignId,
      agentId: agentId,
      disposition: disposition,
      duration: parseInt(duration) || 0,
      uniqueId: uniqueid,
      timestamp: timestamp ? new Date(timestamp * 1000) : new Date()
    });

    await callRecord.save();

    // Update DID statistics
    did.stats.totalCalls = (did.stats.totalCalls || 0) + 1;
    did.stats.lastCallDate = new Date();

    // Track disposition
    if (disposition === 'SALE' || disposition === 'A') {
      did.stats.successfulCalls = (did.stats.successfulCalls || 0) + 1;
    }

    // Calculate success rate
    if (did.stats.totalCalls > 0) {
      did.stats.successRate = (did.stats.successfulCalls / did.stats.totalCalls) * 100;
    }

    await did.save();

    // Log to audit
    await AuditLog.create({
      tenantId: req.tenant._id,
      action: 'CALL_RESULT_REPORTED',
      details: {
        did: didUsed,
        phone: phoneNumber,
        disposition: disposition,
        duration: duration,
        campaign: campaignId
      }
    });

    res.json({
      success: true,
      message: 'Call result recorded',
      data: {
        recordId: callRecord._id,
        didId: did._id
      }
    });

  } catch (error) {
    console.error('Error recording call result:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to record call result'
    });
  }
});
```

## Recommended Implementation Steps

1. **Start with Option A (Database Trigger)**
   - Least intrusive
   - Most reliable
   - Create queue table in VICIdial database
   - Create processing script

2. **Create Processing Script** (`/home/na/didapi/process-call-results.js`):
```javascript
#!/usr/bin/env node

const mysql = require('mysql2/promise');
const axios = require('axios');

async function processCallResults() {
  const vicidialDb = await mysql.createConnection({
    host: 'localhost',
    user: 'vicidial',
    password: 'password',
    database: 'asterisk'
  });

  // Get pending results
  const [results] = await vicidialDb.execute(`
    SELECT * FROM did_optimizer_queue
    WHERE processed = 0
    ORDER BY created_at ASC
    LIMIT 100
  `);

  for (const result of results) {
    try {
      await axios.post('http://localhost:5000/api/v1/call-results', {
        uniqueid: result.uniqueid,
        phoneNumber: result.phone_number,
        didUsed: result.did_number,
        disposition: result.status,
        duration: result.duration,
        campaignId: result.campaign_id,
        agentId: result.agent,
        timestamp: Math.floor(new Date(result.created_at).getTime() / 1000)
      }, {
        headers: { 'x-api-key': process.env.API_KEY }
      });

      // Mark as processed
      await vicidialDb.execute(
        'UPDATE did_optimizer_queue SET processed = 1, processed_at = NOW() WHERE id = ?',
        [result.id]
      );

      console.log(`✓ Processed call result: ${result.uniqueid}`);
    } catch (error) {
      console.error(`✗ Failed to process ${result.uniqueid}:`, error.message);

      // Mark as failed
      await vicidialDb.execute(
        'UPDATE did_optimizer_queue SET failed = 1, error = ? WHERE id = ?',
        [error.message, result.id]
      );
    }
  }

  await vicidialDb.end();
}

processCallResults().catch(console.error);
```

3. **Add API Key Authentication** (Already exists in server-full.js)

4. **Test Integration**
   - Make test call through VICIdial
   - Verify call result appears in DID Optimizer
   - Check DID statistics are updated

## Data Flow Diagram

```
VICIdial Call → FastAGI (call_log) → vicidial_log table
                                           ↓
                                      MySQL Trigger
                                           ↓
                                  did_optimizer_queue
                                           ↓
                                   Cron Job (every minute)
                                           ↓
                              DID Optimizer API (/api/v1/call-results)
                                           ↓
                              Update CallRecord + DID Stats
```

## Monitoring & Debugging

1. **Check queue status:**
```sql
SELECT COUNT(*) as pending FROM did_optimizer_queue WHERE processed = 0;
SELECT COUNT(*) as failed FROM did_optimizer_queue WHERE failed = 1;
```

2. **View recent call results:**
```bash
curl -H "x-api-key: YOUR_API_KEY" http://localhost:5000/api/v1/call-records?limit=10
```

3. **Check DID stats:**
```bash
curl -H "x-api-key: YOUR_API_KEY" http://localhost:5000/api/v1/dids/PHONE_NUMBER/stats
```

## Security Considerations

- API key authentication required
- Rate limiting on API endpoint
- Queue cleanup (delete processed records older than 7 days)
- Error handling and retry logic
- Validate all input data

## Next Steps

1. Create queue table in VICIdial database
2. Implement database trigger
3. Create processing script
4. Add API endpoint to server-full.js
5. Set up cron job
6. Test with real calls
7. Monitor and optimize
