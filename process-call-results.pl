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
# CONFIG - Configuration is read from /etc/asterisk/dids.conf (same as AGI script)
###############################################################################

my $CONFIG_FILE = '/etc/asterisk/dids.conf';
my $LAST_CHECK_FILE = '/tmp/did-optimizer-last-check.txt';
my $LOG_FILE = '/var/log/did-optimizer-sync.log';
my $BATCH_SIZE = 500;

# Configuration hash (populated from config file)
my %config;

# VICIdial Database Configuration (defaults, overridden by config file)
my $VICIDIAL_DB_HOST;
my $VICIDIAL_DB_USER;
my $VICIDIAL_DB_PASSWORD;
my $VICIDIAL_DB_NAME;

# DID Optimizer API Configuration (defaults, overridden by config file)
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
        db_name => $ENV{'VICIDIAL_DB_NAME'} || 'asterisk'
    );

    # Read configuration file if it exists
    if (-f $CONFIG_FILE && -r $CONFIG_FILE) {
        open my $fh, '<', $CONFIG_FILE or do {
            log_message("⚠️  Cannot open configuration file $CONFIG_FILE: $!");
            return;
        };

        while (my $line = <$fh>) {
            chomp $line;
            $line =~ s/^\s+|\s+$//g;  # Trim whitespace

            # Skip comments and empty lines
            next if $line =~ /^#/ || $line eq '';

            # Skip section headers
            next if $line =~ /^\[(.+)\]$/;

            # Key-value pairs
            if ($line =~ /^(\w+)\s*=\s*(.*)$/) {
                my ($key, $value) = ($1, $2);
                $value =~ s/^\s+|\s+$//g;  # Trim value
                $config{$key} = $value;
            }
        }

        close $fh;
        log_message("✅ Configuration loaded from $CONFIG_FILE");
    } else {
        log_message("ℹ️  Configuration file $CONFIG_FILE not found, using defaults/environment variables");
    }

    # Map config keys to variables
    $API_URL = $config{api_base_url};
    $API_KEY = $config{api_key};
    $VICIDIAL_DB_HOST = $config{db_host};
    $VICIDIAL_DB_USER = $config{db_user};
    $VICIDIAL_DB_PASSWORD = $config{db_pass};
    $VICIDIAL_DB_NAME = $config{db_name};

    # Validate required configuration
    unless ($API_KEY) {
        print STDERR "❌ API key not found in $CONFIG_FILE or API_KEY environment variable\n";
        print STDERR "   Please set api_key in $CONFIG_FILE or set API_KEY environment variable\n";
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
            log_message("📅 Last check: $content");
            return $content;
        } else {
            log_message("⚠️  Could not read last check file: $!");
        }
    }

    # Default to 1 hour ago if no checkpoint exists
    my $one_hour_ago = time() - 3600;
    my $default_time = strftime("%Y-%m-%d %H:%M:%S", localtime($one_hour_ago));
    log_message("📅 Using default start time: $default_time");
    return $default_time;
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

    my $sql = <<'SQL';
SELECT
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
