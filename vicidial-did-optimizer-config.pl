#!/usr/bin/perl

##############################################################################
# VICIdial DID Optimizer Integration Script (Config File Version)
#
# This script integrates VICIdial with the DID Optimizer Pro API
# Configuration is read from /etc/asterisk/dids.conf
#
# Features:
# - Intelligent DID selection via API
# - Daily usage limit enforcement (server-side)
# - Geographic matching (server-side based on customer phone number)
# - Automatic failover and error handling
# - Centralized configuration management
#
# Installation:
# 1. Place this script in /usr/share/astguiclient/
# 2. Create configuration file: /etc/asterisk/dids.conf
# 3. Set proper permissions: chown asterisk:asterisk /etc/asterisk/dids.conf
# 4. Set secure permissions: chmod 600 /etc/asterisk/dids.conf
# 5. Make executable: chmod +x vicidial-did-optimizer.pl
# 6. Test with: perl vicidial-did-optimizer.pl --test
#
# Usage in VICIdial:
# In your campaign settings, set the "Outbound Cid" to:
# COMPAT_DID_OPTIMIZER
##############################################################################

use strict;
use warnings;
use LWP::UserAgent;
use JSON;
use Getopt::Long;
use Time::HiRes qw(time);
use Data::Dumper;
use File::Basename;

##############################################################################
# CONFIGURATION FILE LOCATION
##############################################################################

my $CONFIG_FILE = '/etc/asterisk/dids.conf';

##############################################################################
# GLOBAL VARIABLES
##############################################################################

my %config;
my $ua;
my $json = JSON->new->utf8;

# Command line options
my $test_mode = 0;
my $campaign_id = '';
my $agent_id = '';
my $phone_number = '';
my $help = 0;
my $show_config = 0;

##############################################################################
# MAIN EXECUTION
##############################################################################

GetOptions(
    'test' => \$test_mode,
    'config' => \$show_config,
    'campaign=s' => \$campaign_id,
    'agent=s' => \$agent_id,
    'phone=s' => \$phone_number,
    'help' => \$help
);

if ($help) {
    print_help();
    exit 0;
}

# Load configuration
load_configuration();

# Initialize HTTP client
$ua = LWP::UserAgent->new(timeout => $config{api_timeout});

