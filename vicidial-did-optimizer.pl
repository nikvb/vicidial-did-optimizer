#!/usr/bin/perl

##############################################################################
# VICIdial DID Optimizer Integration Script
#
# This script integrates VICIdial with the DID Optimizer Pro API
# Features:
# - Geographic proximity DID selection
# - Daily usage limit enforcement (200 calls per DID)
# - Comprehensive call data collection for AI training
# - Automatic failover and error handling
# - Detailed logging for analytics
#
# Installation:
# 1. Place this script in /usr/share/astguiclient/
# 2. Make executable: chmod +x vicidial-did-optimizer.pl
# 3. Configure API settings below
# 4. Test with: perl vicidial-did-optimizer.pl --test
#
# Usage in VICIdial:
# In your campaign settings, set the "Outbound Cid" to:
# COMPAT_DID_OPTIMIZER
#
# VICIdial will automatically call this script for each outbound call
##############################################################################

use strict;
use warnings;
use LWP::UserAgent;
use JSON;
use Getopt::Long;
use Time::HiRes qw(time);
use Data::Dumper;

##############################################################################
# CONFIGURATION - MODIFY THESE SETTINGS
##############################################################################

# DID Optimizer API Configuration
my $API_BASE_URL = 'http://localhost:3001';  # Change to your server URL
my $API_KEY = 'did_250f218b1404c84b5eda3dbf87f6cc70e63ce2904d8efdd607aab2f3b7733e5a';  # Your API key
my $API_TIMEOUT = 10;  # API timeout in seconds

# VICIdial Database Configuration
my $DB_HOST = 'localhost';
my $DB_USER = 'cron';
my $DB_PASS = '1234';
my $DB_NAME = 'asterisk';

# Logging Configuration
my $LOG_FILE = '/var/log/astguiclient/did_optimizer.log';
my $DEBUG = 1;  # Set to 1 for debug logging

# Fallback Configuration
my $FALLBACK_DID = '+18005551234';  # Fallback DID if API fails
my $MAX_RETRIES = 3;

##############################################################################
# GLOBAL VARIABLES
##############################################################################

my $ua = LWP::UserAgent->new(timeout => $API_TIMEOUT);
my $json = JSON->new->utf8;

# Command line options
my $test_mode = 0;
my $campaign_id = '';
my $agent_id = '';
my $phone_number = '';
my $caller_state = '';
my $caller_zip = '';
my $help = 0;

##############################################################################
# MAIN EXECUTION
##############################################################################

GetOptions(
    'test' => \$test_mode,
    'campaign=s' => \$campaign_id,
    'agent=s' => \$agent_id,
    'phone=s' => \$phone_number,
    'state=s' => \$caller_state,
    'zip=s' => \$caller_zip,
    'help' => \$help
);

if ($help) {
    print_help();
    exit 0;
}

if ($test_mode) {
    run_tests();
    exit 0;
}

# Get parameters from VICIdial environment or command line
$campaign_id = $ENV{'campaign_id'} || $campaign_id || $ARGV[0] || '';
$agent_id = $ENV{'agent_id'} || $agent_id || $ARGV[1] || '';
$phone_number = $ENV{'phone_number'} || $phone_number || $ARGV[2] || '';
$caller_state = $ENV{'state'} || $caller_state || $ARGV[3] || '';
$caller_zip = $ENV{'zip_code'} || $caller_zip || $ARGV[4] || '';

log_message("INFO", "Starting DID selection for campaign=$campaign_id, agent=$agent_id, phone=$phone_number");

# Get optimal DID from API
my $selected_did = get_optimal_did($campaign_id, $agent_id, $phone_number, $caller_state, $caller_zip);

if ($selected_did) {
    log_message("INFO", "Selected DID: $selected_did->{phoneNumber} (algorithm: $selected_did->{algorithm})");

    # Output the selected DID for VICIdial
    print $selected_did->{phoneNumber} . "\n";

    # Log selection details for analytics
    log_selection_details($selected_did, $campaign_id, $agent_id);
} else {
    log_message("ERROR", "Failed to get DID from API, using fallback: $FALLBACK_DID");
    print $FALLBACK_DID . "\n";
}

