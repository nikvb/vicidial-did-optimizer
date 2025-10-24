#!/bin/bash

###############################################################################
# Test VICIdial Perl Sync Script
# Checks dependencies and runs a test sync
###############################################################################

echo "🧪 Testing VICIdial Call Results Sync (Perl)"
echo ""

# Check if Perl is installed
echo "1. Checking Perl installation..."
if command -v perl &> /dev/null; then
    PERL_VERSION=$(perl -v | grep 'This is perl' | head -1)
    echo "   ✓ Perl found: $PERL_VERSION"
else
    echo "   ❌ Perl not found"
    exit 1
fi

# Check required Perl modules
echo ""
echo "2. Checking Perl modules..."

check_module() {
    MODULE=$1
    perl -M$MODULE -e 'print "   ✓ '$MODULE' installed\n"' 2>/dev/null
    if [ $? -ne 0 ]; then
        echo "   ❌ $MODULE not installed"
        MISSING_MODULES="$MISSING_MODULES $MODULE"
    fi
}

MISSING_MODULES=""
check_module "DBI"
check_module "DBD::mysql"
check_module "LWP::UserAgent"
check_module "JSON"
check_module "POSIX"

if [ -n "$MISSING_MODULES" ]; then
    echo ""
    echo "❌ Missing Perl modules:$MISSING_MODULES"
    echo ""
    echo "Install with:"
    echo "   sudo cpan DBI DBD::mysql LWP::UserAgent JSON"
    echo ""
    echo "Or on Debian/Ubuntu:"
    echo "   sudo apt-get install libdbi-perl libdbd-mysql-perl libjson-perl libwww-perl"
    exit 1
fi

# Check .env file
echo ""
echo "3. Checking .env configuration..."
if [ -f /home/na/didapi/.env ]; then
    echo "   ✓ .env file found"

    # Source .env
    export $(grep -v '^#' /home/na/didapi/.env | xargs)

    if [ -z "$API_KEY" ]; then
        echo "   ⚠️  API_KEY not set in .env"
    else
        echo "   ✓ API_KEY configured"
    fi

    if [ -z "$VICIDIAL_DB_HOST" ]; then
        echo "   ℹ️  VICIDIAL_DB_HOST not set (will use default: localhost)"
    else
        echo "   ✓ VICIDIAL_DB_HOST: $VICIDIAL_DB_HOST"
    fi
else
    echo "   ⚠️  .env file not found at /home/na/didapi/.env"
fi

# Check VICIdial database connection
echo ""
echo "4. Checking VICIdial database connection..."
DB_HOST=${VICIDIAL_DB_HOST:-localhost}
DB_USER=${VICIDIAL_DB_USER:-cron}
DB_PASS=${VICIDIAL_DB_PASSWORD:-1234}
DB_NAME=${VICIDIAL_DB_NAME:-asterisk}

mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASS" -e "SELECT COUNT(*) as call_count FROM vicidial_log;" "$DB_NAME" 2>/dev/null
if [ $? -eq 0 ]; then
    echo "   ✓ VICIdial database connection successful"
else
    echo "   ❌ Cannot connect to VICIdial database"
    echo "   Host: $DB_HOST, User: $DB_USER, Database: $DB_NAME"
    exit 1
fi

# Check API endpoint
echo ""
echo "5. Checking API endpoint..."
API_URL=${DID_OPTIMIZER_API_URL:-http://localhost:5000}
if [ -n "$API_KEY" ]; then
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X GET "$API_URL/api/v1/health" -H "x-api-key: $API_KEY")
    if [ "$HTTP_CODE" -eq 200 ]; then
        echo "   ✓ API endpoint reachable: $API_URL"
    else
        echo "   ⚠️  API endpoint returned HTTP $HTTP_CODE: $API_URL"
    fi
else
    echo "   ⚠️  Cannot test API endpoint (no API_KEY)"
fi

# Test script syntax
echo ""
echo "6. Checking Perl script syntax..."
perl -c /home/na/didapi/process-call-results.pl 2>&1
if [ $? -eq 0 ]; then
    echo "   ✓ Script syntax OK"
else
    echo "   ❌ Script has syntax errors"
    exit 1
fi

# Offer to run test sync
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ All checks passed!"
echo ""
echo "To run a test sync:"
echo "   cd /home/na/didapi"
echo "   perl process-call-results.pl"
echo ""
echo "To install cron job:"
echo "   ./setup-vicidial-sync-cron.sh"
echo ""
echo "To monitor sync activity:"
echo "   tail -f /var/log/did-optimizer-sync.log"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
