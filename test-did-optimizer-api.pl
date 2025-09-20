#!/usr/bin/perl

##############################################################################
# VICIdial DID Optimizer - Comprehensive API Test Script
#
# This script automatically reads configuration from:
# - /etc/asterisk/dids.conf (DID Optimizer settings)
# - /etc/astguiclient.conf (VICIdial database settings)
#
# Tests:
# - Configuration loading
# - Database connectivity
# - API connectivity and authentication
# - DID selection functionality
# - Error handling and fallbacks
#
# Usage:
#   sudo -u asterisk ./test-did-optimizer-api.pl
#   ./test-did-optimizer-api.pl --verbose
#   ./test-did-optimizer-api.pl --config-only
##############################################################################

use strict;
use warnings;
use LWP::UserAgent;
use JSON;
use DBI;
use Getopt::Long;

# Command line options
my $verbose = 0;
my $config_only = 0;
my $help = 0;

GetOptions(
    'verbose' => \$verbose,
    'config-only' => \$config_only,
    'help' => \$help
);

if ($help) {
    print_help();
    exit 0;
}

# Configuration storage
my %config;
my %vicidial_config;

print "🚀 VICIdial DID Optimizer - API Test Script\n";
print "=" x 50 . "\n\n";

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
        api_base_url => 'http://localhost:3001',
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

    my $ua = LWP::UserAgent->new(
        timeout => $config{api_timeout},
        agent => 'VICIdial-DID-Optimizer-Test/1.0'
    );

    my $health_url = "$config{api_base_url}/api/health";
    print "    Testing: $health_url\n" if $verbose;

    my $request = HTTP::Request->new(GET => $health_url);
    $request->header('x-api-key' => $config{api_key});
    $request->header('Content-Type' => 'application/json');

    my $response = $ua->request($request);

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

    # Test cases
    my @test_cases = (
        {
            name => "California customer",
            campaign_id => "TEST001",
            agent_id => "1001",
            customer_phone => "4155551234",
            customer_state => "CA",
            customer_zip => "94102"
        },
        {
            name => "New York customer",
            campaign_id => "TEST002",
            agent_id => "1002",
            customer_phone => "2125551234",
            customer_state => "NY",
            customer_zip => "10001"
        },
        {
            name => "No location data",
            campaign_id => "TEST003",
            agent_id => "1003",
            customer_phone => "5555551234",
            customer_state => "",
            customer_zip => ""
        }
    );

    my $ua = LWP::UserAgent->new(
        timeout => $config{api_timeout},
        agent => 'VICIdial-DID-Optimizer-Test/1.0'
    );

    for my $test (@test_cases) {
        print "    Testing: $test->{name}\n";

        my $url = "$config{api_base_url}/api/v1/dids/next";
        my @params = (
            "campaign_id=$test->{campaign_id}",
            "agent_id=$test->{agent_id}",
            "customer_phone=$test->{customer_phone}",
            "customer_state=$test->{customer_state}",
            "customer_zip=$test->{customer_zip}"
        );
        $url .= '?' . join('&', @params);

        print "      URL: $url\n" if $verbose;

        my $request = HTTP::Request->new(GET => $url);
        $request->header('x-api-key' => $config{api_key});

        my $response = $ua->request($request);

        if ($response->is_success) {
            my $data = eval { decode_json($response->content) };
            if ($data && $data->{did} && $data->{did}->{number}) {
                print "      ✅ Selected DID: $data->{did}->{number}\n";
                print "      Is fallback: " . ($data->{did}->{is_fallback} ? 'yes' : 'no') . "\n" if $verbose;
                print "      Campaign: " . ($data->{metadata}->{campaign_id} // 'unknown') . "\n" if $verbose && $data->{metadata};
            } else {
                print "      ⚠️  No DID returned in response\n";
                print "      Response: " . $response->content . "\n" if $verbose;
            }
        } else {
            print "      ❌ Request failed: " . $response->code . " " . $response->message . "\n";
            if ($verbose) {
                print "      Response: " . $response->content . "\n";
            }
        }

        sleep(1);  # Be nice to the API
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
    print "VICIdial DID Optimizer - API Test Script\n\n";
    print "Usage: $0 [options]\n\n";
    print "Options:\n";
    print "  --verbose     Show detailed output\n";
    print "  --config-only Only test configuration loading\n";
    print "  --help        Show this help message\n\n";
    print "Examples:\n";
    print "  sudo -u asterisk $0          # Basic test\n";
    print "  sudo -u asterisk $0 --verbose # Detailed test\n";
    print "  $0 --config-only             # Just check config\n";
}

# Run as asterisk user reminder
unless ($config_only) {
    my $current_user = getpwuid($<);
    if ($current_user ne 'asterisk' && $< != 0) {
        print "\n⚠️  NOTE: For full testing, run as asterisk user:\n";
        print "   sudo -u asterisk $0\n\n";
    }
}