exit 0;

##############################################################################
# SUBROUTINES
##############################################################################

sub get_optimal_did {
    my ($campaign_id, $agent_id, $phone_number, $state, $zip) = @_;

    # Get customer location data for geographic matching
    my $location_data = get_customer_location($phone_number, $state, $zip);

    # Build API request parameters
    my %params = (
        'campaign_id' => $campaign_id || 'UNKNOWN',
        'agent_id' => $agent_id || 'UNKNOWN'
    );

    # Add geographic parameters if available
    if ($location_data->{latitude} && $location_data->{longitude}) {
        $params{latitude} = $location_data->{latitude};
        $params{longitude} = $location_data->{longitude};
        log_message("DEBUG", "Using coordinates: $location_data->{latitude}, $location_data->{longitude}");
    }

    if ($location_data->{state}) {
        $params{state} = $location_data->{state};
        log_message("DEBUG", "Using state: $location_data->{state}");
    }

    if ($location_data->{area_code}) {
        $params{area_code} = $location_data->{area_code};
        log_message("DEBUG", "Using area code: $location_data->{area_code}");
    }

    # Build query string
    my $query_string = join('&', map { "$_=" . uri_escape($params{$_}) } keys %params);
    my $url = "$API_BASE_URL/api/v1/vicidial/next-did?$query_string";

    log_message("DEBUG", "API Request URL: $url");

    # Make API request with retries
    for my $attempt (1..$MAX_RETRIES) {
        log_message("DEBUG", "API attempt $attempt of $MAX_RETRIES");

        my $request = HTTP::Request->new(GET => $url);
        $request->header('x-api-key' => $API_KEY);
        $request->header('Content-Type' => 'application/json');

        my $response = $ua->request($request);

        if ($response->is_success) {
            my $data = eval { $json->decode($response->content) };

            if ($@ || !$data->{success}) {
                log_message("ERROR", "API response parse error: " . ($@ || $data->{message} || 'Unknown error'));
                next;  # Try again
            }

            log_message("DEBUG", "API Response: " . $response->content);

            # Store API response data for call result reporting
            store_call_context($data->{data}, $phone_number, $location_data);

            return $data->{data};
        } else {
            log_message("ERROR", "API request failed (attempt $attempt): " . $response->status_line);
            if ($attempt == $MAX_RETRIES) {
                log_message("ERROR", "All API attempts failed, using fallback DID");
                return undef;
            }
            sleep(1);  # Brief delay before retry
        }
    }

    return undef;
}

sub get_customer_location {
    my ($phone_number, $state, $zip) = @_;

    my $location = {};

    # Extract area code from phone number
    if ($phone_number && $phone_number =~ /(\d{3})/) {
        $location->{area_code} = $1;
        log_message("DEBUG", "Extracted area code: $1");
    }

    # Use provided state
    if ($state) {
        $location->{state} = uc($state);
        log_message("DEBUG", "Using provided state: $state");
    }

    # Use provided ZIP code
    if ($zip) {
        $location->{zip_code} = $zip;
        log_message("DEBUG", "Using provided ZIP: $zip");

        # Convert ZIP to coordinates (simplified - you can enhance this)
        my $coords = zip_to_coordinates($zip);
        if ($coords) {
            $location->{latitude} = $coords->{lat};
            $location->{longitude} = $coords->{lon};
        }
    }

    # If no state provided, try to get from area code
    if (!$location->{state} && $location->{area_code}) {
        $location->{state} = area_code_to_state($location->{area_code});
    }

    # If no coordinates and we have state, use state center
    if (!$location->{latitude} && $location->{state}) {
        my $coords = state_to_coordinates($location->{state});
        if ($coords) {
            $location->{latitude} = $coords->{lat};
            $location->{longitude} = $coords->{lon};
        }
    }

    return $location;
}

