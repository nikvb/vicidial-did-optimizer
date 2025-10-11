#!/bin/bash
#
# Simple AGI test - Simulates Asterisk calling the AGI script
#

echo "=================================================="
echo "Testing VICIdial DID Optimizer AGI Script"
echo "=================================================="
echo ""

# Create simulated AGI environment input
# Phone number comes in agi_extension with prefix (simulating 9+18005551234)
cat <<'EOF' | ./vicidial-did-optimizer-production.agi
agi_request: vicidial-did-optimizer-production.agi
agi_channel: SIP/trunk-00000123
agi_language: en
agi_type: SIP
agi_uniqueid: 1760138000.123
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
agi_extension: 918005551234
agi_priority: 1
agi_enhanced: 0.0
agi_accountcode:
agi_threadid: 139812345678912

EOF

echo ""
echo "=================================================="
echo "Script execution complete!"
echo "=================================================="
echo ""
echo "View the detailed log:"
echo "  tail -50 /var/log/astguiclient/did-optimizer.log"
echo ""
echo "Or watch it in real-time:"
echo "  tail -f /var/log/astguiclient/did-optimizer.log"
echo ""
