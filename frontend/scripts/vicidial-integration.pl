#!/usr/bin/perl
#
# VICIdial DID Optimizer Integration Script
#
# This script integrates VICIdial with the DID Optimizer Pro API
# for intelligent phone number rotation and call optimization.
#
# Features:
# - NPANXX geographic location routing
# - Performance-based DID selection
# - Real-time call result reporting
# - Automatic location data population
# - Daily usage tracking and limits
#
# Version: 2.1.0
# Author: DID Optimizer Pro Team
# Repository: https://huggingface.co/spaces/kolianvb/did-optimizer
#

use strict;
use warnings;
use LWP::UserAgent;
use JSON;
use DBI;
use Time::HiRes qw(time);

# Configuration from environment variables
my $API_BASE_URL = $ENV{'DID_OPTIMIZER_URL'} || 'https://api3.amdy.io:5000/api/v1/vicidial';
my $API_KEY = $ENV{'DID_OPTIMIZER_API_KEY'} || die "DID_OPTIMIZER_API_KEY environment variable required";
my $VICIDIAL_DB_HOST = $ENV{'VICIDIAL_DB_HOST'} || 'localhost';
my $VICIDIAL_DB_USER = $ENV{'VICIDIAL_DB_USER'} || 'vicidial';
my $VICIDIAL_DB_PASS = $ENV{'VICIDIAL_DB_PASS'} || '';
my $VICIDIAL_DB_NAME = $ENV{'VICIDIAL_DB_NAME'} || 'asterisk';

# Global variables
my $ua = LWP::UserAgent->new(timeout => 10);
my $dbh;

# Initialize database connection
sub init_database {
    $dbh = DBI->connect(
        "DBI:mysql:database=$VICIDIAL_DB_NAME;host=$VICIDIAL_DB_HOST",
        $VICIDIAL_DB_USER,
        $VICIDIAL_DB_PASS,
        {
            RaiseError => 1,
            AutoCommit => 1,
            mysql_enable_utf8 => 1
        }
    ) or die "Cannot connect to VICIdial database: $DBI::errstr";
}

# Get next available DID from DID Optimizer API
# Parameters:
#   $campaign_id - VICIdial campaign identifier
#   $agent_id - VICIdial agent identifier
#   $lead_data - Optional hashref with lead information (state, area_code, lat, lon)
# Returns: DID phone number or undef on error
sub get_next_did {
    my ($campaign_id, $agent_id, $lead_data) = @_;

    my $start_time = time();

    # Build query parameters
    my @params = (
        "campaign_id=" . uri_escape($campaign_id),
        "agent_id=" . uri_escape($agent_id)
    );

    # Add geographic parameters if available
    if ($lead_data) {
        push @params, "state=" . uri_escape($lead_data->{state}) if $lead_data->{state};
        push @params, "area_code=" . uri_escape($lead_data->{area_code}) if $lead_data->{area_code};
        push @params, "latitude=" . uri_escape($lead_data->{latitude}) if $lead_data->{latitude};
        push @params, "longitude=" . uri_escape($lead_data->{longitude}) if $lead_data->{longitude};
        push @params, "zip_code=" . uri_escape($lead_data->{zip_code}) if $lead_data->{zip_code};
    }

    my $url = "$API_BASE_URL/next-did?" . join('&', @params);

    # Make API request
    my $response = $ua->get(
        $url,
        'X-API-Key' => $API_KEY,
        'User-Agent' => 'VICIdial-Integration/2.1.0'
    );

    my $response_time = sprintf("%.3f", (time() - $start_time) * 1000);

    if ($response->is_success) {
        my $data = decode_json($response->decoded_content);

        if ($data->{success}) {
            my $did_data = $data->{data};

            # Log successful DID selection
            log_did_selection({
                campaign_id => $campaign_id,
                agent_id => $agent_id,
                phone_number => $did_data->{phoneNumber},
                algorithm => $did_data->{algorithm},
                response_time => $response_time,
                location => $did_data->{metadata}->{location},
                success => 1
            });

            return $did_data->{phoneNumber};
        }
    }

    # Log failed request
    log_did_selection({
        campaign_id => $campaign_id,
        agent_id => $agent_id,
        error => $response->status_line,
        response_time => $response_time,
        success => 0
    });

    return undef;
}

