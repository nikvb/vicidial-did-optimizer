# AGI Script Configuration Guide for DID Optimizer

## Overview
This document provides detailed configuration instructions for the Asterisk Gateway Interface (AGI) script that integrates VICIdial with the DID Optimizer API. The AGI script is the bridge between your VICIdial system and the intelligent DID rotation service.

## AGI Script Architecture

### Component Flow
```
VICIdial Campaign → Asterisk Dialplan → AGI Script → DID Optimizer API → Selected DID → Carrier
```

### Key Components
1. **AGI Script** (`vicidial-did-optimizer.agi`) - Perl script that handles API communication
2. **Configuration File** (`/etc/asterisk/dids.conf`) - Stores API credentials and settings
3. **Dialplan Context** - Routes calls through the AGI script
4. **Channel Variables** - Pass data between VICIdial and the script

## Detailed AGI Configuration

### 1. Core AGI Variables

The AGI script reads and sets the following Asterisk channel variables:

#### Input Variables (from VICIdial)
```perl
# Campaign Information
CAMPAIGN_ID     # The VICIdial campaign identifier
CAMPAIGN        # Alternative campaign variable name
CAMPAIGN_NAME   # Human-readable campaign name

# Agent Information
AGENT_USER      # Agent login ID
AGENT_ID        # Numeric agent identifier
AGENT_NAME      # Agent full name

# Customer Information
CUSTOMER_PHONE  # Customer's phone number
CUSTOMER_STATE  # Two-letter state code (e.g., "CA")
CUSTOMER_ZIP    # ZIP/postal code
CUSTOMER_CITY   # City name
LEAD_ID         # VICIdial lead ID

# Call Information
UNIQUEID        # Asterisk unique call ID
CHANNEL         # Current channel name
CONTEXT         # Current dialplan context
```

#### Output Variables (set by AGI)
```perl
# DID Selection Results
OPTIMIZER_DID      # Selected phone number
OPTIMIZER_STATUS   # Status (SUCCESS/FAILURE)
OPTIMIZER_PROVIDER # DID provider name
OPTIMIZER_STATE    # DID state location
OPTIMIZER_SCORE    # DID reputation score
OPTIMIZER_FALLBACK # Whether fallback was used (YES/NO)
```

### 2. Configuration File Parameters

Create `/etc/asterisk/dids.conf` with the following parameters:

```ini
; =========================================
; DID Optimizer AGI Configuration
; =========================================

; API Connection Settings
api_key=did_315b95e7b2107598f4c5c6f51d21b3ac1768892fa81c1bb3ea38756bb1c2b43e
api_base_url=http://api3.amdy.io:5000
api_version=v1

; Timeout and Retry Settings
api_timeout=5                ; Seconds to wait for API response
api_retry_count=3            ; Number of retry attempts
api_retry_delay=1            ; Seconds between retries

; Fallback Configuration
fallback_did=+18005551234    ; DID to use if API fails
fallback_on_error=1          ; Use fallback on API errors
fallback_on_timeout=1        ; Use fallback on timeout

; Caching Settings
cache_enabled=1              ; Enable DID caching
cache_ttl=300               ; Cache time-to-live in seconds
cache_size=1000             ; Maximum cache entries

; Logging Configuration
debug_mode=1                ; Enable debug logging (0=off, 1=on)
log_level=INFO              ; Log level: DEBUG, INFO, WARNING, ERROR
log_file=/var/log/astguiclient/did-optimizer.log
log_rotation=daily          ; Log rotation: daily, weekly, size
log_max_size=100M           ; Maximum log file size

; Performance Settings
connection_pool=1           ; Use connection pooling
max_connections=10          ; Maximum API connections
request_queue_size=100      ; Maximum queued requests

; Geographic Preferences
prefer_local_state=1        ; Prefer DIDs from customer's state
prefer_local_area=1         ; Prefer DIDs from customer's area code
state_match_weight=10       ; Weight for state matching (0-100)
area_match_weight=20        ; Weight for area code matching (0-100)

; Advanced Settings
use_reputation_scoring=1    ; Consider DID reputation
min_reputation_score=70     ; Minimum acceptable reputation
rotation_algorithm=round_robin  ; Options: round_robin, weighted, random
exclude_blacklisted=1       ; Exclude blacklisted DIDs
```

### 3. AGI Script Installation

