# VICIdial DID Optimizer - Manual Dialplan Setup Instructions

## Overview
This guide provides step-by-step instructions for manually setting up the VICIdial dialplan to integrate with the DID Optimizer API. The integration uses AGI scripts to dynamically select DIDs based on campaign requirements and rotation algorithms.

## Prerequisites
- VICIdial system installed and operational
- DID Optimizer API running on http://api3.amdy.io:5000
- Valid API key: `did_315b95e7b2107598f4c5c6f51d21b3ac1768892fa81c1bb3ea38756bb1c2b43e`
- Asterisk configuration access (SSH root access)

## Step 1: Configure API Settings

### 1.1 Create/Verify Configuration File
```bash
# Check if configuration exists
cat /etc/asterisk/dids.conf

# If not exists, create it:
sudo nano /etc/asterisk/dids.conf
```

### 1.2 Add Configuration Content
```ini
; DID Optimizer API Configuration
api_key=did_315b95e7b2107598f4c5c6f51d21b3ac1768892fa81c1bb3ea38756bb1c2b43e
api_base_url=http://api3.amdy.io:5000
api_timeout=5
api_retry_count=3
fallback_did=+18005551234
debug_mode=1
```

## Step 2: Install AGI Script

### 2.1 Create AGI Script
```bash
# Navigate to AGI directory
cd /usr/share/astguiclient

# Create the AGI script
sudo nano vicidial-did-optimizer.agi
```

### 2.2 AGI Script Content
```perl
#!/usr/bin/perl
#
# vicidial-did-optimizer.agi - DID Optimizer Integration for VICIdial
#
# This script integrates with the DID Optimizer API to select optimal DIDs
# based on campaign, agent, and customer information
#

use strict;
use warnings;
use Asterisk::AGI;
use LWP::UserAgent;
use JSON;
use URI::Escape;

# Initialize AGI
my $AGI = new Asterisk::AGI;
my %input = $AGI->ReadParse();

# Read configuration
my %config = read_config('/etc/asterisk/dids.conf');

# Get call variables
my $campaign_id = $AGI->get_variable('CAMPAIGN') || 'DEFAULT';
my $agent_id = $AGI->get_variable('AGENT') || '0';
my $customer_phone = $AGI->get_variable('CUSTOMER_PHONE') || '';
my $customer_state = $AGI->get_variable('CUSTOMER_STATE') || '';
my $customer_zip = $AGI->get_variable('CUSTOMER_ZIP') || '';

# Log the request
if ($config{debug_mode}) {
    log_message("DID Request - Campaign: $campaign_id, Agent: $agent_id");
}

# Call API to get DID
my $selected_did = get_did_from_api(
    $campaign_id,
    $agent_id,
    $customer_phone,
    $customer_state,
    $customer_zip
);

# Set the selected DID as channel variable
$AGI->set_variable('OPTIMIZER_DID', $selected_did);
$AGI->set_variable('OPTIMIZER_STATUS', 'SUCCESS');

# Log the selection
log_message("Selected DID: $selected_did for Campaign: $campaign_id");

exit 0;

# Function to read configuration
sub read_config {
    my ($config_file) = @_;
    my %config;

    open(my $fh, '<', $config_file) or die "Cannot open config file: $!";
    while (my $line = <$fh>) {
        chomp $line;
        next if $line =~ /^[;#]/;  # Skip comments
        next if $line =~ /^\s*$/;  # Skip empty lines

        if ($line =~ /^(\w+)\s*=\s*(.+)$/) {
            $config{$1} = $2;
        }
    }
    close($fh);

    return %config;
}

# Function to call DID Optimizer API
sub get_did_from_api {
    my ($campaign_id, $agent_id, $customer_phone, $customer_state, $customer_zip) = @_;

    my $ua = LWP::UserAgent->new(timeout => $config{api_timeout} || 5);

    # Build API URL with parameters
    my $url = $config{api_base_url} . '/api/v1/dids/next';
    $url .= '?campaign_id=' . uri_escape($campaign_id);
    $url .= '&agent_id=' . uri_escape($agent_id);
    $url .= '&customer_phone=' . uri_escape($customer_phone) if $customer_phone;
    $url .= '&customer_state=' . uri_escape($customer_state) if $customer_state;
    $url .= '&customer_zip=' . uri_escape($customer_zip) if $customer_zip;

    # Make API request
    my $response = $ua->get($url,
        'x-api-key' => $config{api_key},
        'Content-Type' => 'application/json'
    );

    if ($response->is_success) {
        my $data = decode_json($response->content);
        if ($data->{success} && $data->{data}->{phoneNumber}) {
            return $data->{data}->{phoneNumber};
        }
    }

    # Return fallback DID if API fails
    log_message("API failed, using fallback DID: " . $config{fallback_did});
    return $config{fallback_did};
}

# Function to log messages
sub log_message {
    my ($message) = @_;
    my $timestamp = localtime();
    open(my $log, '>>', '/var/log/astguiclient/did-optimizer.log');
    print $log "[$timestamp] $message\n";
    close($log);
}
```