# Report call result back to DID Optimizer
# Parameters:
#   $phone_number - DID that was used
#   $campaign_id - VICIdial campaign identifier
#   $agent_id - VICIdial agent identifier
#   $result - Call result (answered, no-answer, busy, failed, dropped)
#   $duration - Call duration in seconds
#   $disposition - Call disposition code
# Returns: 1 on success, 0 on failure
sub report_call_result {
    my ($phone_number, $campaign_id, $agent_id, $result, $duration, $disposition) = @_;

    my $start_time = time();

    my $payload = {
        phoneNumber => $phone_number,
        campaign_id => $campaign_id,
        agent_id => $agent_id,
        result => $result,
        duration => $duration || 0,
        disposition => $disposition || ''
    };

    my $response = $ua->post(
        "$API_BASE_URL/call-result",
        'X-API-Key' => $API_KEY,
        'Content-Type' => 'application/json',
        'User-Agent' => 'VICIdial-Integration/2.1.0',
        Content => encode_json($payload)
    );

    my $response_time = sprintf("%.3f", (time() - $start_time) * 1000);

    if ($response->is_success) {
        log_call_result({
            phone_number => $phone_number,
            campaign_id => $campaign_id,
            result => $result,
            duration => $duration,
            response_time => $response_time,
            success => 1
        });
        return 1;
    } else {
        log_call_result({
            phone_number => $phone_number,
            campaign_id => $campaign_id,
            result => $result,
            error => $response->status_line,
            response_time => $response_time,
            success => 0
        });
        return 0;
    }
}

# Get DID Optimizer statistics
# Returns: hashref with statistics or undef on error
sub get_statistics {
    my ($campaign_id, $date_from, $date_to) = @_;

    my @params;
    push @params, "campaign_id=" . uri_escape($campaign_id) if $campaign_id;
    push @params, "date_from=" . uri_escape($date_from) if $date_from;
    push @params, "date_to=" . uri_escape($date_to) if $date_to;

    my $url = "$API_BASE_URL/stats";
    $url .= "?" . join('&', @params) if @params;

    my $response = $ua->get(
        $url,
        'X-API-Key' => $API_KEY,
        'User-Agent' => 'VICIdial-Integration/2.1.0'
    );

    if ($response->is_success) {
        my $data = decode_json($response->decoded_content);
        return $data->{data} if $data->{success};
    }

    return undef;
}

# Check API health status
# Returns: 1 if healthy, 0 if not
sub check_health {
    my $response = $ua->get(
        "$API_BASE_URL/health",
        'X-API-Key' => $API_KEY,
        'User-Agent' => 'VICIdial-Integration/2.1.0'
    );

    return $response->is_success ? 1 : 0;
}