#### 3.1 Enhanced AGI Script with Error Handling
```perl
#!/usr/bin/perl
#
# vicidial-did-optimizer.agi - Enhanced DID Optimizer AGI Script
# Version: 2.0
#

use strict;
use warnings;
use Asterisk::AGI;
use LWP::UserAgent;
use JSON;
use URI::Escape;
use Time::HiRes qw(gettimeofday tv_interval);
use Cache::FileCache;
use POSIX qw(strftime);

# Initialize AGI
my $AGI = new Asterisk::AGI;
my %input = $AGI->ReadParse();

# Initialize cache if enabled
my $cache;
my %config = read_config('/etc/asterisk/dids.conf');

if ($config{cache_enabled}) {
    $cache = Cache::FileCache->new({
        namespace => 'did_optimizer',
        default_expires_in => $config{cache_ttl} || 300,
        cache_root => '/tmp/did_cache'
    });
}

# Start timer for performance tracking
my $start_time = [gettimeofday];

# Get all relevant channel variables
my %call_data = get_call_data();

# Log the request
log_message("INFO", "DID Request - Campaign: $call_data{campaign_id}, Agent: $call_data{agent_id}, Customer: $call_data{customer_phone}");

# Check cache first
my $cache_key = generate_cache_key(%call_data);
my $selected_did;

if ($config{cache_enabled} && $cache) {
    $selected_did = $cache->get($cache_key);
    if ($selected_did) {
        log_message("DEBUG", "Cache hit for key: $cache_key");
    }
}

# If not in cache, call API
if (!$selected_did) {
    $selected_did = get_did_from_api_with_retry(%call_data);

    # Store in cache if successful
    if ($config{cache_enabled} && $cache && $selected_did ne $config{fallback_did}) {
        $cache->set($cache_key, $selected_did);
        log_message("DEBUG", "Cached DID for key: $cache_key");
    }
}

# Set channel variables
$AGI->set_variable('OPTIMIZER_DID', $selected_did);
$AGI->set_variable('OPTIMIZER_STATUS', $selected_did ? 'SUCCESS' : 'FAILURE');
$AGI->set_variable('OPTIMIZER_FALLBACK', $selected_did eq $config{fallback_did} ? 'YES' : 'NO');

# Calculate and log execution time
my $elapsed = tv_interval($start_time);
log_message("INFO", sprintf("DID selection completed in %.3f seconds - Selected: %s", $elapsed, $selected_did));

# Update statistics
update_statistics($selected_did, $elapsed);

exit 0;

# =====================================
# Subroutines
# =====================================

sub get_call_data {
    my %data;

    # Campaign data
    $data{campaign_id} = $AGI->get_variable('CAMPAIGN_ID') ||
                        $AGI->get_variable('CAMPAIGN') ||
                        'DEFAULT';

    # Agent data
    $data{agent_id} = $AGI->get_variable('AGENT_USER') ||
                     $AGI->get_variable('AGENT_ID') ||
                     '0';

    # Customer data
    $data{customer_phone} = $AGI->get_variable('CUSTOMER_PHONE') ||
                           $input{callerid} || '';
    $data{customer_state} = $AGI->get_variable('CUSTOMER_STATE') || '';
    $data{customer_zip} = $AGI->get_variable('CUSTOMER_ZIP') || '';
    $data{customer_city} = $AGI->get_variable('CUSTOMER_CITY') || '';

    # Call metadata
    $data{uniqueid} = $input{uniqueid} || '';
    $data{channel} = $input{channel} || '';
    $data{context} = $input{context} || '';
    $data{lead_id} = $AGI->get_variable('LEAD_ID') || '';

    return %data;
}

sub get_did_from_api_with_retry {
    my (%call_data) = @_;

    my $max_retries = $config{api_retry_count} || 3;
    my $retry_delay = $config{api_retry_delay} || 1;

    for (my $attempt = 1; $attempt <= $max_retries; $attempt++) {
        my $did = call_optimizer_api(%call_data);

        if ($did && $did ne $config{fallback_did}) {
            return $did;
        }

        if ($attempt < $max_retries) {
            log_message("WARNING", "API attempt $attempt failed, retrying in $retry_delay seconds...");
            sleep($retry_delay);
        }
    }

    log_message("ERROR", "All API attempts failed, using fallback DID");
    return $config{fallback_did};
}

sub call_optimizer_api {
    my (%call_data) = @_;

    my $ua = LWP::UserAgent->new(
        timeout => $config{api_timeout} || 5,
        agent => 'VICIdial-DID-Optimizer/2.0'
    );

    # Build URL with parameters
    my $url = $config{api_base_url} . '/api/' . ($config{api_version} || 'v1') . '/dids/next';
    my @params;

    push @params, 'campaign_id=' . uri_escape($call_data{campaign_id});
    push @params, 'agent_id=' . uri_escape($call_data{agent_id});
    push @params, 'customer_phone=' . uri_escape($call_data{customer_phone}) if $call_data{customer_phone};
    push @params, 'customer_state=' . uri_escape($call_data{customer_state}) if $call_data{customer_state};
    push @params, 'customer_zip=' . uri_escape($call_data{customer_zip}) if $call_data{customer_zip};
    push @params, 'lead_id=' . uri_escape($call_data{lead_id}) if $call_data{lead_id};

    $url .= '?' . join('&', @params);

    log_message("DEBUG", "API Request: $url");

    # Make API request
    my $response = $ua->get($url,
        'x-api-key' => $config{api_key},
        'Content-Type' => 'application/json',
        'X-Request-ID' => $call_data{uniqueid}
    );

    if ($response->is_success) {
        my $content = $response->content;
        log_message("DEBUG", "API Response: $content");

        eval {
            my $data = decode_json($content);
            if ($data->{success} && $data->{data}->{phoneNumber}) {
                # Set additional variables if available
                if ($data->{data}->{provider}) {
                    $AGI->set_variable('OPTIMIZER_PROVIDER', $data->{data}->{provider});
                }
                if ($data->{data}->{state}) {
                    $AGI->set_variable('OPTIMIZER_STATE', $data->{data}->{state});
                }
                if ($data->{data}->{reputation}) {
                    $AGI->set_variable('OPTIMIZER_SCORE', $data->{data}->{reputation});
                }

                return $data->{data}->{phoneNumber};
            }
        };

        if ($@) {
            log_message("ERROR", "JSON decode error: $@");
        }
    } else {
        log_message("ERROR", "API request failed: " . $response->status_line);
    }

    return undef;
}

sub generate_cache_key {
    my (%call_data) = @_;

    # Create cache key based on campaign and geographic data
    my @key_parts = (
        $call_data{campaign_id},
        $call_data{customer_state} || 'XX',
        substr($call_data{customer_phone} || '0000000000', 0, 6)  # Area code + prefix
    );

    return join(':', @key_parts);
}

sub read_config {
    my ($config_file) = @_;
    my %config;

    if (!-e $config_file) {
        die "Configuration file not found: $config_file";
    }

    open(my $fh, '<', $config_file) or die "Cannot open config file: $!";
    while (my $line = <$fh>) {
        chomp $line;
        next if $line =~ /^[;#]/;  # Skip comments
        next if $line =~ /^\s*$/;  # Skip empty lines

        if ($line =~ /^(\w+)\s*=\s*(.+)$/) {
            my ($key, $value) = ($1, $2);
            $value =~ s/\s+$//;  # Trim trailing whitespace
            $config{$key} = $value;
        }
    }
    close($fh);

    # Validate required configuration
    die "Missing api_key in configuration" unless $config{api_key};
    die "Missing api_base_url in configuration" unless $config{api_base_url};
    die "Missing fallback_did in configuration" unless $config{fallback_did};

    return %config;
}

sub log_message {
    my ($level, $message) = @_;

    # Check log level
    my %log_levels = (
        DEBUG => 0,
        INFO => 1,
        WARNING => 2,
        ERROR => 3
    );

    my $config_level = $log_levels{$config{log_level} || 'INFO'};
    my $message_level = $log_levels{$level};

    return if $message_level < $config_level;
    return if !$config{debug_mode} && $level eq 'DEBUG';

    my $timestamp = strftime("%Y-%m-%d %H:%M:%S", localtime);
    my $log_file = $config{log_file} || '/var/log/astguiclient/did-optimizer.log';

    open(my $log, '>>', $log_file) or return;
    flock($log, 2);  # Exclusive lock
    print $log "[$timestamp] [$level] $message\n";
    close($log);
}

sub update_statistics {
    my ($did, $response_time) = @_;

    # Update statistics file for monitoring
    my $stats_file = '/var/log/astguiclient/did-optimizer-stats.log';
    open(my $stats, '>>', $stats_file) or return;
    flock($stats, 2);

    my $timestamp = time();
    my $is_fallback = $did eq $config{fallback_did} ? 1 : 0;

    print $stats "$timestamp,$did,$response_time,$is_fallback\n";
    close($stats);
}
```

