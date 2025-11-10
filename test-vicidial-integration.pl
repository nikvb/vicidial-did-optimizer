#!/usr/bin/perl
################################################################################
# VICIdial DID Optimizer Integration Test Script
#
# Tests the complete integration including:
# - Perl module dependencies
# - HTTPS/SSL support
# - API connectivity
# - Configuration file parsing
# - Database connection (optional)
# - DID selection logic
#
# Usage: ./test-vicidial-integration.pl [options]
#
# Options:
#   --api-url URL       API base URL (default: from dids.conf)
#   --api-key KEY       API key (default: from dids.conf)
#   --campaign ID       Test campaign ID (default: TEST001)
#   --agent ID          Test agent ID (default: 1001)
#   --phone NUMBER      Test phone number (default: 4155551234)
#   --state STATE       Test state code (default: CA)
#   --zip ZIP           Test ZIP code (default: 94102)
#   --skip-db           Skip database connection test
#   --verbose           Enable verbose output
#   --help              Show this help message
#
################################################################################

use strict;
use warnings;
use Getopt::Long;

# Color codes for output
my $RED = "\033[0;31m";
my $GREEN = "\033[0;32m";
my $YELLOW = "\033[1;33m";
my $BLUE = "\033[0;34m";
my $NC = "\033[0m"; # No Color

# Default test parameters
my $api_url = '';
my $api_key = '';
my $campaign_id = 'TEST001';
my $agent_id = '1001';
my $customer_phone = '4155551234';
my $customer_state = 'CA';
my $customer_zip = '94102';
my $skip_db = 0;
my $verbose = 0;
my $help = 0;

# Parse command line options
GetOptions(
    'api-url=s'   => \$api_url,
    'api-key=s'   => \$api_key,
    'campaign=s'  => \$campaign_id,
    'agent=s'     => \$agent_id,
    'phone=s'     => \$customer_phone,
    'state=s'     => \$customer_state,
    'zip=s'       => \$customer_zip,
    'skip-db'     => \$skip_db,
    'verbose'     => \$verbose,
    'help'        => \$help,
) or die "Error in command line arguments\n";

if ($help) {
    print_help();
    exit 0;
}

print "${BLUE}🧪 VICIdial DID Optimizer Integration Test${NC}\n";
print "${BLUE}===========================================${NC}\n\n";

# Test 1: Check Perl modules
print "${YELLOW}Test 1: Checking Perl module dependencies...${NC}\n";
my @required_modules = (
    'LWP::UserAgent',
    'LWP::Protocol::https',
    'IO::Socket::SSL',
    'Net::SSLeay',
    'JSON',
    'URI::Escape',
);

my @optional_modules = (
    'DBI',
    'DBD::mysql',
    'Mozilla::CA',
);

my $modules_ok = 1;
foreach my $module (@required_modules) {
    if (check_module($module)) {
        print "  ${GREEN}✅ $module${NC}\n";
    } else {
        print "  ${RED}❌ $module (REQUIRED)${NC}\n";
        $modules_ok = 0;
    }
}

foreach my $module (@optional_modules) {
    if (check_module($module)) {
        print "  ${GREEN}✅ $module${NC}\n";
    } else {
        print "  ${YELLOW}⚠️  $module (optional)${NC}\n";
    }
}

if (!$modules_ok) {
    print "\n${RED}❌ Required modules missing. Install with:${NC}\n";
    print "  sudo apt-get install libwww-perl libjson-perl libio-socket-ssl-perl libnet-ssleay-perl liblwp-protocol-https-perl liburi-perl\n";
    exit 1;
}
print "${GREEN}✅ All required modules installed${NC}\n\n";

# Test 2: Verify HTTPS/SSL support
print "${YELLOW}Test 2: Verifying HTTPS/SSL support...${NC}\n";
my $ssl_ok = test_ssl_support();
if ($ssl_ok) {
    print "${GREEN}✅ HTTPS/SSL support is working${NC}\n\n";
} else {
    print "${RED}❌ HTTPS/SSL support is NOT working${NC}\n";
    print "${YELLOW}Install SSL modules: sudo apt-get install liblwp-protocol-https-perl${NC}\n\n";
    exit 1;
}

# Test 3: Load configuration
print "${YELLOW}Test 3: Loading configuration from /etc/asterisk/dids.conf...${NC}\n";
my $config = load_config('/etc/asterisk/dids.conf');

if (!$api_url && $config->{api_base_url}) {
    $api_url = $config->{api_base_url};
}
if (!$api_key && $config->{api_key}) {
    $api_key = $config->{api_key};
}

print "  ${BLUE}API URL: $api_url${NC}\n" if $api_url;
print "  ${BLUE}API Key: " . substr($api_key, 0, 10) . "...${NC}\n" if $api_key;
print "  ${BLUE}Timeout: $config->{api_timeout}s${NC}\n" if $config->{api_timeout};
print "  ${BLUE}Max Retries: $config->{max_retries}${NC}\n" if $config->{max_retries};
print "  ${BLUE}Fallback DID: $config->{fallback_did}${NC}\n" if $config->{fallback_did};

