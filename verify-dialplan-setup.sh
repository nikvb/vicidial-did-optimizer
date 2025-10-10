#!/bin/bash

# =====================================================
# VICIdial DID Optimizer - Dialplan Verification Script
# =====================================================
# This script verifies that the dialplan is correctly
# configured for DID Optimizer integration
# =====================================================

echo "=============================================="
echo "VICIdial DID Optimizer - Dialplan Verification"
echo "=============================================="
echo ""

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to check if running as root
check_root() {
    if [[ $EUID -ne 0 ]]; then
        echo -e "${RED}✗${NC} This script must be run as root"
        exit 1
    fi
}

# Function to print status
print_status() {
    if [ $1 -eq 0 ]; then
        echo -e "${GREEN}✓${NC} $2"
    else
        echo -e "${RED}✗${NC} $2"
        ERRORS=$((ERRORS + 1))
    fi
}

# Initialize error counter
ERRORS=0

# Check if running as root
check_root

echo "Step 1: Checking Configuration Files"
echo "------------------------------------"

# Check if configuration file exists
if [ -f "/etc/asterisk/dids.conf" ]; then
    print_status 0 "Configuration file exists: /etc/asterisk/dids.conf"

    # Validate configuration content
    API_KEY=$(grep "^api_key=" /etc/asterisk/dids.conf | cut -d'=' -f2)
    API_URL=$(grep "^api_base_url=" /etc/asterisk/dids.conf | cut -d'=' -f2)
    FALLBACK=$(grep "^fallback_did=" /etc/asterisk/dids.conf | cut -d'=' -f2)

    if [ -n "$API_KEY" ]; then
        print_status 0 "API key configured: ${API_KEY:0:20}..."
    else
        print_status 1 "API key not configured"
    fi

    if [ -n "$API_URL" ]; then
        print_status 0 "API URL configured: $API_URL"
    else
        print_status 1 "API URL not configured"
    fi

    if [ -n "$FALLBACK" ]; then
        print_status 0 "Fallback DID configured: $FALLBACK"
    else
        print_status 1 "Fallback DID not configured"
    fi
else
    print_status 1 "Configuration file not found: /etc/asterisk/dids.conf"
fi

echo ""
echo "Step 2: Checking AGI Script"
echo "------------------------------------"

# Check if AGI script exists
AGI_SCRIPT="/usr/share/astguiclient/vicidial-did-optimizer.agi"
if [ -f "$AGI_SCRIPT" ]; then
    print_status 0 "AGI script exists: $AGI_SCRIPT"

    # Check permissions
    if [ -x "$AGI_SCRIPT" ]; then
        print_status 0 "AGI script is executable"
    else
        print_status 1 "AGI script is not executable"
    fi

    # Check ownership
    OWNER=$(stat -c '%U:%G' $AGI_SCRIPT)
    if [ "$OWNER" = "asterisk:asterisk" ]; then
        print_status 0 "AGI script ownership correct: $OWNER"
    else
        print_status 1 "AGI script ownership incorrect: $OWNER (should be asterisk:asterisk)"
    fi
else
    print_status 1 "AGI script not found: $AGI_SCRIPT"
fi

# Alternative AGI script location (Perl script from existing installation)
ALT_AGI="/usr/share/astguiclient/vicidial-did-optimizer-config.pl"
if [ -f "$ALT_AGI" ]; then
    print_status 0 "Alternative AGI script found: $ALT_AGI"
fi

echo ""
echo "Step 3: Checking Dialplan Context"
echo "------------------------------------"