### 2.3 Set Permissions
```bash
# Make script executable
sudo chmod +x /usr/share/astguiclient/vicidial-did-optimizer.agi

# Set ownership

# Create log file
sudo touch /var/log/astguiclient/did-optimizer.log
```

## Step 3: Configure Dialplan Context

### 3.1 Edit Extensions Configuration
```bash
# Backup existing configuration
sudo cp /etc/asterisk/extensions.conf /etc/asterisk/extensions.conf.backup

# Edit extensions.conf
sudo nano /etc/asterisk/extensions.conf
```

### 3.2 Add DID Optimizer Context
Add the following context to handle DID optimization:

```asterisk
; =====================================
; DID Optimizer Context
; =====================================
[did-optimizer]
; This context handles DID selection for outbound calls

; Set campaign and agent variables (can be passed from campaign settings)
exten => _X.,1,NoOp(Starting DID Optimizer for ${EXTEN})
exten => _X.,n,Set(CUSTOMER_PHONE=${EXTEN})
exten => _X.,n,AGI(vicidial-did-optimizer.agi)
exten => _X.,n,NoOp(Selected DID: ${OPTIMIZER_DID})
exten => _X.,n,GotoIf($["${OPTIMIZER_STATUS}" = "SUCCESS"]?dial:fallback)

; Dial with selected DID
exten => _X.,n(dial),Set(CALLERID(num)=${OPTIMIZER_DID})
exten => _X.,n,Set(CALLERID(name)=Outbound)
exten => _X.,n,AGI(agi://127.0.0.1:4577/call_log--HVcauses--PRI-----NODEBUG-----${EXTEN}-----${OPTIMIZER_DID})
exten => _X.,n,Dial(${TRUNK}/${EXTEN},55,tTo)
exten => _X.,n,Hangup()

; Fallback if optimization fails
exten => _X.,n(fallback),NoOp(DID Optimization failed, using default)
exten => _X.,n,Goto(default,${EXTEN},1)

; Handle invalid extensions
exten => i,1,Playback(invalid)
exten => i,n,Hangup()

; Handle timeout
exten => t,1,Hangup()
```

### 3.3 Integrate with VICIdial Campaign Dialplan
Add to your campaign's dialplan entry:

```asterisk
; =====================================
; VICIdial Campaign Integration
; =====================================
[vicidial-auto]
; ... existing entries ...

; Add DID Optimizer routing for campaigns
; Route calls through optimizer for specific campaigns
exten => _81NXXNXXXXXX,1,Set(CAMPAIGN=${CAMPAIGN_ID})
exten => _81NXXNXXXXXX,n,Set(AGENT=${AGENT_USER})
exten => _81NXXNXXXXXX,n,Goto(did-optimizer,${EXTEN:1},1)

exten => _91NXXNXXXXXX,1,Set(CAMPAIGN=${CAMPAIGN_ID})
exten => _91NXXNXXXXXX,n,Set(AGENT=${AGENT_USER})
exten => _91NXXNXXXXXX,n,Goto(did-optimizer,${EXTEN:1},1)
```

## Step 4: Configure Carrier/Trunk Settings

### 4.1 Update Carrier Configuration
In Admin > Carriers, update your carrier dialplan entry:

```asterisk
; Original carrier entry
exten => _91NXXNXXXXXX,1,AGI(agi://127.0.0.1:4577/call_log--HVcauses--PRI-----NODEBUG-----${EXTEN:1}-----${CALLERID(num)})
exten => _91NXXNXXXXXX,2,Dial(SIP/${EXTEN:1}@carrier-name,,tTo)
exten => _91NXXNXXXXXX,3,Hangup()

; Modified to use DID Optimizer
exten => _91NXXNXXXXXX,1,Goto(did-optimizer,${EXTEN:1},1)
```

## Step 5: Campaign-Specific Configuration

### 5.1 Set Campaign Variables
In VICIdial Admin > Campaigns > [Your Campaign] > Detail:

1. **Campaign CID**: Leave empty (will be set by optimizer)
2. **Custom Dialplan Entry**: Add the following:
```asterisk
exten => _X.,1,Set(CAMPAIGN_ID=${CAMPAIGN})
exten => _X.,n,Set(AGENT_USER=${AGENTUSER})
exten => _X.,n,Return()
```

### 5.2 Configure List Settings
For geographic optimization, ensure your lists have:
- State field populated
- Postal code field populated
- Phone number properly formatted

## Step 6: Testing and Verification

### 6.1 Test AGI Script Directly
```bash
# Test the AGI script
sudo -u asterisk /usr/share/astguiclient/vicidial-did-optimizer.agi

# Check the log
tail -f /var/log/astguiclient/did-optimizer.log
```

