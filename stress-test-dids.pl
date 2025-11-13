#!/usr/bin/perl
#
# stress-test-dids-simple.pl - Simple VICIdial-Compatible DID API Stress Test
#
# Usage:
#   perl stress-test-dids-simple.pl --concurrent 10 --requests 100
#   perl stress-test-dids-simple.pl --config /etc/asterisk/dids.conf
#
# This uses simple sequential batches for compatibility with all Perl installations
#

use strict;
use warnings;
use LWP::UserAgent;
use JSON;
use Time::HiRes qw(gettimeofday tv_interval time);
use Getopt::Long;
use POSIX qw(strftime);

# ============================================================================
# Configuration
# ============================================================================

my %config = (
    api_url => $ENV{API_URL} || 'http://localhost:5000/api/v1/dids/next',
    api_key => $ENV{API_KEY} || 'did_259b3759b3041137f2379fe1aff4aefeba4aa8b8bea355c4f0e33fbe714d46f7',
    concurrent => 10,
    total_requests => 100,
    timeout => 30,
    config_file => '',
    report_file => 'stress-test-perl-report.json'
);

# Parse command line options
GetOptions(
    'concurrent=i' => \$config{concurrent},
    'requests=i' => \$config{total_requests},
    'timeout=i' => \$config{timeout},
    'api-url=s' => \$config{api_url},
    'api-key=s' => \$config{api_key},
    'config=s' => \$config{config_file},
    'report=s' => \$config{report_file}
) or die "Usage: $0 [--concurrent N] [--requests N] [--timeout N] [--api-url URL] [--api-key KEY] [--config FILE] [--report FILE]\n";

# Load config from dids.conf if specified
if ($config{config_file} && -f $config{config_file}) {
    print "📋 Loading configuration from $config{config_file}...\n";
    my %file_config = read_dids_config($config{config_file});
    $config{api_url} = $file_config{api_base_url} . '/next' if $file_config{api_base_url};
    $config{api_key} = $file_config{api_key} if $file_config{api_key};
}

# Test data
my @campaign_ids = ('CAMPAIGN001', 'CAMPAIGN002', 'CAMPAIGN003');
my @agent_ids = map { sprintf("agent%04d", 1001 + $_) } (0..19);
my @states = ('CA', 'NY', 'TX', 'FL', 'IL', 'PA', 'OH', 'GA', 'NC', 'MI');

# Statistics storage
my %stats = (
    total => 0,
    successful => 0,
    failed => 0,
    response_times => [],
    status_codes => {},
    errors => {},
    start_time => 0,
    end_time => 0
);

# ============================================================================
# Main Execution
# ============================================================================

print "\n";
print "═══════════════════════════════════════════════════════════\n";
print "  🚀 VICIdial DID API Stress Test (Perl - Simple)\n";
print "═══════════════════════════════════════════════════════════\n\n";

print "📋 Configuration:\n";
print "   API URL:           $config{api_url}\n";
print "   Concurrent:        $config{concurrent}\n";
print "   Total Requests:    $config{total_requests}\n";
print "   Timeout:           $config{timeout}s\n";
print "\n";

# Create LWP UserAgent
my $ua = LWP::UserAgent->new(
    agent => 'VICIdial-DID-Stress-Test/1.0',
    timeout => $config{timeout},
    keep_alive => 10
);

# Set default headers
$ua->default_header('x-api-key' => $config{api_key});
$ua->default_header('Accept' => 'application/json');

# Start timing
$stats{start_time} = time();