# Check if asterisk is running
if systemctl is-active --quiet asterisk || pgrep -x asterisk > /dev/null; then
    print_status 0 "Asterisk is running"

    # Check for did-optimizer context
    CONTEXT_CHECK=$(asterisk -rx "dialplan show did-optimizer" 2>/dev/null | grep -c "did-optimizer")
    if [ $CONTEXT_CHECK -gt 0 ]; then
        print_status 0 "Context 'did-optimizer' exists in dialplan"

        # Show context details
        echo ""
        echo -e "${YELLOW}Context Details:${NC}"
        asterisk -rx "dialplan show did-optimizer" | head -20
    else
        print_status 1 "Context 'did-optimizer' not found in dialplan"

        # Check for any DID-related contexts
        echo ""
        echo -e "${YELLOW}Searching for DID-related contexts:${NC}"
        asterisk -rx "dialplan show" | grep -i did | head -10
    fi

    # Check for AGI references in dialplan
    echo ""
    AGI_REFS=$(asterisk -rx "dialplan show" | grep -c "vicidial-did-optimizer")
    if [ $AGI_REFS -gt 0 ]; then
        print_status 0 "Found $AGI_REFS references to DID optimizer AGI in dialplan"
    else
        # Check for Perl script references
        PERL_REFS=$(asterisk -rx "dialplan show" | grep -c "vicidial-did-optimizer-config.pl")
        if [ $PERL_REFS -gt 0 ]; then
            print_status 0 "Found $PERL_REFS references to Perl DID optimizer in dialplan"
        else
            print_status 1 "No references to DID optimizer AGI found in dialplan"
        fi
    fi
else
    print_status 1 "Asterisk is not running"
fi

echo ""
echo "Step 4: Checking VICIdial Integration"
echo "------------------------------------"

# Check for VICIdial campaign custom dialplan entries
VICIDIAL_CONF="/etc/asterisk/extensions-vicidial.conf"
if [ -f "$VICIDIAL_CONF" ]; then
    print_status 0 "VICIdial extensions file exists"

    # Look for campaign contexts
    CAMPAIGN_CONTEXTS=$(grep -c "\[.*campaign.*\]" $VICIDIAL_CONF 2>/dev/null)
    if [ $CAMPAIGN_CONTEXTS -gt 0 ]; then
        print_status 0 "Found $CAMPAIGN_CONTEXTS campaign contexts"
    fi
else
    # Check alternative location
    ALT_CONF="/etc/asterisk/extensions.conf"
    if grep -q "vicidial" $ALT_CONF 2>/dev/null; then
        print_status 0 "VICIdial configuration found in extensions.conf"
    else
        print_status 1 "VICIdial configuration not found"
    fi
fi

echo ""
echo "Step 5: Testing API Connectivity"
echo "------------------------------------"

if [ -n "$API_KEY" ] && [ -n "$API_URL" ]; then
    # Test API health endpoint
    HEALTH_CHECK=$(curl -s -o /dev/null -w "%{http_code}" \
        -H "x-api-key: $API_KEY" \
        "$API_URL/api/v1/health" 2>/dev/null)

    if [ "$HEALTH_CHECK" = "200" ]; then
        print_status 0 "API health check successful (HTTP $HEALTH_CHECK)"
    else
        print_status 1 "API health check failed (HTTP $HEALTH_CHECK)"
    fi

    # Test DID selection endpoint
    DID_TEST=$(curl -s -X GET \
        -H "x-api-key: $API_KEY" \
        "$API_URL/api/v1/dids/next?campaign_id=TEST&agent_id=1001" 2>/dev/null)

    if echo "$DID_TEST" | grep -q "phoneNumber"; then
        print_status 0 "DID selection endpoint working"
        DID_NUMBER=$(echo "$DID_TEST" | grep -o '"phoneNumber":"[^"]*"' | cut -d'"' -f4)
        echo -e "  Selected DID: ${GREEN}$DID_NUMBER${NC}"
    else
        print_status 1 "DID selection endpoint not responding correctly"
    fi
else
    print_status 1 "Cannot test API - missing configuration"
fi

echo ""
echo "Step 6: Checking Log Files"
echo "------------------------------------"

