#!/usr/bin/perl

###############################################################################
# VICIdial Call Results Processor (Perl)
#
# Polls vicidial_log table for new completed calls and sends them to DID
# Optimizer API. Runs via cron every minute.
#
# Configuration: Edit the variables in the CONFIG section below, or set
# environment variables.
###############################################################################

use strict;
use warnings;
use DBI;
use LWP::UserAgent;
use JSON;
use POSIX qw(strftime);

###############################################################################
# CONFIG - Configuration is read from multiple sources:
# 1. /etc/astguiclient.conf - VICIdial database configuration (standard VICIdial)
# 2. /etc/asterisk/dids.conf - DID Optimizer API configuration (same as AGI script)
# 3. Environment variables - Override for testing
###############################################################################

my $ASTGUICLIENT_CONF = '/etc/astguiclient.conf';
my $DID_CONFIG_FILE = '/etc/asterisk/dids.conf';
my $LAST_CHECK_FILE = '/tmp/did-optimizer-last-check.txt';
my $LOG_FILE = '/var/log/astguiclient/did-optimizer-sync.log';
my $BATCH_SIZE = 500;

# Configuration hash (populated from config files)
my %config;

# VICIdial Database Configuration (from astguiclient.conf)
my $VICIDIAL_DB_HOST;
my $VICIDIAL_DB_USER;
my $VICIDIAL_DB_PASSWORD;
my $VICIDIAL_DB_NAME;

# DID Optimizer API Configuration (from dids.conf)
my $API_URL;
my $API_KEY;

###############################################################################
# FUNCTIONS
###############################################################################

