#!/usr/bin/perl

##############################################################################
# VICIdial DID Optimizer - Quick Inline Script
#
# This script provides a lightweight option for DID selection that can be
# called directly from the dialplan using SHELL() function.
#
# Usage: ${SHELL(/usr/share/astguiclient/agi-bin/did-optimizer-quick.pl CAMPAIGN AGENT PHONE)}
#
# Returns: Selected DID phone number (stdout)
##############################################################################

use strict;
use warnings;
use LWP::UserAgent;
use JSON;
use DBI;

# Get command line arguments
my ($campaign_id, $agent_id, $customer_phone) = @ARGV;

# Exit with fallback if missing parameters
unless ($campaign_id && $agent_id && $customer_phone) {
    print "+18005551234\n";
    exit 0;
}

# Read configuration
my $config_file = '/etc/asterisk/dids.conf';
my %config = read_config($config_file);

# Configuration reader
sub read_config {
    my $file = shift;
    my %cfg;

    return %cfg unless -f $file;

    open my $fh, '<', $file or return %cfg;

    while (my $line = <$fh>) {
        chomp $line;
        next if $line =~ /^\s*[#;]/ || $line =~ /^\s*$/;
        next if $line =~ /^\s*\[/;

        if ($line =~ /^\s*(\w+)\s*=\s*(.*)$/) {
            $cfg{$1} = $2;
        }
    }
    close $fh;
    return %cfg;
}

# Get customer location from VICIdial database
sub get_customer_location {
    my $phone = shift;

    my $dsn = "DBI:mysql:database=" . ($config{db_name} || 'asterisk') .
              ";host=" . ($config{db_host} || 'localhost');

    my $dbh = DBI->connect($dsn,
                          $config{db_user} || 'cron',
                          $config{db_pass} || '1234',
                          { RaiseError => 0, PrintError => 0 });

    return ('', '') unless $dbh;

    my $sql = "SELECT state, postal_code FROM vicidial_list WHERE phone_number = ? LIMIT 1";
    my $sth = $dbh->prepare($sql);
    $sth->execute($phone);

    my ($state, $zip) = $sth->fetchrow_array();
    $sth->finish();
    $dbh->disconnect();

    return ($state || '', $zip || '');
}

# Call DID Optimizer API
sub get_optimized_did {
    my ($campaign, $agent, $phone, $state, $zip) = @_;

    my $api_url = $config{api_base_url} || 'http://localhost:3001';
    my $api_key = $config{api_key} || '';
    my $fallback_did = $config{fallback_did} || '+18005551234';

    return $fallback_did unless $api_key;

    my $ua = LWP::UserAgent->new(
        timeout => ($config{api_timeout} || 5),  # Shorter timeout for inline calls
        agent => 'VICIdial-DID-Optimizer-Quick/1.0'
    );

    my $url = "$api_url/api/v1/dids/next";
    my @params = (
        "campaign_id=$campaign",
        "agent_id=$agent",
        "customer_phone=$phone",
        "customer_state=$state",
        "customer_zip=$zip"
    );
    $url .= '?' . join('&', @params);

    my $request = HTTP::Request->new(GET => $url);
    $request->header('x-api-key' => $api_key);

    my $response = $ua->request($request);

    if ($response->is_success) {
        my $data = eval { decode_json($response->content) };
        return $data->{selected_did} || $data->{did} || $fallback_did if $data;
    }

    return $fallback_did;
}

# Main execution
eval {
    # Get customer location
    my ($customer_state, $customer_zip) = get_customer_location($customer_phone);

    # Get optimized DID
    my $selected_did = get_optimized_did($campaign_id, $agent_id, $customer_phone, $customer_state, $customer_zip);

    # Output the selected DID
    print "$selected_did\n";
};

if ($@) {
    # On error, output fallback DID
    print ($config{fallback_did} || '+18005551234') . "\n";
}

exit 0;