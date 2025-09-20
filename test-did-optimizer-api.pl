#!/usr/bin/perl

##############################################################################
# VICIdial DID Optimizer - FULL DEBUG API Test Script v2.0
#
# This script automatically reads configuration from:
# - /etc/asterisk/dids.conf (DID Optimizer settings)
# - /etc/astguiclient.conf (VICIdial database settings)
#
# Tests with FULL DEBUG TRACING:
# - Configuration loading with detailed file parsing
# - Database connectivity with VICIdial table verification
# - API connectivity with full HTTP headers and response analysis
# - DID selection functionality with rotation testing
# - Error handling and fallbacks with network diagnostics
# - Connection diagnostics and troubleshooting
#
# Usage:
#   sudo -u asterisk ./test-did-optimizer-api.pl
#   ./test-did-optimizer-api.pl --verbose    # Extra verbose output
#   ./test-did-optimizer-api.pl --config-only  # Only test config loading
#   ./test-did-optimizer-api.pl --debug      # MAXIMUM debug output
#   ./test-did-optimizer-api.pl --trace      # HTTP request/response tracing
##############################################################################

use strict;
use warnings;
use LWP::UserAgent;
use JSON;
use DBI;
use Getopt::Long;
use Data::Dumper;
use Time::HiRes qw(time);
use Socket;
use IO::Socket::INET;

# Command line options
my $verbose = 0;
my $config_only = 0;
my $help = 0;
my $debug = 0;
my $trace = 0;

GetOptions(
    'verbose' => \$verbose,
    'config-only' => \$config_only,
    'help' => \$help,
    'debug' => \$debug,
    'trace' => \$trace
);

# Enable verbose mode for debug and trace
$verbose = 1 if $debug || $trace;

if ($help) {
    print_help();
    exit 0;
}

# Configuration storage
my %config;
my %vicidial_config;

# Global debug function
sub debug_print {
    my ($level, $message) = @_;
    my $timestamp = sprintf "%.3f", time();

    if ($level eq 'INFO' || $verbose) {
        print "[$timestamp] $message\n";
    } elsif ($level eq 'DEBUG' && $debug) {
        print "[$timestamp] [DEBUG] $message\n";
    } elsif ($level eq 'TRACE' && $trace) {
        print "[$timestamp] [TRACE] $message\n";
    }
}

# Enhanced network diagnostics
sub test_network_connectivity {
    my ($host, $port) = @_;

    debug_print('DEBUG', "Testing network connectivity to $host:$port");

    my $socket = IO::Socket::INET->new(
        PeerAddr => $host,
        PeerPort => $port,
        Proto    => 'tcp',
        Timeout  => 5
    );

    if ($socket) {
        debug_print('DEBUG', "✅ TCP connection to $host:$port successful");
        close($socket);
        return 1;
    } else {
        debug_print('DEBUG', "❌ TCP connection to $host:$port failed: $!");
        return 0;
    }
}

# Enhanced HTTP request tracing
sub trace_http_request {
    my ($request, $response) = @_;

    if ($trace) {
        debug_print('TRACE', "=== HTTP REQUEST ===");
        debug_print('TRACE', $request->method . " " . $request->uri);
        debug_print('TRACE', "Headers:");
        for my $header ($request->header_field_names) {
            my $value = $header eq 'x-api-key' ? substr($request->header($header), 0, 8) . "..." : $request->header($header);
            debug_print('TRACE', "  $header: $value");
        }
        debug_print('TRACE', "");

        debug_print('TRACE', "=== HTTP RESPONSE ===");
        debug_print('TRACE', "Status: " . $response->code . " " . $response->message);
        debug_print('TRACE', "Headers:");
        for my $header ($response->header_field_names) {
            debug_print('TRACE', "  $header: " . $response->header($header));
        }
        debug_print('TRACE', "Body: " . $response->content);
        debug_print('TRACE', "");
    }
}

print "🚀 VICIdial DID Optimizer - FULL DEBUG API Test Script v2.0\n";
print "=" x 60 . "\n";
print "Debug Level: " . ($debug ? "MAXIMUM" : $trace ? "TRACE" : $verbose ? "VERBOSE" : "NORMAL") . "\n";
print "=" x 60 . "\n\n";

# Step 1: Load configurations
print "📋 Step 1: Loading configuration files...\n";
load_did_optimizer_config();
load_vicidial_config();
merge_configurations();
print_configuration() if $verbose || $config_only;