sub load_configuration {
    # Set default values
    %config = (
        api_base_url => 'http://localhost:5000',
        api_key => $ENV{'API_KEY'} || '',
        db_host => $ENV{'VICIDIAL_DB_HOST'} || 'localhost',
        db_user => $ENV{'VICIDIAL_DB_USER'} || 'cron',
        db_pass => $ENV{'VICIDIAL_DB_PASSWORD'} || '1234',
        db_name => $ENV{'VICIDIAL_DB_NAME'} || 'asterisk',
        db_port => $ENV{'VICIDIAL_DB_PORT'} || '3306'
    );

    # 1. Read VICIdial database configuration from astguiclient.conf
    if (-f $ASTGUICLIENT_CONF && -r $ASTGUICLIENT_CONF) {
        open my $fh, '<', $ASTGUICLIENT_CONF or do {
            log_message("⚠️  Cannot open astguiclient.conf: $!");
        };

        if ($fh) {
            while (my $line = <$fh>) {
                chomp $line;
                $line =~ s/^\s+|\s+$//g;  # Trim whitespace

                # Skip comments and empty lines
                next if $line =~ /^[#;]/ || $line eq '';

                # VICIdial format: VAR => value
                if ($line =~ /^\$?(\w+)\s*=>\s*['"]?([^'"]+)['"]?\s*[,;]?$/) {
                    my ($key, $value) = ($1, $2);
                    $value =~ s/['"]//g;  # Remove quotes

                    # Map VICIdial DB variables to our config
                    if ($key eq 'VARDB_server' || $key eq 'VARDBserver') {
                        $config{db_host} = $value;
                    } elsif ($key eq 'VARDB_database' || $key eq 'VARDBdatabase') {
                        $config{db_name} = $value;
                    } elsif ($key eq 'VARDB_user' || $key eq 'VARDBuser') {
                        $config{db_user} = $value;
                    } elsif ($key eq 'VARDB_pass' || $key eq 'VARDBpass') {
                        $config{db_pass} = $value;
                    } elsif ($key eq 'VARDB_port' || $key eq 'VARDBport') {
                        $config{db_port} = $value;
                    }
                }
            }
            close $fh;
            log_message("✅ VICIdial database config loaded from $ASTGUICLIENT_CONF");
        }
    } else {
        log_message("ℹ️  VICIdial config file $ASTGUICLIENT_CONF not found");
    }

    # 2. Read DID Optimizer API configuration from dids.conf
    if (-f $DID_CONFIG_FILE && -r $DID_CONFIG_FILE) {
        open my $fh, '<', $DID_CONFIG_FILE or do {
            log_message("⚠️  Cannot open DID config file $DID_CONFIG_FILE: $!");
        };

        if ($fh) {
            while (my $line = <$fh>) {
                chomp $line;
                $line =~ s/^\s+|\s+$//g;  # Trim whitespace

                # Skip comments and empty lines
                next if $line =~ /^#/ || $line eq '';

                # Skip section headers
                next if $line =~ /^\[(.+)\]$/;

                # Key-value pairs (INI format)
                if ($line =~ /^(\w+)\s*=\s*(.*)$/) {
                    my ($key, $value) = ($1, $2);
                    $value =~ s/^\s+|\s+$//g;  # Trim value
                    $config{$key} = $value;
                }
            }
            close $fh;
            log_message("✅ DID Optimizer config loaded from $DID_CONFIG_FILE");
        }
    } else {
        log_message("ℹ️  DID config file $DID_CONFIG_FILE not found");
    }

    # 3. Environment variables override file config
    if ($ENV{'API_KEY'}) {
        $config{api_key} = $ENV{'API_KEY'};
        log_message("ℹ️  API_KEY overridden from environment variable");
    }
    if ($ENV{'DID_OPTIMIZER_API_URL'}) {
        $config{api_base_url} = $ENV{'DID_OPTIMIZER_API_URL'};
        log_message("ℹ️  API URL overridden from environment variable");
    }

    # Map config keys to variables
    $API_URL = $config{api_base_url};
    $API_KEY = $config{api_key};
    $VICIDIAL_DB_HOST = $config{db_host};
    $VICIDIAL_DB_USER = $config{db_user};
    $VICIDIAL_DB_PASSWORD = $config{db_pass};
    $VICIDIAL_DB_NAME = $config{db_name};

    log_message("📋 Final configuration:");
    log_message("   API URL: $API_URL");
    log_message("   DB Host: $VICIDIAL_DB_HOST:$config{db_port}");
    log_message("   DB Name: $VICIDIAL_DB_NAME");
    log_message("   DB User: $VICIDIAL_DB_USER");

    # Validate required configuration
    unless ($API_KEY) {
        print STDERR "❌ API key not found in any configuration source\n";
        print STDERR "   Checked:\n";
        print STDERR "   - $DID_CONFIG_FILE (api_key=...)\n";
        print STDERR "   - Environment variable API_KEY\n";
        print STDERR "\n";
        print STDERR "   Please configure API key in one of these locations.\n";
        exit 1;
    }
}

sub log_message {
    my ($message) = @_;
    my $timestamp = strftime("%Y-%m-%dT%H:%M:%S", gmtime());
    my $log_line = "[$timestamp] $message\n";

    print $log_line;

    # Append to log file
    if (open(my $fh, '>>', $LOG_FILE)) {
        print $fh $log_line;
        close($fh);
    }
}

sub get_last_check_time {
    if (-e $LAST_CHECK_FILE) {
        if (open(my $fh, '<', $LAST_CHECK_FILE)) {
            my $content = <$fh>;
            close($fh);
            chomp($content);
            $content =~ s/^\s+|\s+$//g;  # trim whitespace

            # Return content only if it's not empty
            if ($content && $content ne '') {
                log_message("📅 Last check: $content");
                return $content;
            }
        } else {
            log_message("⚠️  Could not read last check file: $!");
        }
    }

    # Default to start of today (00:00:00) if no checkpoint exists
    my @now = localtime(time());
    my $start_of_today = strftime("%Y-%m-%d 00:00:00", 0, 0, 0, $now[3], $now[4], $now[5]);
    log_message("📅 No checkpoint found - using start of today: $start_of_today");
    return $start_of_today;
}

sub save_last_check_time {
    my ($timestamp) = @_;

    if (open(my $fh, '>', $LAST_CHECK_FILE)) {
        print $fh $timestamp;
        close($fh);
        log_message("💾 Saved checkpoint: $timestamp");
    } else {
        log_message("❌ Failed to save checkpoint: $!");
    }
}

sub fetch_new_call_results {
    my ($dbh, $last_check) = @_;

    my $query_start = time();

    # Optimized query using STRAIGHT_JOIN and covering index hints
    # This prevents table locking and uses indexes efficiently
    my $sql = <<'SQL';
SELECT STRAIGHT_JOIN
    uniqueid,
    lead_id,
    list_id,
    campaign_id,
    call_date,
    start_epoch,
    end_epoch,
    length_in_sec,
    status,
    phone_code,
    phone_number,
    user,
    comments,
    processed,
    user_group,
    term_reason,
    alt_dial,
    called_count
FROM vicidial_log
WHERE end_epoch > UNIX_TIMESTAMP(?)
    AND status != ''
    AND status IS NOT NULL
    AND length_in_sec > 0
ORDER BY end_epoch ASC
LIMIT ?
SQL

    my $sth = $dbh->prepare($sql);
    $sth->execute($last_check, $BATCH_SIZE);

    my @calls;
    while (my $row = $sth->fetchrow_hashref()) {
        push @calls, $row;
    }

    my $query_duration = sprintf("%.3f", time() - $query_start);
    my $record_count = scalar(@calls);
    log_message("📊 Query completed in ${query_duration}s - fetched $record_count records");

    return \@calls;
}

sub send_call_result_to_api {
    my ($call) = @_;

    my $payload = {
        uniqueid    => $call->{uniqueid},
        leadId      => $call->{lead_id},
        listId      => $call->{list_id},
        campaignId  => $call->{campaign_id},
        phoneNumber => $call->{phone_number},
        phoneCode   => $call->{phone_code},
        disposition => $call->{status},
        duration    => $call->{length_in_sec},
        agentId     => $call->{user},
        userGroup   => $call->{user_group},
        termReason  => $call->{term_reason},
        comments    => $call->{comments},
        altDial     => $call->{alt_dial},
        calledCount => $call->{called_count},
        callDate    => $call->{call_date},
        startEpoch  => $call->{start_epoch},
        endEpoch    => $call->{end_epoch},
        timestamp   => $call->{end_epoch}
    };

    my $ua = LWP::UserAgent->new();
    $ua->timeout(10);

    my $json = encode_json($payload);

    my $response = $ua->post(
        "$API_URL/api/v1/call-results",
        'Content-Type'  => 'application/json',
        'x-api-key'     => $API_KEY,
        'Content'       => $json
    );

    if ($response->is_success) {
        return decode_json($response->decoded_content);
    } else {
        die "API request failed: " . $response->status_line;
    }
}

sub process_call_results {
    my $start_time = time();
    log_message('🚀 Starting call results sync...');

    my $dbh;
    eval {
        # Connect to VICIdial database
        my $dsn = "DBI:mysql:database=$VICIDIAL_DB_NAME;host=$VICIDIAL_DB_HOST";
        $dbh = DBI->connect($dsn, $VICIDIAL_DB_USER, $VICIDIAL_DB_PASSWORD, {
            RaiseError => 1,
            PrintError => 0,
            mysql_enable_utf8 => 1
        });
        log_message('✅ Connected to VICIdial database');

        # Get last check time
        my $last_check = get_last_check_time();

        # Fetch new call results
        my $calls = fetch_new_call_results($dbh, $last_check);
        my $call_count = scalar(@$calls);
        log_message("📞 Found $call_count new call results");

        if ($call_count == 0) {
            log_message('✓ No new calls to process');
            return;
        }

        # Process each call
        my $processed = 0;
        my $failed = 0;
        my $latest_end_epoch = 0;

        foreach my $call (@$calls) {
            eval {
                send_call_result_to_api($call);
                $processed++;

                # Track latest end_epoch
                if ($call->{end_epoch} > $latest_end_epoch) {
                    $latest_end_epoch = $call->{end_epoch};
                }

                log_message(sprintf(
                    "✓ %s: %s/%s → %s (%ss)",
                    $call->{uniqueid},
                    $call->{campaign_id},
                    $call->{phone_number},
                    $call->{status},
                    $call->{length_in_sec}
                ));
            };
            if ($@) {
                $failed++;
                my $error = $@;
                $error =~ s/\n.*//s;  # Get first line only
                log_message("✗ $call->{uniqueid}: $error");
            }
        }

        # Update checkpoint to latest processed call
        if ($latest_end_epoch > 0) {
            my $checkpoint_time = strftime(
                "%Y-%m-%d %H:%M:%S",
                localtime($latest_end_epoch)
            );
            save_last_check_time($checkpoint_time);
        }

        my $duration = sprintf("%.2f", time() - $start_time);
        log_message("📊 Summary: $processed processed, $failed failed in ${duration}s");

        if ($call_count == $BATCH_SIZE) {
            log_message("⚠️  Batch limit reached ($BATCH_SIZE). More calls may be pending.");
        }
    };

    if ($@) {
        my $error = $@;
        log_message("❌ Fatal error: $error");

        if ($error =~ /connect/i) {
            log_message('❌ Cannot connect to VICIdial database. Check credentials and connection.');
        }

        die $error;
    }

    if ($dbh) {
        $dbh->disconnect();
        log_message('🔌 Database connection closed');
    }
}

###############################################################################
# MAIN EXECUTION
###############################################################################

# Load configuration first
load_configuration();

eval {
    process_call_results();
    log_message("✅ Sync completed successfully\n");
};

if ($@) {
    log_message("❌ Sync failed: $@\n");
    exit 1;
}

exit 0;