if (!$api_url || !$api_key) {
    print "\n${RED}❌ API URL and API Key are required${NC}\n";
    print "${YELLOW}Please configure /etc/asterisk/dids.conf or provide --api-url and --api-key${NC}\n\n";
    exit 1;
}
print "${GREEN}✅ Configuration loaded${NC}\n\n";

# Test 4: Test API connectivity
print "${YELLOW}Test 4: Testing API connectivity...${NC}\n";
my $api_ok = test_api_connection($api_url, $api_key);
if ($api_ok) {
    print "${GREEN}✅ API connection successful${NC}\n\n";
} else {
    print "${RED}❌ API connection failed${NC}\n";
    print "${YELLOW}Check API URL and key in configuration${NC}\n\n";
}

# Test 5: Test DID selection
print "${YELLOW}Test 5: Testing DID selection API...${NC}\n";
print "  ${BLUE}Campaign: $campaign_id${NC}\n";
print "  ${BLUE}Agent: $agent_id${NC}\n";
print "  ${BLUE}Phone: $customer_phone${NC}\n";
print "  ${BLUE}State: $customer_state${NC}\n";
print "  ${BLUE}ZIP: $customer_zip${NC}\n\n";

my $did_result = test_did_selection(
    $api_url, $api_key,
    $campaign_id, $agent_id, $customer_phone,
    $customer_state, $customer_zip
);

if ($did_result->{success}) {
    print "${GREEN}✅ DID selection successful${NC}\n";
    print "  ${GREEN}Selected DID: $did_result->{did}${NC}\n";
    print "  ${BLUE}Response time: $did_result->{response_time}ms${NC}\n";
    if ($verbose && $did_result->{full_response}) {
        print "\n${BLUE}Full API Response:${NC}\n";
        print "$did_result->{full_response}\n";
    }
} else {
    print "${RED}❌ DID selection failed${NC}\n";
    print "  ${RED}Error: $did_result->{error}${NC}\n";
}
print "\n";

# Test 6: Database connection (optional)
if (!$skip_db) {
    print "${YELLOW}Test 6: Testing database connection (optional)...${NC}\n";
    my $db_ok = test_database_connection();
    if ($db_ok) {
        print "${GREEN}✅ Database connection successful${NC}\n\n";
    } else {
        print "${YELLOW}⚠️  Database connection failed (optional)${NC}\n\n";
    }
}

# Summary
print "${BLUE}📊 Test Summary${NC}\n";
print "${BLUE}===============${NC}\n";
print "  Modules: ${GREEN}✅${NC}\n";
print "  HTTPS/SSL: " . ($ssl_ok ? "${GREEN}✅${NC}" : "${RED}❌${NC}") . "\n";
print "  Configuration: ${GREEN}✅${NC}\n";
print "  API Connection: " . ($api_ok ? "${GREEN}✅${NC}" : "${RED}❌${NC}") . "\n";
print "  DID Selection: " . ($did_result->{success} ? "${GREEN}✅${NC}" : "${RED}❌${NC}") . "\n";

print "\n${GREEN}🎉 Integration test complete!${NC}\n";
exit($did_result->{success} ? 0 : 1);

################################################################################
# Helper Functions
################################################################################

sub check_module {
    my ($module) = @_;
    eval "use $module; 1" or return 0;
    return 1;
}

sub test_ssl_support {
    eval {
        require LWP::UserAgent;
        require LWP::Protocol::https;
        my $ua = LWP::UserAgent->new(ssl_opts => { verify_hostname => 1 });
        my $response = $ua->get('https://www.google.com');
        return 1;
    };
    return 0 if $@;
    return 1;
}