if ($config_only) {
    print "\n✅ Configuration loading test complete.\n";
    exit 0;
}

# Step 2: Test database connectivity
print "\n🗄️  Step 2: Testing database connectivity...\n";
test_database_connection();

# Step 3: Test API connectivity
print "\n🌐 Step 3: Testing API connectivity...\n";
test_api_health();

# Step 4: Test DID selection
print "\n🎯 Step 4: Testing DID selection...\n";
test_did_selection();

# Step 5: Test error handling
print "\n⚠️  Step 5: Testing error handling...\n";
test_error_handling();

print "\n🎉 All tests completed!\n";

##############################################################################
# Configuration Loading Functions
##############################################################################

sub load_did_optimizer_config {
    my $config_file = '/etc/asterisk/dids.conf';

    print "  📁 Loading DID Optimizer config: $config_file\n";

    if (! -f $config_file) {
        print "  ❌ Config file not found: $config_file\n";
        return;
    }

    if (! -r $config_file) {
        print "  ❌ Config file not readable: $config_file\n";
        print "     Try: sudo -u asterisk $0\n";
        return;
    }

    open my $fh, '<', $config_file or do {
        print "  ❌ Cannot read config file: $config_file ($!)\n";
        return;
    };

    my $section = '';
    while (my $line = <$fh>) {
        chomp $line;
        next if $line =~ /^\s*[#;]/ || $line =~ /^\s*$/;

        if ($line =~ /^\s*\[([^\]]+)\]/) {
            $section = $1;
            next;
        }

        if ($line =~ /^\s*(\w+)\s*=\s*(.*)$/) {
            my ($key, $value) = ($1, $2);
            $value =~ s/^\s+|\s+$//g;  # Trim whitespace
            $config{$key} = $value;
            print "    $key = $value\n" if $verbose;
        }
    }
    close $fh;

    print "  ✅ Loaded " . scalar(keys %config) . " settings from DID Optimizer config\n";
}

sub load_vicidial_config {
    my $vicidial_conf = '/etc/astguiclient.conf';

    print "  📁 Loading VICIdial config: $vicidial_conf\n";

    if (! -f $vicidial_conf) {
        print "  ⚠️  VICIdial config not found: $vicidial_conf\n";
        print "     Using default database settings\n";
        return;
    }

    open my $fh, '<', $vicidial_conf or do {
        print "  ❌ Cannot read VICIdial config: $vicidial_conf ($!)\n";
        return;
    };

    while (my $line = <$fh>) {
        chomp $line;
        next if $line =~ /^#/ || $line =~ /^\s*$/;

        # Parse VICIdial config format
        if ($line =~ /^VARDB_server\s*=>\s*(.*)$/) {
            $vicidial_config{db_host} = $1;
        } elsif ($line =~ /^VARDB_database\s*=>\s*(.*)$/) {
            $vicidial_config{db_name} = $1;
        } elsif ($line =~ /^VARDB_user\s*=>\s*(.*)$/) {
            $vicidial_config{db_user} = $1;
        } elsif ($line =~ /^VARDB_pass\s*=>\s*(.*)$/) {
            $vicidial_config{db_pass} = $1;
        } elsif ($line =~ /^VARDB_port\s*=>\s*(.*)$/) {
            $vicidial_config{db_port} = $1;
        }
    }
    close $fh;

    if (%vicidial_config) {
        print "  ✅ Loaded VICIdial database settings\n";
        if ($verbose) {
            for my $key (sort keys %vicidial_config) {
                my $value = $key eq 'db_pass' ? '*****' : $vicidial_config{$key};
                print "    $key = $value\n";
            }
        }
    } else {
        print "  ⚠️  No VICIdial database settings found\n";
    }
}

sub merge_configurations {
    # Set defaults
    my %defaults = (
        api_base_url => 'http://localhost:3000',
        api_timeout => 10,
        max_retries => 3,
        fallback_did => '+18005551234',
        db_host => 'localhost',
        db_name => 'asterisk',
        db_user => 'cron',
        db_pass => '1234',
        db_port => '3306',
        daily_usage_limit => 200,
        max_distance_miles => 500
    );

    # Apply defaults
    for my $key (keys %defaults) {
        $config{$key} //= $defaults{$key};
    }

    # Override with VICIdial settings (higher priority)
    for my $key (keys %vicidial_config) {
        $config{$key} = $vicidial_config{$key} if $vicidial_config{$key};
    }

    print "  ✅ Configuration merged successfully\n";
}