# Check log directory
LOG_DIR="/var/log/astguiclient"
if [ -d "$LOG_DIR" ]; then
    print_status 0 "Log directory exists: $LOG_DIR"

    # Check for DID optimizer log
    if [ -f "$LOG_DIR/did-optimizer.log" ]; then
        print_status 0 "DID optimizer log exists"

        # Check if log is being written
        LOG_AGE=$(find "$LOG_DIR/did-optimizer.log" -mmin -60 | wc -l)
        if [ $LOG_AGE -gt 0 ]; then
            print_status 0 "Log file updated within last hour"
        else
            echo -e "${YELLOW}!${NC} Log file not updated recently"
        fi

        # Show recent errors
        ERROR_COUNT=$(tail -100 "$LOG_DIR/did-optimizer.log" 2>/dev/null | grep -c ERROR)
        if [ $ERROR_COUNT -gt 0 ]; then
            echo -e "${YELLOW}!${NC} Found $ERROR_COUNT errors in recent logs"
            echo "Recent errors:"
            tail -100 "$LOG_DIR/did-optimizer.log" | grep ERROR | tail -3
        fi
    else
        print_status 1 "DID optimizer log not found"
    fi
else
    print_status 1 "Log directory not found: $LOG_DIR"
fi

echo ""
echo "Step 7: Checking Permissions"
echo "------------------------------------"

# Check directory permissions
DIRS_TO_CHECK=(
    "/var/log/astguiclient"
    "/usr/share/astguiclient"
    "/etc/asterisk"
)

for DIR in "${DIRS_TO_CHECK[@]}"; do
    if [ -d "$DIR" ]; then
        OWNER=$(stat -c '%U' "$DIR")
        if [ "$OWNER" = "asterisk" ] || [ "$OWNER" = "root" ]; then
            print_status 0 "$DIR ownership: $OWNER"
        else
            print_status 1 "$DIR ownership incorrect: $OWNER"
        fi
    fi
done

echo ""
echo "Step 8: Quick Functionality Test"
echo "------------------------------------"

# Create a test AGI call if possible
if [ -x "$AGI_SCRIPT" ] && [ -n "$API_KEY" ]; then
    echo "Attempting to test AGI script..."

    # Create test input
    TEST_INPUT=$(cat <<EOF
agi_request: vicidial-did-optimizer.agi
agi_channel: TEST/verification
agi_language: en
agi_type: TEST
agi_uniqueid: $(date +%s).1
agi_callerid: 4155551234
agi_context: test
agi_extension: 8005551234
agi_priority: 1

EOF
)

    # Run test
    export CAMPAIGN_ID="TEST001"
    export AGENT_USER="1001"

    TEST_OUTPUT=$(echo "$TEST_INPUT" | sudo -u asterisk $AGI_SCRIPT 2>&1)

    if echo "$TEST_OUTPUT" | grep -q "OPTIMIZER_DID"; then
        print_status 0 "AGI script test successful"
        echo "$TEST_OUTPUT" | grep OPTIMIZER
    else
        print_status 1 "AGI script test failed"
    fi
else
    echo -e "${YELLOW}!${NC} Cannot perform AGI test - missing requirements"
fi

echo ""
echo "=============================================="
echo "Verification Summary"
echo "=============================================="

if [ $ERRORS -eq 0 ]; then
    echo -e "${GREEN}✓ All checks passed!${NC}"
    echo "The DID Optimizer dialplan appears to be correctly configured."
else
    echo -e "${RED}✗ Found $ERRORS issue(s)${NC}"
    echo ""
    echo "Recommended actions:"

    if [ ! -f "/etc/asterisk/dids.conf" ]; then
        echo "1. Create configuration file: /etc/asterisk/dids.conf"
    fi

    if [ ! -f "$AGI_SCRIPT" ]; then
        echo "2. Install AGI script: $AGI_SCRIPT"
    fi

    if [ $CONTEXT_CHECK -eq 0 ] 2>/dev/null; then
        echo "3. Add 'did-optimizer' context to dialplan"
    fi

    echo ""
    echo "Run the installation script to fix these issues:"
    echo "  sudo ./install-vicidial-integration.sh"
fi

echo ""
echo "For detailed setup instructions, see:"
echo "  - VICIDIAL-DIALPLAN-SETUP.md"
echo "  - AGI-SCRIPT-CONFIGURATION.md"
echo ""

exit $ERRORS