### 4. Testing the AGI Script

#### 4.1 Command Line Testing
```bash
# Test script directly (as asterisk user)
sudo -u asterisk /usr/share/astguiclient/vicidial-did-optimizer.agi << EOF
agi_request: vicidial-did-optimizer.agi
agi_channel: SIP/test-00000001
agi_language: en
agi_type: SIP
agi_uniqueid: 1234567890.1
agi_callerid: 4155551234
agi_context: default
agi_extension: 8005551234
agi_priority: 1
EOF
```

#### 4.2 Set Test Variables
```bash
# Create test script
cat > /tmp/test-agi.sh << 'EOF'
#!/bin/bash
export CAMPAIGN_ID="TEST001"
export AGENT_USER="1001"
export CUSTOMER_PHONE="4155551234"
export CUSTOMER_STATE="CA"
export CUSTOMER_ZIP="94102"

/usr/share/astguiclient/vicidial-did-optimizer.agi
EOF

chmod +x /tmp/test-agi.sh
sudo -u asterisk /tmp/test-agi.sh
```

### 5. Integration with VICIdial Campaigns

#### 5.1 Campaign Dialplan Entry
In VICIdial Admin, add to Campaign Custom Dialplan Entry:
```asterisk
; Set variables for DID Optimizer
exten => _X.,1,Set(CAMPAIGN_ID=${CAMPAIGN})
exten => _X.,n,Set(AGENT_USER=${CIDname})
exten => _X.,n,Set(CUSTOMER_PHONE=${EXTEN})
exten => _X.,n,Set(LEAD_ID=${LEADID})
exten => _X.,n,Return()
```