sub print_configuration {
    print "\n📋 Current Configuration:\n";
    print "-" x 30 . "\n";

    print "API Settings:\n";
    print "  api_base_url: $config{api_base_url}\n";
    print "  api_key: " . (defined $config{api_key} && $config{api_key} ne 'YOUR_API_KEY_HERE' ?
                          substr($config{api_key}, 0, 8) . "..." : "❌ NOT SET") . "\n";
    print "  api_timeout: $config{api_timeout}\n";
    print "  fallback_did: $config{fallback_did}\n";

    print "\nDatabase Settings:\n";
    print "  db_host: $config{db_host}\n";
    print "  db_name: $config{db_name}\n";
    print "  db_user: $config{db_user}\n";
    print "  db_pass: " . ('*' x length($config{db_pass})) . "\n";
    print "  db_port: $config{db_port}\n";

    print "\nOptimization Settings:\n";
    print "  daily_usage_limit: $config{daily_usage_limit}\n";
    print "  max_distance_miles: $config{max_distance_miles}\n";
    print "\n";
}

##############################################################################
# Test Functions
##############################################################################

sub test_database_connection {
    print "  🔌 Testing database connection...\n";

    my $dsn = "DBI:mysql:database=$config{db_name};host=$config{db_host}";
    $dsn .= ";port=$config{db_port}" if $config{db_port} && $config{db_port} ne '3306';

    print "    Connection string: $dsn (user: $config{db_user})\n" if $verbose;

    my $dbh = DBI->connect($dsn, $config{db_user}, $config{db_pass}, {
        RaiseError => 0,
        PrintError => 0
    });

    if ($dbh) {
        print "  ✅ Database connection successful\n";

        # Test VICIdial tables
        test_vicidial_tables($dbh);

        $dbh->disconnect();
    } else {
        print "  ❌ Database connection failed: " . DBI->errstr . "\n";
        print "    Check your VICIdial database settings\n";
    }
}

sub test_vicidial_tables {
    my $dbh = shift;

    print "  📊 Testing VICIdial table access...\n" if $verbose;

    # Test vicidial_list table
    my $sql = "SELECT COUNT(*) FROM vicidial_list LIMIT 1";
    my $sth = $dbh->prepare($sql);

    if ($sth && $sth->execute()) {
        my ($count) = $sth->fetchrow_array();
        print "    ✅ vicidial_list table accessible ($count records)\n";
        $sth->finish();
    } else {
        print "    ❌ Cannot access vicidial_list table\n";
        return;
    }

    # Test sample customer lookup
    $sql = "SELECT phone_number, state, postal_code FROM vicidial_list WHERE state IS NOT NULL AND postal_code IS NOT NULL LIMIT 5";
    $sth = $dbh->prepare($sql);

    if ($sth && $sth->execute()) {
        print "    📞 Sample customer data:\n" if $verbose;
        while (my ($phone, $state, $zip) = $sth->fetchrow_array()) {
            print "       $phone -> $state, $zip\n" if $verbose;
        }
        $sth->finish();
    }
}