# Extract lead geographic information from VICIdial database
# Parameters:
#   $lead_id - VICIdial lead ID
# Returns: hashref with geographic data
sub get_lead_location {
    my ($lead_id) = @_;

    return {} unless $lead_id && $dbh;

    my $sth = $dbh->prepare("
        SELECT state, phone_number, postal_code
        FROM vicidial_list
        WHERE lead_id = ?
    ");

    $sth->execute($lead_id);
    my $row = $sth->fetchrow_hashref();
    $sth->finish();

    if ($row) {
        my $location = {
            state => $row->{state},
            zip_code => $row->{postal_code}
        };

        # Extract area code from phone number
        if ($row->{phone_number} && $row->{phone_number} =~ /(\d{3})/) {
            $location->{area_code} = $1;
        }

        return $location;
    }

    return {};
}

# Log DID selection event
sub log_did_selection {
    my ($data) = @_;

    return unless $dbh;

    my $sql = "
        INSERT INTO did_optimizer_log
        (event_type, campaign_id, agent_id, phone_number, algorithm,
         response_time, success, error_message, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
    ";

    eval {
        my $sth = $dbh->prepare($sql);
        $sth->execute(
            'did_selection',
            $data->{campaign_id},
            $data->{agent_id},
            $data->{phone_number},
            $data->{algorithm},
            $data->{response_time},
            $data->{success},
            $data->{error}
        );
        $sth->finish();
    };

    warn "Failed to log DID selection: $@" if $@;
}

# Log call result event
sub log_call_result {
    my ($data) = @_;

    return unless $dbh;

    my $sql = "
        INSERT INTO did_optimizer_log
        (event_type, campaign_id, phone_number, call_result,
         call_duration, response_time, success, error_message, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
    ";

    eval {
        my $sth = $dbh->prepare($sql);
        $sth->execute(
            'call_result',
            $data->{campaign_id},
            $data->{phone_number},
            $data->{result},
            $data->{duration},
            $data->{response_time},
            $data->{success},
            $data->{error}
        );
        $sth->finish();
    };

    warn "Failed to log call result: $@" if $@;
}

# URI escape utility function
sub uri_escape {
    my ($str) = @_;
    $str =~ s/([^A-Za-z0-9\-_.~])/sprintf("%%%02X", ord($1))/eg;
    return $str;
}

# Initialize database connection
init_database() if $VICIDIAL_DB_HOST;

# Create log table if it doesn't exist
if ($dbh) {
    eval {
        $dbh->do("
            CREATE TABLE IF NOT EXISTS did_optimizer_log (
                id INT AUTO_INCREMENT PRIMARY KEY,
                event_type VARCHAR(50) NOT NULL,
                campaign_id VARCHAR(100),
                agent_id VARCHAR(100),
                phone_number VARCHAR(20),
                algorithm VARCHAR(50),
                call_result VARCHAR(20),
                call_duration INT,
                response_time DECIMAL(8,3),
                success TINYINT(1) DEFAULT 0,
                error_message TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_campaign_created (campaign_id, created_at),
                INDEX idx_phone_created (phone_number, created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        ");
    };
    warn "Failed to create log table: $@" if $@;
}

# Export functions for use in other scripts
1;

__END__

=head1 NAME

VICIdial DID Optimizer Integration

=head1 SYNOPSIS

    use VICIdialIntegration;

    # Get next DID for campaign
    my $did = get_next_did('CAMPAIGN_001', 'AGENT_001');

    # Get next DID with lead location data
    my $lead_data = get_lead_location($lead_id);
    my $did = get_next_did('CAMPAIGN_001', 'AGENT_001', $lead_data);

    # Report call result
    report_call_result($did, 'CAMPAIGN_001', 'AGENT_001', 'answered', 120, 'SALE');

    # Check API health
    if (check_health()) {
        print "DID Optimizer API is healthy\n";
    }

=head1 DESCRIPTION

This module provides integration between VICIdial and the DID Optimizer Pro API.
It includes functions for intelligent DID selection, call result reporting, and
geographic routing based on NPANXX location data.

=head1 ENVIRONMENT VARIABLES

=over 4

=item DID_OPTIMIZER_URL

Base URL for the DID Optimizer API (required)

=item DID_OPTIMIZER_API_KEY

API key for authentication (required)

=item VICIDIAL_DB_HOST

VICIdial database host (optional, defaults to localhost)

=item VICIDIAL_DB_USER

VICIdial database username (optional, defaults to vicidial)

=item VICIDIAL_DB_PASS

VICIdial database password (optional)

=item VICIDIAL_DB_NAME

VICIdial database name (optional, defaults to asterisk)

=back

=head1 FUNCTIONS

=head2 get_next_did($campaign_id, $agent_id, $lead_data)

Returns the next available DID for the specified campaign and agent.
Optionally accepts lead geographic data for enhanced routing.

=head2 report_call_result($phone_number, $campaign_id, $agent_id, $result, $duration, $disposition)

Reports call results back to the DID Optimizer API for analytics and optimization.

=head2 get_statistics($campaign_id, $date_from, $date_to)

Retrieves performance statistics from the DID Optimizer API.

=head2 check_health()

Checks if the DID Optimizer API is healthy and responsive.

=head1 AUTHOR

DID Optimizer Pro Team

=head1 LICENSE

This software is provided under the terms of your DID Optimizer Pro license agreement.

=cut