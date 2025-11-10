#!/bin/bash
################################################################################
# Quick VICIdial DID Optimizer Test Script
#
# Simple command-line script to quickly test the DID Optimizer API
#
# Usage:
#   ./quick-test.sh                          # Use defaults from dids.conf
#   ./quick-test.sh [campaign] [phone]       # Quick test with parameters
#
# Examples:
#   ./quick-test.sh
#   ./quick-test.sh TEST001 4155551234
#   ./quick-test.sh SALES001 2125551234 NY 10001
#
################################################################################

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Default values
CONFIG_FILE="/etc/asterisk/dids.conf"
API_URL=""
API_KEY=""
CAMPAIGN_ID="${1:-TEST001}"
AGENT_ID="1001"
CUSTOMER_PHONE="${2:-4155551234}"
CUSTOMER_STATE="${3:-CA}"
CUSTOMER_ZIP="${4:-94102}"

echo -e "${BLUE}🚀 Quick DID Optimizer Test${NC}"
echo -e "${BLUE}===========================${NC}\n"

# Load configuration
if [ -f "$CONFIG_FILE" ]; then
    echo -e "${YELLOW}📋 Loading configuration from: $CONFIG_FILE${NC}"
    API_URL=$(grep "^api_base_url=" "$CONFIG_FILE" | cut -d'=' -f2)
    API_KEY=$(grep "^api_key=" "$CONFIG_FILE" | cut -d'=' -f2)
else
    echo -e "${RED}❌ Configuration file not found: $CONFIG_FILE${NC}"
    exit 1
fi

# Validate configuration
if [ -z "$API_URL" ]; then
    echo -e "${RED}❌ API URL not configured in $CONFIG_FILE${NC}"
    exit 1
fi

if [ -z "$API_KEY" ] || [ "$API_KEY" = "YOUR_API_KEY_HERE" ]; then
    echo -e "${RED}❌ API Key not configured in $CONFIG_FILE${NC}"
    echo -e "${YELLOW}   Please set your API key in the configuration file${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Configuration loaded${NC}"
echo -e "   ${BLUE}API URL: $API_URL${NC}"
echo -e "   ${BLUE}API Key: ${API_KEY:0:10}...${NC}\n"

# Build API endpoint
BASE_URL="${API_URL%/api/v1*}"
ENDPOINT="$BASE_URL/api/v1/dids/next"

# Build query string
QUERY="campaign_id=$CAMPAIGN_ID"
QUERY="$QUERY&agent_id=$AGENT_ID"
QUERY="$QUERY&customer_phone=$CUSTOMER_PHONE"
QUERY="$QUERY&customer_state=$CUSTOMER_STATE"
QUERY="$QUERY&customer_zip=$CUSTOMER_ZIP"

FULL_URL="$ENDPOINT?$QUERY"

echo -e "${YELLOW}📞 Test Parameters:${NC}"
echo -e "   ${BLUE}Campaign ID: $CAMPAIGN_ID${NC}"
echo -e "   ${BLUE}Agent ID: $AGENT_ID${NC}"
echo -e "   ${BLUE}Customer Phone: $CUSTOMER_PHONE${NC}"
echo -e "   ${BLUE}Customer State: $CUSTOMER_STATE${NC}"
echo -e "   ${BLUE}Customer ZIP: $CUSTOMER_ZIP${NC}\n"

echo -e "${YELLOW}🌐 Making API request...${NC}"
echo -e "   ${BLUE}Endpoint: $FULL_URL${NC}\n"

# Make API request with timing
START_TIME=$(date +%s%3N)
RESPONSE=$(curl -s -w "\n%{http_code}" -H "x-api-key: $API_KEY" "$FULL_URL")
END_TIME=$(date +%s%3N)

# Parse response
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)
RESPONSE_TIME=$((END_TIME - START_TIME))

echo -e "${YELLOW}📊 Response:${NC}"
echo -e "   ${BLUE}HTTP Status: $HTTP_CODE${NC}"
echo -e "   ${BLUE}Response Time: ${RESPONSE_TIME}ms${NC}\n"

# Check HTTP status
if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✅ Success!${NC}\n"

    # Extract DID from JSON response
    SELECTED_DID=$(echo "$BODY" | grep -o '"selectedDID":"[^"]*"' | cut -d'"' -f4)
    if [ -z "$SELECTED_DID" ]; then
        SELECTED_DID=$(echo "$BODY" | grep -o '"did":"[^"]*"' | cut -d'"' -f4)
    fi

    if [ -n "$SELECTED_DID" ]; then
        echo -e "${GREEN}📱 Selected DID: $SELECTED_DID${NC}\n"
    fi

    # Pretty print JSON if jq is available
    if command -v jq >/dev/null 2>&1; then
        echo -e "${BLUE}📄 Full Response:${NC}"
        echo "$BODY" | jq '.'
    else
        echo -e "${BLUE}📄 Full Response:${NC}"
        echo "$BODY"
    fi

    echo -e "\n${GREEN}✅ Test completed successfully!${NC}"
    exit 0
else
    echo -e "${RED}❌ Request failed!${NC}\n"

    echo -e "${RED}Response Body:${NC}"
    echo "$BODY"

    echo -e "\n${YELLOW}Troubleshooting:${NC}"
    echo -e "1. Check API key is correct: sudo nano $CONFIG_FILE"
    echo -e "2. Verify API server is running: curl $BASE_URL/api/v1/health -H 'x-api-key: $API_KEY'"
    echo -e "3. Check server logs: tail -f /tmp/did-api.log"
    echo -e "4. Test network connectivity: ping $(echo $BASE_URL | sed 's|https\?://||' | cut -d'/' -f1)"

    exit 1
fi