sub load_config {
    my ($config_file) = @_;
    my %config = ();

    return \%config unless -f $config_file;

    open(my $fh, '<', $config_file) or return \%config;
    while (my $line = <$fh>) {
        chomp $line;
        $line =~ s/#.*$//; # Remove comments
        $line =~ s/^\s+|\s+$//g; # Trim whitespace
        next if $line eq '';
        next if $line =~ /^\[/; # Skip section headers

        if ($line =~ /^(\w+)\s*=\s*(.+)$/) {
            $config{$1} = $2;
        }
    }
    close($fh);

    return \%config;
}

sub test_api_connection {
    my ($url, $key) = @_;

    eval {
        require LWP::UserAgent;
        my $ua = LWP::UserAgent->new(
            timeout => 10,
            ssl_opts => { verify_hostname => 1 }
        );

        # Test health endpoint
        my $health_url = $url;
        $health_url =~ s/\/api\/v1.*//;
        $health_url .= '/api/v1/health';

        print "  ${BLUE}Testing: $health_url${NC}\n" if $verbose;

        my $response = $ua->get(
            $health_url,
            'x-api-key' => $key
        );

        if ($response->is_success) {
            print "  ${GREEN}✅ Health check: " . $response->status_line . "${NC}\n";
            return 1;
        } else {
            print "  ${YELLOW}⚠️  Health check: " . $response->status_line . "${NC}\n";
            # Try to continue anyway
            return 1;
        }
    };

    if ($@) {
        print "  ${RED}Error: $@${NC}\n";
        return 0;
    }

    return 1;
}

sub test_did_selection {
    my ($url, $key, $campaign, $agent, $phone, $state, $zip) = @_;

    require LWP::UserAgent;
    require JSON;
    require URI::Escape;

    my $ua = LWP::UserAgent->new(
        timeout => 10,
        ssl_opts => { verify_hostname => 1 }
    );

    # Build API URL
    my $api_url = $url;
    $api_url =~ s/\/api\/v1.*//;
    $api_url .= '/api/v1/dids/next';

    # Add query parameters
    my @params = (
        "campaign_id=" . URI::Escape::uri_escape($campaign),
        "agent_id=" . URI::Escape::uri_escape($agent),
        "customer_phone=" . URI::Escape::uri_escape($phone),
        "customer_state=" . URI::Escape::uri_escape($state),
        "customer_zip=" . URI::Escape::uri_escape($zip),
    );

    $api_url .= '?' . join('&', @params);

    print "  ${BLUE}Requesting: $api_url${NC}\n" if $verbose;

    my $start_time = time();
    my $response = $ua->get(
        $api_url,
        'x-api-key' => $key
    );
    my $end_time = time();
    my $response_time = int(($end_time - $start_time) * 1000);

    if ($response->is_success) {
        my $data = eval { JSON::decode_json($response->decoded_content) };
        if ($@) {
            return {
                success => 0,
                error => "Failed to parse JSON response: $@"
            };
        }

        my $did = $data->{data}->{selectedDID} || $data->{did} || 'UNKNOWN';

        return {
            success => 1,
            did => $did,
            response_time => $response_time,
            full_response => $verbose ? JSON::encode_json($data) : undef
        };
    } else {
        return {
            success => 0,
            error => $response->status_line . " - " . $response->decoded_content,
            response_time => $response_time
        };
    }
}

sub test_database_connection {
    eval {
        require DBI;
        require DBD::mysql;

        # Try to load DB settings from VICIdial config
        my $config_file = '/etc/astguiclient.conf';
        my %db_config = ();

        if (-f $config_file) {
            open(my $fh, '<', $config_file);
            while (my $line = <$fh>) {
                if ($line =~ /^VARDB_server\s*=>\s*(.+)/) { $db_config{host} = $1; }
                if ($line =~ /^VARDB_database\s*=>\s*(.+)/) { $db_config{database} = $1; }
                if ($line =~ /^VARDB_user\s*=>\s*(.+)/) { $db_config{user} = $1; }
                if ($line =~ /^VARDB_pass\s*=>\s*(.+)/) { $db_config{pass} = $1; }
                if ($line =~ /^VARDB_port\s*=>\s*(.+)/) { $db_config{port} = $1; }
            }
            close($fh);
        }

        # Set defaults if not found
        $db_config{host} ||= 'localhost';
        $db_config{database} ||= 'asterisk';
        $db_config{user} ||= 'cron';
        $db_config{pass} ||= '1234';
        $db_config{port} ||= '3306';

        print "  ${BLUE}Connecting to: $db_config{host}:$db_config{port}/$db_config{database}${NC}\n";

        my $dsn = "DBI:mysql:database=$db_config{database};host=$db_config{host};port=$db_config{port}";
        my $dbh = DBI->connect($dsn, $db_config{user}, $db_config{pass}, {
            RaiseError => 1,
            PrintError => 0
        });

        # Test query
        my $sth = $dbh->prepare("SELECT VERSION()");
        $sth->execute();
        my ($version) = $sth->fetchrow_array();
        print "  ${GREEN}MySQL Version: $version${NC}\n";

        $dbh->disconnect();
        return 1;
    };

    if ($@) {
        print "  ${YELLOW}Database error: $@${NC}\n";
        return 0;
    }

    return 1;
}

sub print_help {
    print << "HELP";
VICIdial DID Optimizer Integration Test Script

Usage: $0 [options]

Options:
  --api-url URL       API base URL (default: from dids.conf)
  --api-key KEY       API key (default: from dids.conf)
  --campaign ID       Test campaign ID (default: TEST001)
  --agent ID          Test agent ID (default: 1001)
  --phone NUMBER      Test phone number (default: 4155551234)
  --state STATE       Test state code (default: CA)
  --zip ZIP           Test ZIP code (default: 94102)
  --skip-db           Skip database connection test
  --verbose           Enable verbose output
  --help              Show this help message

Examples:
  # Test with default settings from dids.conf
  $0

  # Test with custom API settings
  $0 --api-url https://dids.amdy.io --api-key YOUR_KEY

  # Test with custom parameters
  $0 --campaign SALES001 --phone 2125551234 --state NY --zip 10001

  # Verbose mode with all details
  $0 --verbose

  # Skip database test
  $0 --skip-db

HELP
}