sub area_code_to_state {
    my ($area_code) = @_;

    # Simplified area code to state mapping (add more as needed)
    my %area_code_map = (
        '415' => 'CA', '510' => 'CA', '650' => 'CA', '925' => 'CA',
        '212' => 'NY', '646' => 'NY', '917' => 'NY', '718' => 'NY',
        '303' => 'CO', '720' => 'CO', '970' => 'CO',
        '713' => 'TX', '832' => 'TX', '281' => 'TX', '409' => 'TX',
        '305' => 'FL', '786' => 'FL', '954' => 'FL', '561' => 'FL'
    );

    return $area_code_map{$area_code} || '';
}

sub state_to_coordinates {
    my ($state) = @_;

    # State center coordinates (same as server-side)
    my %state_coords = (
        'CA' => { lat => 36.7783, lon => -119.4179 },
        'NY' => { lat => 40.7589, lon => -73.9851 },
        'TX' => { lat => 31.0000, lon => -100.0000 },
        'FL' => { lat => 27.7663, lon => -81.6868 },
        'CO' => { lat => 39.5501, lon => -105.7821 },
        'IL' => { lat => 40.6331, lon => -89.3985 },
        'OH' => { lat => 40.4173, lon => -82.9071 },
        'PA' => { lat => 41.2033, lon => -77.1945 },
        'MI' => { lat => 44.3467, lon => -85.4102 },
        'GA' => { lat => 32.1656, lon => -82.9001 }
    );

    return $state_coords{uc($state)};
}

sub zip_to_coordinates {
    my ($zip) = @_;

    # This is a simplified example. In production, you would use a ZIP code database
    # or service like Google Geocoding API, ZIP code database, etc.

    # For now, return undef to fall back to state coordinates
    return undef;
}

sub store_call_context {
    my ($did_data, $phone_number, $location_data) = @_;

    # Store call context for later call result reporting
    # This could be stored in a temp file, database, or memory cache

    my $context = {
        did_id => $did_data->{didId},
        phone_number => $did_data->{phoneNumber},
        campaign_id => $did_data->{campaign_id},
        agent_id => $did_data->{agent_id},
        selected_at => $did_data->{selectedAt},
        algorithm => $did_data->{algorithm},
        customer_phone => $phone_number,
        customer_location => $location_data,
        api_metadata => $did_data->{metadata}
    };

    # Store in temporary file (you might want to use a database or Redis instead)
    my $context_file = "/tmp/did_context_" . $did_data->{campaign_id} . "_" . $phone_number . ".json";

    if (open my $fh, '>', $context_file) {
        print $fh $json->encode($context);
        close $fh;
        log_message("DEBUG", "Stored call context: $context_file");
    } else {
        log_message("ERROR", "Failed to store call context: $!");
    }
}

sub report_call_result {
    my ($phone_number, $campaign_id, $result, $duration, $disposition) = @_;

    # This function should be called from your VICIdial dialplan
    # when a call completes to report the result back to the API

    # Load call context
    my $context_file = "/tmp/did_context_" . $campaign_id . "_" . $phone_number . ".json";
    my $context = {};

    if (-f $context_file) {
        if (open my $fh, '<', $context_file) {
            local $/;
            my $content = <$fh>;
            close $fh;
            $context = eval { $json->decode($content) } || {};
            unlink $context_file;  # Clean up
        }
    }

    # Get additional customer data from VICIdial database
    my $customer_data = get_customer_data_from_db($phone_number, $campaign_id);

    # Prepare API request
    my $payload = {
        phoneNumber => $context->{phone_number} || $FALLBACK_DID,
        campaign_id => $campaign_id,
        agent_id => $context->{agent_id} || 'UNKNOWN',
        result => $result,
        duration => $duration || 0,
        disposition => $disposition || '',
        customerData => $customer_data
    };

    my $url = "$API_BASE_URL/api/v1/vicidial/call-result";

    log_message("INFO", "Reporting call result: $result for $phone_number");

    my $request = HTTP::Request->new(POST => $url);
    $request->header('x-api-key' => $API_KEY);
    $request->header('Content-Type' => 'application/json');
    $request->content($json->encode($payload));

    my $response = $ua->request($request);

    if ($response->is_success) {
        log_message("INFO", "Call result reported successfully");
        log_message("DEBUG", "API Response: " . $response->content);
    } else {
        log_message("ERROR", "Failed to report call result: " . $response->status_line);
    }
}

