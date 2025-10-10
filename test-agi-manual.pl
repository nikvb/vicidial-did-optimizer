#!/usr/bin/perl
#
# Manual test script for VICIdial DID Optimizer AGI
# Simulates AGI environment without Asterisk
#

use strict;
use warnings;
use lib '.';

# Simulate AGI input that Asterisk would normally provide
print "Simulating AGI environment...\n\n";

# Create mock STDIN with AGI environment variables
my $agi_input = <<'AGIINPUT';
agi_request: vicidial-did-optimizer-production.agi
agi_channel: SIP/trunk-00000001
agi_language: en
agi_type: SIP
agi_uniqueid: 1760138000.1
agi_version: 13.21.0
agi_callerid: 5551234567
agi_calleridname: Test Caller
agi_callingpres: 0
agi_callingani2: 0
agi_callington: 0
agi_callingtns: 0
agi_dnid: 18005551234
agi_rdnis: unknown
agi_context: vicidial-auto
agi_extension: 18005551234
agi_priority: 1
agi_enhanced: 0.0
agi_accountcode:
agi_threadid: 139812345678912

AGIINPUT

# Save to temp file
my $temp_input = '/tmp/agi_test_input.txt';
open(my $fh, '>', $temp_input) or die "Cannot create temp file: $!";
print $fh $agi_input;
close($fh);

print "=" x 80 . "\n";
print "RUNNING AGI SCRIPT WITH SIMULATED INPUT\n";
print "=" x 80 . "\n\n";

print "AGI Input Variables:\n";
print $agi_input;
print "\n";

print "=" x 80 . "\n";
print "EXECUTING SCRIPT...\n";
print "=" x 80 . "\n\n";

# Run the AGI script with simulated input
system("cat $temp_input | ./vicidial-did-optimizer-production.agi 2>&1");

print "\n";
print "=" x 80 . "\n";
print "SCRIPT EXECUTION COMPLETE\n";
print "=" x 80 . "\n\n";

print "Check the log file for details:\n";
print "  tail -50 /var/log/astguiclient/did-optimizer.log\n\n";

# Clean up
unlink($temp_input);