sub test_api_health {
    print "  🏥 Testing API health endpoint...\n";

    unless ($config{api_key} && $config{api_key} ne 'YOUR_API_KEY_HERE') {
        print "  ❌ API key not configured in /etc/asterisk/dids.conf\n";
        print "     Please set: api_key=your_actual_api_key\n";
        return;
    }

    debug_print('DEBUG', "API Key: " . substr($config{api_key}, 0, 8) . "...");

    # First test network connectivity
    my ($protocol, $host, $port, $path) = $config{api_base_url} =~ m{^(https?)://([^:/]+)(?::(\d+))?(.*)$};
    $port ||= ($protocol eq 'https' ? 443 : 80);
    $path ||= '';

    debug_print('DEBUG', "Parsed URL: protocol=$protocol, host=$host, port=$port, path=$path");

    if ($debug) {
        test_network_connectivity($host, $port);
    }

    my $ua = LWP::UserAgent->new(
        timeout => $config{api_timeout},
        agent => 'VICIdial-DID-Optimizer-Test/2.0'
    );

    # Enable debugging for LWP if trace mode
    if ($trace) {
        $ua->add_handler("request_send",  sub { debug_print('TRACE', "Sending request..."); return });
        $ua->add_handler("response_done", sub { debug_print('TRACE', "Response received."); return });
    }

    my $health_url = "$config{api_base_url}/api/health";
    print "    Testing: $health_url\n";
    debug_print('DEBUG', "Full URL: $health_url");

    my $request = HTTP::Request->new(GET => $health_url);
    $request->header('x-api-key' => $config{api_key});
    $request->header('Content-Type' => 'application/json');
    $request->header('User-Agent' => 'VICIdial-DID-Optimizer-Test/2.0');

    debug_print('DEBUG', "Request headers prepared");

    my $start_time = time();
    my $response = $ua->request($request);
    my $duration = time() - $start_time;

    debug_print('DEBUG', sprintf("Request completed in %.3f seconds", $duration));

    if ($trace) {
        trace_http_request($request, $response);
    }

    if ($response->is_success) {
        print "  ✅ API health check successful\n";

        if ($verbose) {
            print "    Status: " . $response->code . "\n";
            print "    Response: " . $response->content . "\n";
        }

        # Try to parse JSON response
        my $data = eval { decode_json($response->content) };
        if ($data && ref($data) eq 'HASH') {
            print "    API Status: " . ($data->{status} // 'unknown') . "\n";
            print "    Server Time: " . ($data->{timestamp} // 'unknown') . "\n" if $verbose;
        }
    } else {
        print "  ❌ API health check failed\n";
        print "    Status: " . $response->code . " " . $response->message . "\n";
        print "    Response: " . $response->content . "\n" if $verbose;

        if ($response->code == 401) {
            print "    🔑 Check your API key configuration\n";
        } elsif ($response->code == 404) {
            print "    🔍 Check your API base URL: $config{api_base_url}\n";
        }
    }
}

sub test_did_selection {
    print "  🎯 Testing DID selection endpoint...\n";

    unless ($config{api_key} && $config{api_key} ne 'YOUR_API_KEY_HERE') {
        print "  ❌ Skipping - API key not configured\n";
        return;
    }

    # Enhanced test cases with more debugging scenarios
    my @test_cases = (
        {
            name => "Basic DID request",
            campaign_id => "TEST001",
            agent_id => "1001",
            customer_phone => "4155551234",
            customer_state => "CA",
            customer_zip => "94102"
        },
        {
            name => "Rotation test #1",
            campaign_id => "TEST002",
            agent_id => "1002",
            customer_phone => "2125551234",
            customer_state => "NY",
            customer_zip => "10001"
        },
        {
            name => "Rotation test #2",
            campaign_id => "TEST003",
            agent_id => "1003",
            customer_phone => "3125551234",
            customer_state => "IL",
            customer_zip => "60601"
        },
        {
            name => "Rotation test #3",
            campaign_id => "TEST004",
            agent_id => "1004",
            customer_phone => "7135551234",
            customer_state => "TX",
            customer_zip => "77001"
        },
        {
            name => "No location data",
            campaign_id => "TEST005",
            agent_id => "1005",
            customer_phone => "5555551234",
            customer_state => "",
            customer_zip => ""
        }
    );

    my $ua = LWP::UserAgent->new(
        timeout => $config{api_timeout},
        agent => 'VICIdial-DID-Optimizer-Test/2.0'
    );

    # Test multiple rounds to verify rotation
    my $total_tests = scalar(@test_cases);
    my $rotation_rounds = $debug ? 3 : 1;  # Test rotation in debug mode

    debug_print('DEBUG', "Running $rotation_rounds rotation rounds with $total_tests test cases each");

    my %did_usage = ();
    my $test_count = 0;

    for my $round (1..$rotation_rounds) {
        print "    Round $round:\n" if $rotation_rounds > 1;

        for my $test (@test_cases) {
            $test_count++;
            print "    Test $test_count: $test->{name}\n";

            my $url = "$config{api_base_url}/api/v1/dids/next";
            my @params = (
                "campaign_id=$test->{campaign_id}",
                "agent_id=$test->{agent_id}",
                "customer_phone=$test->{customer_phone}",
                "customer_state=$test->{customer_state}",
                "customer_zip=$test->{customer_zip}"
            );
            $url .= '?' . join('&', @params);

            debug_print('DEBUG', "Request URL: $url");

            my $request = HTTP::Request->new(GET => $url);
            $request->header('x-api-key' => $config{api_key});
            $request->header('User-Agent' => 'VICIdial-DID-Optimizer-Test/2.0');

            debug_print('DEBUG', "Sending DID selection request...");

            my $start_time = time();
            my $response = $ua->request($request);
            my $duration = time() - $start_time;

            debug_print('DEBUG', sprintf("DID request completed in %.3f seconds", $duration));

            if ($trace) {
                trace_http_request($request, $response);
            }

            if ($response->is_success) {
                my $data = eval { decode_json($response->content) };

                if ($@) {
                    print "      ❌ JSON parsing error: $@\n";
                    debug_print('DEBUG', "Raw response: " . $response->content);
                    next;
                }

                if ($data && ref($data) eq 'HASH') {
                    debug_print('DEBUG', "Response structure: " . Dumper($data)) if $debug;

                    # Enhanced DID parsing with detailed debug information
                    my $success = $data->{success};
                    my $did_obj = $data->{did};
                    my $did_number = $did_obj ? $did_obj->{number} : undef;

                    debug_print('DEBUG', "Parsing check: success=$success, did_obj=" . ($did_obj ? "present" : "missing") . ", number=" . ($did_number || "missing"));

                    if ($success && $did_obj && $did_number) {
                        my $selected_did = $did_number;
                        $did_usage{$selected_did}++;

                        print "      ✅ Selected DID: $selected_did\n";
                        print "      Is fallback: " . ($did_obj->{is_fallback} ? 'yes' : 'no') . "\n";

                        if ($verbose || $debug) {
                            print "      Carrier: " . ($did_obj->{carrier} // 'unknown') . "\n";
                            # Handle location object properly
                            my $location = $did_obj->{location};
                            my $location_str = 'unknown';
                            if (ref($location) eq 'HASH') {
                                if (%$location) {
                                    $location_str = join(', ', map { "$_: $location->{$_}" } keys %$location);
                                } else {
                                    $location_str = 'not specified';
                                }
                            } elsif ($location) {
                                $location_str = $location;
                            }
                            print "      Location: $location_str\n";
                            print "      Description: " . ($did_obj->{description} // 'none') . "\n";
                        }

                        if ($data->{metadata}) {
                            print "      Campaign: " . ($data->{metadata}->{campaign_id} // 'unknown') . "\n" if $verbose;
                            print "      Agent: " . ($data->{metadata}->{agent_id} // 'unknown') . "\n" if $verbose;
                            print "      Timestamp: " . ($data->{metadata}->{timestamp} // 'unknown') . "\n" if $debug;
                        }

                        # Track usage for rotation analysis
                        debug_print('DEBUG', "DID usage count for $selected_did: " . $did_usage{$selected_did});

                    } elsif ($success && $did_obj) {
                        print "      ⚠️  API returned success but incomplete DID data\n";
                        print "      DID object missing number field\n";
                        debug_print('DEBUG', "DID object: " . Dumper($did_obj));
                    } elsif ($success) {
                        print "      ⚠️  API returned success but no DID object\n";
                        debug_print('DEBUG', "Full response: " . Dumper($data));
                    } else {
                        print "      ❌ API returned failure\n";
                        print "      Error: " . ($data->{message} || $data->{error} || 'unknown') . "\n" if $data->{message} || $data->{error};
                        debug_print('DEBUG', "Full response: " . Dumper($data));
                    }
                } else {
                    print "      ❌ Invalid response format (not a hash)\n";
                    debug_print('DEBUG', "Response type: " . ref($data));
                    debug_print('DEBUG', "Raw response: " . $response->content);
                }
            } else {
                print "      ❌ HTTP request failed: " . $response->code . " " . $response->message . "\n";
                if ($verbose || $debug) {
                    print "      Response body: " . $response->content . "\n";
                }

                # Provide troubleshooting hints
                if ($response->code == 401) {
                    debug_print('DEBUG', "Authentication failed - check API key");
                } elsif ($response->code == 404) {
                    debug_print('DEBUG', "Endpoint not found - check API URL and path");
                } elsif ($response->code == 500) {
                    debug_print('DEBUG', "Server error - check server logs");
                }
            }

            sleep(0.5);  # Small delay between requests
        }

        print "\n" if $rotation_rounds > 1 && $round < $rotation_rounds;
    }

    # Analyze rotation results if we tested multiple rounds
    if ($rotation_rounds > 1 && %did_usage) {
        print "\n  📊 DID Rotation Analysis:\n";
        my $unique_dids = scalar(keys %did_usage);
        print "    Unique DIDs returned: $unique_dids\n";
        print "    Total requests: $test_count\n";

        if ($debug) {
            print "    DID usage distribution:\n";
            for my $did (sort keys %did_usage) {
                print "      $did: $did_usage{$did} times\n";
            }
        }

        if ($unique_dids > 1) {
            print "    ✅ Rotation appears to be working (multiple DIDs returned)\n";
        } elsif ($unique_dids == 1) {
            print "    ⚠️  Only one DID returned across all tests\n";
        } else {
            print "    ❌ No DIDs returned\n";
        }
    }
}

sub test_error_handling {
    print "  🛡️  Testing error handling and fallbacks...\n";

    # Test 1: Invalid API key
    print "    Testing invalid API key...\n";
    test_with_invalid_api_key();

    # Test 2: Network timeout
    print "    Testing network timeout...\n";
    test_network_timeout();

    # Test 3: Invalid endpoint
    print "    Testing invalid endpoint...\n";
    test_invalid_endpoint();
}

sub test_with_invalid_api_key {
    my $ua = LWP::UserAgent->new(
        timeout => 5,
        agent => 'VICIdial-DID-Optimizer-Test/1.0'
    );

    my $url = "$config{api_base_url}/api/health";
    my $request = HTTP::Request->new(GET => $url);
    $request->header('x-api-key' => 'invalid_api_key_12345');

    my $response = $ua->request($request);

    if ($response->code == 401) {
        print "      ✅ Correctly rejected invalid API key\n";
    } else {
        print "      ⚠️  Unexpected response to invalid API key: " . $response->code . "\n";
    }
}

sub test_network_timeout {
    my $ua = LWP::UserAgent->new(
        timeout => 1,  # Very short timeout
        agent => 'VICIdial-DID-Optimizer-Test/1.0'
    );

    # Try to connect to a slow/non-existent endpoint
    my $url = "http://192.0.2.1:3001/api/health";  # RFC5737 test address
    my $request = HTTP::Request->new(GET => $url);
    $request->header('x-api-key' => $config{api_key} || 'test');

    my $response = $ua->request($request);

    if ($response->code == 500 || $response->message =~ /timeout/i) {
        print "      ✅ Timeout handling works correctly\n";
    } else {
        print "      ℹ️  Timeout test result: " . $response->code . " " . $response->message . "\n";
    }
}

sub test_invalid_endpoint {
    return unless $config{api_key} && $config{api_key} ne 'YOUR_API_KEY_HERE';

    my $ua = LWP::UserAgent->new(
        timeout => 5,
        agent => 'VICIdial-DID-Optimizer-Test/1.0'
    );

    my $url = "$config{api_base_url}/api/v1/nonexistent";
    my $request = HTTP::Request->new(GET => $url);
    $request->header('x-api-key' => $config{api_key});

    my $response = $ua->request($request);

    if ($response->code == 404) {
        print "      ✅ Correctly returned 404 for invalid endpoint\n";
    } else {
        print "      ℹ️  Invalid endpoint test result: " . $response->code . "\n";
    }
}

sub print_help {
    print "VICIdial DID Optimizer - FULL DEBUG API Test Script v2.0\n\n";
    print "Usage: $0 [options]\n\n";
    print "Options:\n";
    print "  --verbose     Show detailed output and additional information\n";
    print "  --debug       MAXIMUM debug output with network diagnostics and rotation analysis\n";
    print "  --trace       HTTP request/response tracing with full headers and bodies\n";
    print "  --config-only Only test configuration loading and exit\n";
    print "  --help        Show this help message\n\n";
    print "Debug Levels:\n";
    print "  Normal:   Basic test results and errors\n";
    print "  Verbose:  + API responses, timing, and extra details\n";
    print "  Debug:    + Network connectivity, rotation analysis, data structures\n";
    print "  Trace:    + Full HTTP headers, request/response bodies, timestamps\n\n";
    print "Examples:\n";
    print "  sudo -u asterisk $0                    # Basic test\n";
    print "  sudo -u asterisk $0 --verbose          # Detailed test\n";
    print "  sudo -u asterisk $0 --debug            # Maximum debugging\n";
    print "  sudo -u asterisk $0 --trace            # Full HTTP tracing\n";
    print "  $0 --config-only                       # Just check config files\n\n";
    print "Remote Testing:\n";
    print "  If testing from a remote server, make sure you have the latest version\n";
    print "  of this script with correct API endpoints (/api/health, /api/v1/dids/next)\n";
}

# Run as asterisk user reminder
unless ($config_only) {
    my $current_user = getpwuid($<);
    if ($current_user ne 'asterisk' && $< != 0) {
        print "\n⚠️  NOTE: For full testing, run as asterisk user:\n";
        print "   sudo -u asterisk $0\n\n";
    }
}