sub get_customer_data_from_db {
    my ($phone_number, $campaign_id) = @_;

    # Connect to VICIdial database and get customer data for AI training
    # This requires DBI and DBD::mysql modules

    my $customer_data = {};

    eval {
        require DBI;
        require DBD::mysql;

        my $dbh = DBI->connect("DBI:mysql:$DB_NAME:$DB_HOST", $DB_USER, $DB_PASS)
            or die "Could not connect to database: $DBI::errstr";

        # Get customer data from vicidial_list table
        my $sql = "
            SELECT
                state,
                postal_code as zip,
                YEAR(CURDATE()) - YEAR(date_of_birth) as age,
                gender,
                source_id as lead_source,
                rank as lead_score,
                called_count as contact_attempt
            FROM vicidial_list
            WHERE phone_number = ?
            LIMIT 1
        ";

        my $sth = $dbh->prepare($sql);
        $sth->execute($phone_number);

        if (my $row = $sth->fetchrow_hashref) {
            $customer_data = {
                state => $row->{state} || '',
                zip => $row->{zip} || '',
                age => $row->{age} || 0,
                gender => $row->{gender} || '',
                leadSource => $row->{lead_source} || '',
                leadScore => $row->{lead_score} || 0,
                contactAttempt => $row->{contact_attempt} || 1
            };
        }

        $dbh->disconnect;

        log_message("DEBUG", "Retrieved customer data: " . Dumper($customer_data));

    };

    if ($@) {
        log_message("ERROR", "Database query failed: $@");
    }

    return $customer_data;
}

sub log_selection_details {
    my ($selected_did, $campaign_id, $agent_id) = @_;

    # Log detailed selection information for analytics
    my $details = {
        timestamp => time(),
        campaign_id => $campaign_id,
        agent_id => $agent_id,
        selected_did => $selected_did->{phoneNumber},
        algorithm => $selected_did->{algorithm},
        distance => $selected_did->{location}->{distance} || 'N/A',
        today_usage => $selected_did->{metadata}->{todayUsage} || 0,
        daily_limit => $selected_did->{metadata}->{dailyLimit} || 0,
        total_calls => $selected_did->{metadata}->{totalCalls} || 0,
        state => $selected_did->{metadata}->{state} || '',
        area_code => $selected_did->{metadata}->{areaCode} || ''
    };

    log_message("ANALYTICS", "SELECTION_DETAILS: " . $json->encode($details));
}

sub log_message {
    my ($level, $message) = @_;

    return unless $DEBUG || $level ne 'DEBUG';

    my $timestamp = sprintf("%04d-%02d-%02d %02d:%02d:%02d",
        (localtime)[5]+1900, (localtime)[4]+1, (localtime)[3],
        (localtime)[2], (localtime)[1], (localtime)[0]);

    my $log_entry = "[$timestamp] [$level] $message\n";

    if (open my $fh, '>>', $LOG_FILE) {
        print $fh $log_entry;
        close $fh;
    }

    print STDERR $log_entry if $DEBUG;
}

sub uri_escape {
    my ($str) = @_;
    $str =~ s/([^A-Za-z0-9\-_.~])/sprintf("%%%02X", ord($1))/eg;
    return $str;
}