# Execute requests in concurrent batches using fork
my $requests_completed = 0;
while ($requests_completed < $config{total_requests}) {
    my $batch_size = ($config{total_requests} - $requests_completed) < $config{concurrent} ?
                     ($config{total_requests} - $requests_completed) : $config{concurrent};

    # Create a temporary file for IPC
    my $tmp_file = "/tmp/stress_test_$$\_$requests_completed.json";

    my @pids;
    for (my $i = 0; $i < $batch_size; $i++) {
        my $pid = fork();
        die "fork() failed: $!" unless defined $pid;

        if ($pid == 0) {
            # Child process
            my $result = make_request($ua);

            # Write result to temp file
            my $child_file = "$tmp_file.$i";
            open(my $fh, '>', $child_file) or die "Cannot write to $child_file: $!";
            print $fh encode_json($result);
            close($fh);

            exit 0;
        } else {
            # Parent process
            push @pids, { pid => $pid, file => "$tmp_file.$i" };
        }
    }

    # Wait for all children and collect results
    foreach my $child (@pids) {
        waitpid($child->{pid}, 0);

        # Read result from temp file
        if (-f $child->{file}) {
            open(my $fh, '<', $child->{file}) or next;
            my $json = <$fh>;
            close($fh);
            unlink($child->{file});

            my $result = eval { decode_json($json) };
            next unless $result;

            $stats{total}++;
            $requests_completed++;

            if ($result->{success}) {
                $stats{successful}++;
            } else {
                $stats{failed}++;
                my $error = $result->{error} || 'Unknown error';
                $stats{errors}{$error}++;
            }

            push @{$stats{response_times}}, $result->{response_time};

            my $status = $result->{status_code} || 0;
            $stats{status_codes}{$status}++;
        }

        print_progress();
    }
}

$stats{end_time} = time();

# Print final report
print "\n\n";
print_final_report();

# Save JSON report
save_report();

exit 0;

# ============================================================================
# Functions
# ============================================================================

sub make_request {
    my ($ua) = @_;

    # Generate random test data
    my $campaign_id = $campaign_ids[int(rand(@campaign_ids))];
    my $agent_id = $agent_ids[int(rand(@agent_ids))];
    my $customer_phone = sprintf("555%07d", int(rand(10000000)));
    my $customer_state = $states[int(rand(@states))];

    # Build URL with query parameters
    my $url = $config{api_url} .
              "?campaign_id=$campaign_id" .
              "&agent_id=$agent_id" .
              "&customer_phone=$customer_phone" .
              "&customer_state=$customer_state";

    my $start_time = [gettimeofday];

    # Make HTTP request
    my $response = $ua->get($url);

    my $response_time = tv_interval($start_time) * 1000;  # Convert to milliseconds

    my %result = (
        response_time => $response_time,
        success => 0,
        status_code => $response->code,
        error => ''
    );

    if ($response->is_success) {
        $result{success} = 1;
    } else {
        $result{error} = "HTTP " . $response->code . ": " . $response->message;
    }

    return \%result;
}

sub print_progress {
    my $progress = sprintf("%.1f", ($stats{total} / $config{total_requests}) * 100);
    my $eta = 0;

    if ($stats{total} > 0) {
        my $elapsed = time() - $stats{start_time};
        my $rate = $stats{total} / $elapsed;
        my $remaining = $config{total_requests} - $stats{total};
        $eta = int($remaining / $rate) if $rate > 0;
    }

    printf("\r🚀 Progress: %d/%d (%s%%) | ✅ %d | ❌ %d | ETA: %ds    ",
        $stats{total}, $config{total_requests}, $progress,
        $stats{successful}, $stats{failed}, $eta);
}