if ($show_config) {
    show_configuration();
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

log_message("INFO", "Starting DID selection for campaign=$campaign_id, agent=$agent_id, phone=$phone_number");

# Get optimal DID from API (server handles all geographic matching based on phone number)
my $selected_did = get_optimal_did($campaign_id, $agent_id, $phone_number);

if ($selected_did) {
    # Handle both API formats: current (number) and legacy (phoneNumber)
    my $phone = $selected_did->{number} || $selected_did->{phoneNumber};
    my $algorithm = $selected_did->{algorithm} || 'round-robin';

    log_message("INFO", "Selected DID: $phone (algorithm: $algorithm)");

    # Output the selected DID for VICIdial
    print $phone . "\n";

    # Log selection details for analytics
    log_selection_details($selected_did, $campaign_id, $agent_id);
} else {
    log_message("ERROR", "Failed to get DID from API, using fallback: $config{fallback_did}");
    print $config{fallback_did} . "\n";
}

exit 0;

##############################################################################
# CONFIGURATION MANAGEMENT
##############################################################################

sub load_configuration {
    log_message("DEBUG", "Loading configuration from $CONFIG_FILE");

    # Set default values
    %config = (
        api_base_url => 'http://localhost:3001',
        api_key => '',
        api_timeout => 10,
        max_retries => 3,
        fallback_did => '+18005551234',
        log_file => '/var/log/astguiclient/did_optimizer.log',
        debug => 1,
        db_host => 'localhost',
        db_user => 'cron',
        db_pass => '1234',
        db_name => 'asterisk',
        context_cache_dir => '/tmp/did_optimizer',
        context_cache_ttl => 3600,
        notification_email => '',
        alert_on_api_failure => 1,
        verify_ssl => 1,
        connection_timeout => 30,
        read_timeout => 60
    );

    # Read configuration file
    if (!-f $CONFIG_FILE) {
        log_message("WARN", "Configuration file $CONFIG_FILE not found, using defaults");
        return;
    }

    if (!-r $CONFIG_FILE) {
        log_message("ERROR", "Configuration file $CONFIG_FILE is not readable");
        return;
    }

    open my $fh, '<', $CONFIG_FILE or do {
        log_message("ERROR", "Cannot open configuration file $CONFIG_FILE: $!");
        return;
    };

    my $current_section = 'general';

    while (my $line = <$fh>) {
        chomp $line;
        $line =~ s/^\s+|\s+$//g;  # Trim whitespace

        # Skip comments and empty lines
        next if $line =~ /^#/ || $line eq '';

        # Section headers
        if ($line =~ /^\[(.+)\]$/) {
            $current_section = $1;
            next;
        }

        # Key-value pairs
        if ($line =~ /^(\w+)\s*=\s*(.*)$/) {
            my ($key, $value) = ($1, $2);
            $value =~ s/^\s+|\s+$//g;  # Trim value

            # Convert boolean-like values
            if ($value =~ /^(1|true|yes|on)$/i) {
                $value = 1;
            } elsif ($value =~ /^(0|false|no|off)$/i) {
                $value = 0;
            }

            $config{$key} = $value;
            log_message("DEBUG", "Config: $key = $value");
        }
    }

    close $fh;

    # Validate required configuration
    if (!$config{api_key}) {
        log_message("ERROR", "API key not configured in $CONFIG_FILE");
        exit 1;
    }

    # Create cache directory if it doesn't exist
    if (!-d $config{context_cache_dir}) {
        mkdir $config{context_cache_dir}, 0755 or log_message("WARN", "Cannot create cache directory: $!");
    }

    log_message("INFO", "Configuration loaded successfully from $CONFIG_FILE");
}

sub show_configuration {
    print "DID Optimizer Configuration\n";
    print "===========================\n\n";

    print "Configuration file: $CONFIG_FILE\n";
    print "File exists: " . (-f $CONFIG_FILE ? "Yes" : "No") . "\n";
    print "File readable: " . (-r $CONFIG_FILE ? "Yes" : "No") . "\n\n";

    print "Current Settings:\n";
    print "-" x 50 . "\n";

    foreach my $key (sort keys %config) {
        my $value = $config{$key};

        # Mask sensitive information
        if ($key =~ /password|pass|key|secret/i) {
            $value = '*' x length($value) if $value;
        }

        printf "%-25s: %s\n", $key, $value;
    }

    print "\nTo modify settings, edit: $CONFIG_FILE\n";
}

##############################################################################
# SUBROUTINES (Updated to use config)
##############################################################################

sub get_optimal_did {
    my ($campaign_id, $agent_id, $phone_number) = @_;

    # Build API request parameters - server handles all geographic matching
    my %params = (
        'campaign_id' => $campaign_id || 'UNKNOWN',
        'agent_id' => $agent_id || 'UNKNOWN'
    );

    # Add customer phone number - server uses this for geographic matching
    if ($phone_number) {
        $params{customer_phone} = $phone_number;
        log_message("DEBUG", "Customer phone: $phone_number");
    }

    # Build query string
    my $query_string = join('&', map { "$_=" . uri_escape($params{$_}) } keys %params);
    my $url = "$config{api_base_url}/api/v1/dids/next?$query_string";

    log_message("DEBUG", "API Request URL: $url");

    # Make API request with retries
    for my $attempt (1..$config{max_retries}) {
        log_message("DEBUG", "API attempt $attempt of $config{max_retries}");

        my $request = HTTP::Request->new(GET => $url);
        $request->header('x-api-key' => $config{api_key});
        $request->header('Content-Type' => 'application/json');

        my $response = $ua->request($request);

        if ($response->is_success) {
            my $data = eval { $json->decode($response->content) };

            if ($@ || !$data->{success}) {
                log_message("ERROR", "API response parse error: " . ($@ || $data->{message} || 'Unknown error'));
                next;  # Try again
            }

            log_message("DEBUG", "API Response: " . $response->content);

            # Check which format the API returned
            my $did_obj = undef;
            if ($data->{did}) {
                # Current format: {"success": true, "did": {"number": "+1...", ...}}
                $did_obj = $data->{did};
                log_message("DEBUG", "Using current API format (did.number)");
            } elsif ($data->{data}) {
                # Legacy format: {"success": true, "data": {"phoneNumber": "+1...", ...}}
                $did_obj = $data->{data};
                log_message("DEBUG", "Using legacy API format (data.phoneNumber)");
            } else {
                log_message("ERROR", "API response missing both 'did' and 'data' fields");
                next;
            }

            # Store API response data for call result reporting
            store_call_context($did_obj, $phone_number);

            return $did_obj;
        } else {
            log_message("ERROR", "API request failed (attempt $attempt): " . $response->status_line);

            # Send alert on API failure if configured
            if ($config{alert_on_api_failure} && $attempt == $config{max_retries}) {
                send_alert("API Failure", "DID Optimizer API failed after $config{max_retries} attempts");
            }

            if ($attempt == $config{max_retries}) {
                log_message("ERROR", "All API attempts failed, using fallback DID");
                return undef;
            }
            sleep(1);  # Brief delay before retry
        }
    }

    return undef;
}

sub store_call_context {
    my ($did_data, $phone_number) = @_;

    # Store call context for later call result reporting
    my $context = {
        did_id => $did_data->{didId} || $did_data->{id},
        phone_number => $did_data->{number} || $did_data->{phoneNumber},
        campaign_id => $did_data->{campaign_id},
        agent_id => $did_data->{agent_id},
        selected_at => $did_data->{selectedAt},
        algorithm => $did_data->{algorithm},
        customer_phone => $phone_number,
        api_metadata => $did_data->{metadata}
    };

    # Store in cache directory from config
    my $context_file = "$config{context_cache_dir}/did_context_" . $did_data->{campaign_id} . "_" . $phone_number . ".json";

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

    # Load call context from cache
    my $context_file = "$config{context_cache_dir}/did_context_" . $campaign_id . "_" . $phone_number . ".json";
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

    # Prepare API request
    my $payload = {
        phoneNumber => $context->{phone_number} || $config{fallback_did},
        campaign_id => $campaign_id,
        agent_id => $context->{agent_id} || 'UNKNOWN',
        customer_phone => $phone_number,
        result => $result,
        duration => $duration || 0,
        disposition => $disposition || ''
    };

    my $url = "$config{api_base_url}/api/v1/vicidial/call-result";

    log_message("INFO", "Reporting call result: $result for $phone_number");

    my $request = HTTP::Request->new(POST => $url);
    $request->header('x-api-key' => $config{api_key});
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

sub send_alert {
    my ($subject, $message) = @_;

    return unless $config{notification_email};

    # Simple email alert (you can enhance this with proper email sending)
    log_message("ALERT", "$subject: $message");

    # You could add actual email sending here using Email::Simple or similar
}

sub log_message {
    my ($level, $message) = @_;

    return unless $config{debug} || $level ne 'DEBUG';

    my $timestamp = sprintf("%04d-%02d-%02d %02d:%02d:%02d",
        (localtime)[5]+1900, (localtime)[4]+1, (localtime)[3],
        (localtime)[2], (localtime)[1], (localtime)[0]);

    my $log_entry = "[$timestamp] [$level] $message\n";

    my $log_file = $config{log_file} || '/var/log/astguiclient/did_optimizer.log';

    if (open my $fh, '>>', $log_file) {
        print $fh $log_entry;
        close $fh;
    }

    print STDERR $log_entry if $config{debug};
}

sub uri_escape {
    my ($str) = @_;
    $str =~ s/([^A-Za-z0-9\-_.~])/sprintf("%%%02X", ord($1))/eg;
    return $str;
}

sub run_tests {
    print "🧪 Running DID Optimizer Integration Tests (Config Version)...\n\n";

    # Test 1: Configuration Loading
    print "1. Testing Configuration Loading...\n";
    if (%config && $config{api_key}) {
        print "   ✅ Configuration: LOADED\n";
        print "   📊 API Base URL: $config{api_base_url}\n";
        print "   🔑 API Key: " . substr($config{api_key}, 0, 20) . "...\n";
    } else {
        print "   ❌ Configuration: FAILED\n";
        return;
    }

    # Test 2: API Health Check
    print "\n2. Testing API Health Check...\n";
    my $health_url = "$config{api_base_url}/api/v1/health";
    my $request = HTTP::Request->new(GET => $health_url);
    $request->header('x-api-key' => $config{api_key});

    my $response = $ua->request($request);
    if ($response->is_success) {
        print "   ✅ API Health Check: PASSED\n";
        my $data = eval { $json->decode($response->content) };
        if ($data && $data->{status}) {
            print "   📊 Status: $data->{status}\n";
            print "   🔄 Database: $data->{database}\n";
        }
    } else {
        print "   ❌ API Health Check: FAILED - " . $response->status_line . "\n";
        return;
    }

    # Test 3: DID Selection
    print "\n3. Testing DID Selection...\n";
    my $test_did = get_optimal_did('TEST_CAMPAIGN', 'TEST_AGENT', '4155551234');
    if ($test_did) {
        print "   ✅ DID Selection: PASSED\n";
        my $phone = $test_did->{number} || $test_did->{phoneNumber};
        my $algorithm = $test_did->{algorithm} || 'round-robin';
        print "   📞 Selected: $phone\n";
        print "   🎯 Algorithm: $algorithm\n";
    } else {
        print "   ❌ DID Selection: FAILED\n";
        return;
    }

    # Test 4: Configuration File Security
    print "\n4. Testing Configuration File Security...\n";
    my @stat = stat($CONFIG_FILE);
    if (@stat) {
        my $mode = sprintf("%04o", $stat[2] & 07777);
        print "   📁 File permissions: $mode\n";
        if ($mode eq '0600' || $mode eq '0640') {
            print "   ✅ Security: GOOD (restrictive permissions)\n";
        } else {
            print "   ⚠️  Security: WARNING (consider chmod 600 $CONFIG_FILE)\n";
        }
    }

    print "\n🎉 All tests completed!\n";
    print "\n📋 Configuration File Management:\n";
    print "1. Edit configuration: vi $CONFIG_FILE\n";
    print "2. View current config: $0 --config\n";
    print "3. Test after changes: $0 --test\n";
    print "4. Secure the file: chown asterisk:asterisk $CONFIG_FILE && chmod 600 $CONFIG_FILE\n";
}

sub print_help {
    print << "EOF";
VICIdial DID Optimizer Integration Script (Configuration File Version)

CONFIGURATION:
    Configuration is read from: $CONFIG_FILE

    To view current configuration:
        $0 --config

USAGE:
    $0 [OPTIONS] [CAMPAIGN_ID] [AGENT_ID] [PHONE_NUMBER]

OPTIONS:
    --test              Run integration tests
    --config            Show current configuration
    --campaign=ID       Campaign ID
    --agent=ID          Agent ID
    --phone=NUMBER      Customer phone number
    --help              Show this help message

EXAMPLES:
    # Test the integration
    $0 --test

    # View configuration
    $0 --config

    # Get DID for a specific call (server handles geographic matching)
    $0 CAMPAIGN001 1001 4155551234

CONFIGURATION FILE SETUP:
    1. Copy sample config: cp dids.conf $CONFIG_FILE
    2. Edit settings: vi $CONFIG_FILE
    3. Set secure permissions: chown asterisk:asterisk $CONFIG_FILE
    4. Restrict access: chmod 600 $CONFIG_FILE
    5. Test configuration: $0 --test

For VICIdial integration, set your campaign's "Outbound Cid" to:
COMPAT_DID_OPTIMIZER

EOF
}

# Call result reporting (same as before, but uses config)
if ($ARGV[0] && $ARGV[0] eq '--report') {
    my ($campaign_id, $phone_number, $result, $duration, $disposition) = @ARGV[1..5];

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