#### 5.2 Carrier Dialplan Entry
Modify carrier dialplan to use AGI:
```asterisk
exten => _91NXXNXXXXXX,1,AGI(vicidial-did-optimizer.agi)
exten => _91NXXNXXXXXX,n,Set(CALLERID(num)=${OPTIMIZER_DID})
exten => _91NXXNXXXXXX,n,AGI(agi://127.0.0.1:4577/call_log--HVcauses--PRI-----NODEBUG-----${EXTEN:1}-----${OPTIMIZER_DID})
exten => _91NXXNXXXXXX,n,Dial(SIP/${EXTEN:1}@carrier,,tTo)
exten => _91NXXNXXXXXX,n,Hangup()
```

### 6. Monitoring and Logging

#### 6.1 Log File Locations
```bash
# Main AGI log
/var/log/astguiclient/did-optimizer.log

# Statistics log
/var/log/astguiclient/did-optimizer-stats.log

# VICIdial AGI output
/var/log/astguiclient/agiout.YYYY-MM-DD

# Asterisk verbose log
/var/log/asterisk/messages
```

#### 6.2 Real-Time Monitoring
```bash
# Watch AGI execution
tail -f /var/log/astguiclient/did-optimizer.log

# Monitor statistics
watch -n 1 'tail -20 /var/log/astguiclient/did-optimizer-stats.log'

# Check cache hit ratio
grep "Cache hit" /var/log/astguiclient/did-optimizer.log | wc -l
```

#### 6.3 Performance Metrics Script
```bash
#!/bin/bash
# did-optimizer-metrics.sh

LOG="/var/log/astguiclient/did-optimizer-stats.log"

echo "DID Optimizer Performance Metrics"
echo "================================="

# Average response time
AVG_TIME=$(awk -F',' '{sum+=$3; count++} END {print sum/count}' $LOG)
echo "Average Response Time: ${AVG_TIME}s"

# Fallback rate
TOTAL=$(wc -l < $LOG)
FALLBACKS=$(awk -F',' '$4==1' $LOG | wc -l)
FALLBACK_RATE=$(echo "scale=2; $FALLBACKS * 100 / $TOTAL" | bc)
echo "Fallback Rate: ${FALLBACK_RATE}%"

# Calls per minute
FIRST_TIME=$(head -1 $LOG | cut -d',' -f1)
LAST_TIME=$(tail -1 $LOG | cut -d',' -f1)
DURATION=$((LAST_TIME - FIRST_TIME))
CPM=$(echo "scale=2; $TOTAL * 60 / $DURATION" | bc)
echo "Calls Per Minute: $CPM"
```

### 7. Security Considerations

#### 7.1 Secure the Configuration File
```bash
# Set restrictive permissions
sudo chmod 640 /etc/asterisk/dids.conf
sudo chown asterisk:asterisk /etc/asterisk/dids.conf

# Encrypt sensitive data (optional)
openssl enc -aes-256-cbc -salt -in dids.conf -out dids.conf.enc
```

#### 7.2 API Key Rotation
Implement regular API key rotation:
```bash
# Generate new API key via API
curl -X POST http://api3.amdy.io:5000/api/v1/auth/rotate-key \
     -H "x-api-key: current_key_here" \
     -H "Content-Type: application/json"
```

### 8. Troubleshooting Guide

#### Problem: AGI script not executing
```bash
# Check permissions
ls -la /usr/share/astguiclient/vicidial-did-optimizer.agi

# Check AGI debug
asterisk -rx "agi set debug on"
```

#### Problem: API timeouts
```bash
# Test API directly
time curl http://api3.amdy.io:5000/api/v1/health \
     -H "x-api-key: your_key_here"

# Increase timeout in config
api_timeout=10
```

#### Problem: Cache issues
```bash
# Clear cache
rm -rf /tmp/did_cache/*

# Disable cache temporarily
cache_enabled=0
```

## Conclusion

This AGI configuration provides a robust, scalable integration between VICIdial and the DID Optimizer API. The script includes:
- Comprehensive error handling
- Performance optimization through caching
- Detailed logging for troubleshooting
- Flexible configuration options
- Security best practices

Regular monitoring and maintenance will ensure optimal performance of your DID rotation system.