sub print_final_report {
    print "═══════════════════════════════════════════════════════════\n";
    print "  ✅ Stress Test Complete - Final Report\n";
    print "═══════════════════════════════════════════════════════════\n\n";

    my $duration = $stats{end_time} - $stats{start_time};
    my $rps = $duration > 0 ? $stats{total} / $duration : 0;

    my @sorted_times = sort { $a <=> $b } @{$stats{response_times}};
    my $count = scalar(@sorted_times);

    my $min = $count > 0 ? $sorted_times[0] : 0;
    my $max = $count > 0 ? $sorted_times[-1] : 0;
    my $sum = 0;
    $sum += $_ for @sorted_times;
    my $avg = $count > 0 ? $sum / $count : 0;
    my $p50 = percentile(\@sorted_times, 50);
    my $p90 = percentile(\@sorted_times, 90);
    my $p95 = percentile(\@sorted_times, 95);
    my $p99 = percentile(\@sorted_times, 99);

    print "📊 Summary:\n";
    printf("   Total Requests:    %d\n", $stats{total});
    printf("   ✅ Successful:     %d\n", $stats{successful});
    printf("   ❌ Failed:         %d\n", $stats{failed});
    printf("   Success Rate:      %.2f%%\n", $stats{total} > 0 ? ($stats{successful} / $stats{total}) * 100 : 0);
    printf("   Actual RPS:        %.2f\n", $rps);
    printf("   Duration:          %.2fs\n", $duration);

    print "\n⚡ Response Times:\n";
    printf("   Min:               %.2fms\n", $min);
    printf("   Max:               %.2fms\n", $max);
    printf("   Average:           %.2fms\n", $avg);
    printf("   P50 (Median):      %.2fms\n", $p50);
    printf("   P90:               %.2fms\n", $p90);
    printf("   P95:               %.2fms\n", $p95);
    printf("   P99:               %.2fms\n", $p99);

    print "\n📈 Status Codes:\n";
    foreach my $code (sort keys %{$stats{status_codes}}) {
        my $count = $stats{status_codes}{$code};
        my $pct = $stats{total} > 0 ? ($count / $stats{total}) * 100 : 0;
        printf("   %s: %d (%.1f%%)\n", $code, $count, $pct);
    }

    if (keys %{$stats{errors}}) {
        print "\n❗ Errors:\n";
        foreach my $error (sort keys %{$stats{errors}}) {
            printf("   %dx %s\n", $stats{errors}{$error}, $error);
        }
    }

    print "\n═══════════════════════════════════════════════════════════\n\n";
}

sub save_report {
    my $duration = $stats{end_time} - $stats{start_time};

    my @sorted_times = sort { $a <=> $b } @{$stats{response_times}};
    my $count = scalar(@sorted_times);
    my $min = $count > 0 ? $sorted_times[0] : 0;
    my $max = $count > 0 ? $sorted_times[-1] : 0;
    my $sum = 0;
    $sum += $_ for @sorted_times;
    my $avg = $count > 0 ? $sum / $count : 0;

    my %report = (
        config => {
            api_url => $config{api_url},
            api_key => substr($config{api_key}, 0, 20) . "...",
            concurrent => $config{concurrent},
            total_requests => $config{total_requests},
            timeout => $config{timeout}
        },
        results => {
            total => $stats{total},
            successful => $stats{successful},
            failed => $stats{failed},
            success_rate => sprintf("%.2f%%", $stats{total} > 0 ? ($stats{successful} / $stats{total}) * 100 : 0),
            duration => sprintf("%.2fs", $duration),
            actual_rps => sprintf("%.2f", $duration > 0 ? $stats{total} / $duration : 0),
            response_times => {
                min => $min,
                max => $max,
                avg => $avg,
                p50 => percentile($stats{response_times}, 50),
                p90 => percentile($stats{response_times}, 90),
                p95 => percentile($stats{response_times}, 95),
                p99 => percentile($stats{response_times}, 99)
            },
            status_codes => $stats{status_codes},
            errors => $stats{errors}
        },
        timestamp => strftime("%Y-%m-%dT%H:%M:%SZ", gmtime())
    );

    open(my $fh, '>', $config{report_file}) or die "Cannot open report file: $!";
    print $fh JSON->new->pretty->encode(\%report);
    close($fh);

    print "📄 Full report saved to: $config{report_file}\n\n";
}

# ============================================================================
# Utility Functions
# ============================================================================

sub percentile {
    my ($values_ref, $percentile) = @_;
    my @sorted = sort { $a <=> $b } @$values_ref;
    return 0 if @sorted == 0;

    my $index = int(($percentile / 100) * scalar(@sorted));
    $index = $#sorted if $index > $#sorted;

    return $sorted[$index];
}

sub read_dids_config {
    my ($config_file) = @_;
    my %conf;

    open(my $fh, '<', $config_file) or return %conf;

    while (my $line = <$fh>) {
        chomp $line;
        $line =~ s/^\s+//;
        $line =~ s/\s+$//;

        next if $line =~ /^#/;
        next if $line =~ /^$/;

        if ($line =~ /^(\w+)\s*=\s*(.+)$/) {
            my ($key, $value) = ($1, $2);
            $value =~ s/^["']//;
            $value =~ s/["']$//;
            $conf{$key} = $value;
        }
    }

    close($fh);
    return %conf;
}