### 6.2 Test API Connectivity
```bash
# Test API endpoint directly
curl -X GET "http://api3.amdy.io:5000/api/v1/dids/next?campaign_id=TEST&agent_id=1001" \
     -H "x-api-key: did_315b95e7b2107598f4c5c6f51d21b3ac1768892fa81c1bb3ea38756bb1c2b43e"
```

### 6.3 Make Test Call
1. Log into agent interface
2. Set to READY status
3. Place manual dial call
4. Check Asterisk CLI for DID selection:
```bash
asterisk -rvvv
CLI> core set verbose 5
```

### 6.4 Monitor Real-Time
Watch the selection process:
```bash
# Monitor AGI execution
tail -f /var/log/astguiclient/agiout.*.log

# Monitor DID optimizer log
tail -f /var/log/astguiclient/did-optimizer.log

# Monitor Asterisk messages
tail -f /var/log/asterisk/messages
```

## Step 7: Reload and Apply Changes

### 7.1 Reload Asterisk Dialplan
```bash
# Reload dialplan
asterisk -rx "dialplan reload"

# Or full reload
asterisk -rx "reload"

# Verify context loaded
asterisk -rx "dialplan show did-optimizer"
```

### 7.2 Restart AGI Services
```bash
# Restart FastAGI
/usr/share/astguiclient/start_asterisk_scripts.pl

# Verify AGI is running
ps aux | grep FastAGI
```

## Step 8: Troubleshooting

### Common Issues and Solutions

#### Issue 1: DID not changing
**Solution**: Check that CAMPAIGN_ID and AGENT_USER variables are being set:
```bash
asterisk -rx "core show channel [channel_name]"
```

#### Issue 2: API timeout
**Solution**: Increase timeout in `/etc/asterisk/dids.conf`:
```ini
api_timeout=10
```

#### Issue 3: Permission denied
**Solution**: Ensure proper ownership:
```bash
sudo chown -R asterisk:asterisk /usr/share/astguiclient/
sudo chown -R asterisk:asterisk /var/log/astguiclient/
```

#### Issue 4: No DID returned
**Solution**: Check API key validity:
```bash
# Test API directly
curl -I http://api3.amdy.io:5000/api/v1/health \
     -H "x-api-key: did_315b95e7b2107598f4c5c6f51d21b3ac1768892fa81c1bb3ea38756bb1c2b43e"
```

## Step 9: Performance Optimization

### 9.1 Enable Caching
Add to `/etc/asterisk/dids.conf`:
```ini
cache_enabled=1
cache_ttl=300
```

### 9.2 Connection Pooling
For high-volume centers, implement connection pooling in the AGI script.

### 9.3 Monitoring
Set up monitoring for:
- API response times
- DID utilization rates
- Fallback DID usage frequency

## Step 10: Production Deployment Checklist

- [ ] Configuration file created and secured
- [ ] AGI script installed with correct permissions
- [ ] Dialplan context configured
- [ ] Carrier settings updated
- [ ] Campaign settings configured
- [ ] API connectivity verified
- [ ] Test calls successful
- [ ] Logging enabled and working
- [ ] Monitoring in place
- [ ] Backup of original configuration saved
- [ ] Documentation updated
- [ ] Team trained on new system

## Appendix A: Complete Configuration Files

### Complete /etc/asterisk/dids.conf
```ini
; DID Optimizer Configuration
; Generated: 2024
api_key=did_315b95e7b2107598f4c5c6f51d21b3ac1768892fa81c1bb3ea38756bb1c2b43e
api_base_url=http://api3.amdy.io:5000
api_timeout=5
api_retry_count=3
fallback_did=+18005551234
debug_mode=1
cache_enabled=1
cache_ttl=300
log_level=INFO
```

## Appendix B: API Response Format

### Successful Response
```json
{
  "success": true,
  "data": {
    "phoneNumber": "+14155551234",
    "didId": "507f1f77bcf86cd799439011",
    "provider": "Telnyx",
    "state": "CA",
    "areaCode": "415",
    "reputation": 85,
    "isFallback": false
  }
}
```

### Error Response
```json
{
  "success": false,
  "error": "No DIDs available",
  "fallbackUsed": true
}
```

## Support and Maintenance

### Log Locations
- AGI Script Log: `/var/log/astguiclient/did-optimizer.log`
- VICIdial AGI Log: `/var/log/astguiclient/agiout.*.log`
- Asterisk Log: `/var/log/asterisk/messages`
- API Server Log: Check server-full.js output

### Regular Maintenance Tasks
1. Weekly: Review DID utilization reports
2. Monthly: Rotate API keys for security
3. Quarterly: Audit DID pool and reputation scores

### Contact Information
- API Issues: Check http://api3.amdy.io:5000/api/v1/health
- Database Issues: MongoDB at mongodb://127.0.0.1:27017/did-optimizer

---
Document Version: 1.0
Last Updated: 2024
Tested with: VICIdial 2.14, Asterisk 13.x/16.x, Node.js 18.x