sub run_tests {
    print "🧪 Running DID Optimizer Integration Tests...\n\n";

    # Test 1: API Health Check
    print "1. Testing API Health Check...\n";
    my $health_url = "$API_BASE_URL/api/v1/vicidial/health";
    my $request = HTTP::Request->new(GET => $health_url);
    $request->header('x-api-key' => $API_KEY);

    my $response = $ua->request($request);
    if ($response->is_success) {
        print "   ✅ API Health Check: PASSED\n";
        my $data = eval { $json->decode($response->content) };
        if ($data && $data->{success}) {
            print "   📊 Active DIDs: $data->{data}->{activeDIDs}\n";
            print "   🔄 Active Rules: $data->{data}->{activeRotationRules}\n";
        }
    } else {
        print "   ❌ API Health Check: FAILED - " . $response->status_line . "\n";
        return;
    }

    # Test 2: DID Selection
    print "\n2. Testing DID Selection...\n";
    my $test_did = get_optimal_did('TEST_CAMPAIGN', 'TEST_AGENT', '4155551234', 'CA', '94102');
    if ($test_did) {
        print "   ✅ DID Selection: PASSED\n";
        print "   📞 Selected: $test_did->{phoneNumber}\n";
        print "   🎯 Algorithm: $test_did->{algorithm}\n";
        print "   📏 Distance: " . ($test_did->{location}->{distance} || 'N/A') . " miles\n";
    } else {
        print "   ❌ DID Selection: FAILED\n";
        return;
    }

    # Test 3: Call Result Reporting
    print "\n3. Testing Call Result Reporting...\n";
    report_call_result('4155551234', 'TEST_CAMPAIGN', 'answered', 120, 'SALE');
    print "   ✅ Call Result Reporting: COMPLETED\n";

    # Test 4: Geographic Functions
    print "\n4. Testing Geographic Functions...\n";
    my $state = area_code_to_state('415');
    print "   📍 Area code 415 -> State: $state\n";

    my $coords = state_to_coordinates('CA');
    if ($coords) {
        print "   🗺️  CA coordinates: $coords->{lat}, $coords->{lon}\n";
    }

    print "\n🎉 All tests completed!\n";
    print "\n📋 Integration Instructions:\n";
    print "1. Update API_BASE_URL and API_KEY in this script\n";
    print "2. Install required Perl modules: LWP::UserAgent, JSON, DBI, DBD::mysql\n";
    print "3. Place script in /usr/share/astguiclient/\n";
    print "4. Make executable: chmod +x vicidial-did-optimizer.pl\n";
    print "5. In VICIdial campaign settings, set Outbound CID to: COMPAT_DID_OPTIMIZER\n";
    print "6. Update your dialplan to call this script and report call results\n";
}

sub print_help {
    print << "EOF";
VICIdial DID Optimizer Integration Script

USAGE:
    $0 [OPTIONS] [CAMPAIGN_ID] [AGENT_ID] [PHONE_NUMBER] [STATE] [ZIP]

OPTIONS:
    --test              Run integration tests
    --campaign=ID       Campaign ID
    --agent=ID          Agent ID
    --phone=NUMBER      Customer phone number
    --state=STATE       Customer state (2-letter code)
    --zip=ZIP           Customer ZIP code
    --help              Show this help message

EXAMPLES:
    # Test the integration
    $0 --test

    # Get DID for a specific call
    $0 CAMPAIGN001 1001 4155551234 CA 94102

    # Use with command line options
    $0 --campaign=TEST --agent=1001 --phone=4155551234 --state=CA

ENVIRONMENT VARIABLES:
    The script also reads from these environment variables:
    - campaign_id
    - agent_id
    - phone_number
    - state
    - zip_code

For VICIdial integration, set your campaign's "Outbound Cid" to:
COMPAT_DID_OPTIMIZER

This will automatically call this script for each outbound call.

EOF
}

##############################################################################
# Call Result Reporting Function (to be called from dialplan)
##############################################################################

# This is a separate entry point for reporting call results
# Call this from your Asterisk dialplan after call completion:
#
# exten => h,1,System(/usr/share/astguiclient/vicidial-did-optimizer.pl --report \${campaign_id} \${phone_number} \${DIALSTATUS} \${ANSWEREDTIME} \${disposition})

if ($ARGV[0] && $ARGV[0] eq '--report') {
    my ($campaign_id, $phone_number, $result, $duration, $disposition) = @ARGV[1..5];

    # Map Asterisk DIALSTATUS to our result format
    my %status_map = (
        'ANSWER' => 'answered',
        'NOANSWER' => 'no-answer',
        'BUSY' => 'busy',
        'FAILED' => 'failed',
        'CANCEL' => 'dropped',
        'CONGESTION' => 'failed'
    );

    my $mapped_result = $status_map{$result} || 'failed';

    report_call_result($phone_number, $campaign_id, $mapped_result, $duration, $disposition);
    exit 0;
}

1;