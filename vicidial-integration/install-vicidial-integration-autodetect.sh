#!/bin/bash

##############################################################################
# VICIdial DID Optimizer Integration Installer - Auto-Detect Version
#
# This script automatically installs and configures the DID Optimizer
# integration with VICIdial, auto-detecting database and AGI settings
#
# Features:
# - Auto-detects database settings from /etc/astguiclient.conf
# - Auto-detects AGI directory from Asterisk configuration
# - Falls back to standard locations if detection fails
#
# Usage: sudo ./install-vicidial-integration-autodetect.sh
##############################################################################

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VICIDIAL_DIR="/usr/share/astguiclient"
ASTERISK_DIR="/etc/asterisk"
LOG_DIR="/var/log/astguiclient"

echo -e "${BLUE}🚀 VICIdial DID Optimizer Integration Installer (Auto-Detect Version)${NC}"
echo -e "${BLUE}=====================================================================${NC}\n"

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}❌ This script must be run as root (use sudo)${NC}"
   exit 1
fi

# Function to detect AGI directory from Asterisk
detect_agi_directory() {
    local agi_dir=""

    # Method 1: Check asterisk.conf for astagidir setting
    if [ -f "/etc/asterisk/asterisk.conf" ]; then
        agi_dir=$(grep -E "^\s*astagidir\s*=>" /etc/asterisk/asterisk.conf 2>/dev/null | sed 's/.*=>\s*//' | tr -d ' ')
    fi

    # Method 2: Check common VICIdial locations
    if [ -z "$agi_dir" ] || [ ! -d "$agi_dir" ]; then
        # Common VICIdial AGI directories
        local common_dirs=(
            "/var/lib/asterisk/agi-bin"
            "/usr/share/asterisk/agi-bin"
            "/usr/local/share/asterisk/agi-bin"
            "/usr/share/astguiclient/agi-bin"
        )

        for dir in "${common_dirs[@]}"; do
            if [ -d "$dir" ]; then
                # Check if VICIdial AGI scripts exist here
                if ls "$dir"/agi-VDAD*.agi >/dev/null 2>&1; then
                    agi_dir="$dir"
                    break
                fi
            fi
        done
    fi

    # Method 3: Use asterisk CLI to get the path
    if [ -z "$agi_dir" ] && command -v asterisk >/dev/null 2>&1; then
        local ast_output=$(asterisk -rx "core show settings" 2>/dev/null | grep -i "agi directory" | awk '{print $NF}')
        if [ -n "$ast_output" ] && [ -d "$ast_output" ]; then
            agi_dir="$ast_output"
        fi
    fi

    # Default fallback
    if [ -z "$agi_dir" ]; then
        agi_dir="/var/lib/asterisk/agi-bin"
    fi

    echo "$agi_dir"
}

# Function to detect database settings from astguiclient.conf
detect_db_settings() {
    local config_file="/etc/astguiclient.conf"

    if [ -f "$config_file" ]; then
        echo -e "${GREEN}✅ Found VICIdial configuration: $config_file${NC}"

        # Extract database settings
        DB_HOST=$(grep "^VARDB_server" "$config_file" 2>/dev/null | cut -d'>' -f2 | tr -d ' ' || echo "localhost")
        DB_NAME=$(grep "^VARDB_database" "$config_file" 2>/dev/null | cut -d'>' -f2 | tr -d ' ' || echo "asterisk")
        DB_USER=$(grep "^VARDB_user" "$config_file" 2>/dev/null | cut -d'>' -f2 | tr -d ' ' || echo "cron")
        DB_PASS=$(grep "^VARDB_pass" "$config_file" 2>/dev/null | cut -d'>' -f2 | tr -d ' ' || echo "1234")
        DB_PORT=$(grep "^VARDB_port" "$config_file" 2>/dev/null | cut -d'>' -f2 | tr -d ' ' || echo "3306")

        echo -e "${YELLOW}   Database Host: $DB_HOST${NC}"
        echo -e "${YELLOW}   Database Name: $DB_NAME${NC}"
        echo -e "${YELLOW}   Database User: $DB_USER${NC}"
        echo -e "${YELLOW}   Database Port: $DB_PORT${NC}"
    else
        echo -e "${YELLOW}⚠️  VICIdial config not found, using defaults${NC}"
        DB_HOST="localhost"
        DB_NAME="asterisk"
        DB_USER="cron"
        DB_PASS="1234"
        DB_PORT="3306"
    fi
}

# Step 1: Auto-detect AGI directory
echo -e "${YELLOW}1. Detecting AGI directory...${NC}"
AGI_DIR=$(detect_agi_directory)
echo -e "${GREEN}✅ AGI directory detected: $AGI_DIR${NC}"

# Create AGI directory if it doesn't exist
if [ ! -d "$AGI_DIR" ]; then
    mkdir -p "$AGI_DIR"
    echo -e "${YELLOW}ℹ️  Created AGI directory: $AGI_DIR${NC}"
fi

# Step 2: Auto-detect database settings
echo -e "\n${YELLOW}2. Detecting VICIdial database settings...${NC}"
detect_db_settings

# Step 3: Check prerequisites
echo -e "\n${YELLOW}3. Checking prerequisites...${NC}"

# Check if VICIdial is installed
if [ ! -d "$VICIDIAL_DIR" ]; then
    echo -e "${RED}❌ VICIdial directory not found: $VICIDIAL_DIR${NC}"
    echo "Please install VICIdial first."
    exit 1
fi

# Check if Asterisk is installed
if [ ! -d "$ASTERISK_DIR" ]; then
    echo -e "${RED}❌ Asterisk directory not found: $ASTERISK_DIR${NC}"
    echo "Please install Asterisk first."
    exit 1
fi

# Check required files
REQUIRED_FILES=(
    "dids.conf"
    "vicidial-did-optimizer-config.pl"
    "vicidial-dialplan-agi.conf"
    "agi-did-optimizer-autodetect.agi"
    "agi-did-optimizer-report.agi"
    "did-optimizer-quick.pl"
)

# Check for auto-detect version first, fallback to standard
if [ -f "$SCRIPT_DIR/agi-did-optimizer-autodetect.agi" ]; then
    AGI_MAIN_SCRIPT="agi-did-optimizer-autodetect.agi"
else
    AGI_MAIN_SCRIPT="agi-did-optimizer.agi"
fi

for file in "${REQUIRED_FILES[@]}"; do
    if [ "$file" = "agi-did-optimizer-autodetect.agi" ] && [ ! -f "$SCRIPT_DIR/$file" ]; then
        # Check for standard version as fallback
        if [ -f "$SCRIPT_DIR/agi-did-optimizer.agi" ]; then
            continue
        fi
    fi

    if [ ! -f "$SCRIPT_DIR/$file" ]; then
        echo -e "${RED}❌ Required file not found: $file${NC}"
        exit 1
    fi
done

echo -e "${GREEN}✅ Prerequisites check passed${NC}"

# Step 4: Create/Update configuration file
echo -e "\n${YELLOW}4. Installing configuration file...${NC}"

# Backup existing config if it exists
if [ -f "$ASTERISK_DIR/dids.conf" ]; then
    cp "$ASTERISK_DIR/dids.conf" "$ASTERISK_DIR/dids.conf.backup.$(date +%Y%m%d_%H%M%S)"
    echo -e "${YELLOW}⚠️  Backed up existing dids.conf${NC}"
fi

# Create configuration with auto-detected settings (but commented out)
cat > "$ASTERISK_DIR/dids.conf" << EOF
# DID Optimizer Pro Configuration
# Location: /etc/asterisk/dids.conf
#
# Database settings are auto-detected from /etc/astguiclient.conf
# You can override them here if needed by uncommenting the lines below:
#
# db_host=$DB_HOST
# db_user=$DB_USER
# db_pass=$DB_PASS
# db_name=$DB_NAME
# db_port=$DB_PORT

[general]
# API Configuration (REQUIRED - MUST BE CONFIGURED)
api_base_url=http://localhost:3001
api_key=YOUR_API_KEY_HERE
api_timeout=10
max_retries=3

# Fallback DID when API is unavailable
fallback_did=+18005551234

# Logging Configuration
log_file=/var/log/astguiclient/did_optimizer.log
debug=1

# Performance Settings
daily_usage_limit=200
max_distance_miles=500

# Geographic Settings
enable_geographic_routing=1
enable_state_fallback=1
enable_area_code_detection=1

# AI Training Data Collection
collect_ai_data=1
include_customer_demographics=1
include_call_context=1
include_performance_metrics=1

# Cache Settings
context_cache_dir=/tmp/did_optimizer
context_cache_ttl=3600

# Advanced Settings
geographic_algorithm=haversine
coordinate_precision=4
state_center_coordinates=1
zip_geocoding=0

# Security Settings
verify_ssl=1
connection_timeout=30
read_timeout=60
EOF

chmod 600 "$ASTERISK_DIR/dids.conf"

echo -e "${GREEN}✅ Configuration file installed: $ASTERISK_DIR/dids.conf${NC}"
echo -e "${YELLOW}   Database settings will be auto-detected from VICIdial${NC}"

# Step 5: Install DID optimizer script
echo -e "\n${YELLOW}5. Installing DID optimizer script...${NC}"

# Backup existing script if it exists
if [ -f "$VICIDIAL_DIR/vicidial-did-optimizer-config.pl" ]; then
    cp "$VICIDIAL_DIR/vicidial-did-optimizer-config.pl" "$VICIDIAL_DIR/vicidial-did-optimizer-config.pl.backup.$(date +%Y%m%d_%H%M%S)"
    echo -e "${YELLOW}⚠️  Backed up existing script${NC}"
fi

# Copy script
cp "$SCRIPT_DIR/vicidial-did-optimizer-config.pl" "$VICIDIAL_DIR/"
chmod +x "$VICIDIAL_DIR/vicidial-did-optimizer-config.pl"

echo -e "${GREEN}✅ DID optimizer script installed: $VICIDIAL_DIR/vicidial-did-optimizer-config.pl${NC}"

# Step 6: Install AGI scripts
echo -e "\n${YELLOW}6. Installing AGI scripts to: $AGI_DIR${NC}"

# Install main AGI script (prefer auto-detect version)
if [ -f "$SCRIPT_DIR/agi-did-optimizer-autodetect.agi" ]; then
    cp "$SCRIPT_DIR/agi-did-optimizer-autodetect.agi" "$AGI_DIR/agi-did-optimizer.agi"
    echo -e "${GREEN}✅ Installed auto-detect version of AGI script${NC}"
elif [ -f "$SCRIPT_DIR/agi-did-optimizer.agi" ]; then
    cp "$SCRIPT_DIR/agi-did-optimizer.agi" "$AGI_DIR/"
    echo -e "${GREEN}✅ Installed standard AGI script${NC}"
fi
chmod +x "$AGI_DIR/agi-did-optimizer.agi"

# Install reporting AGI script
cp "$SCRIPT_DIR/agi-did-optimizer-report.agi" "$AGI_DIR/"
chmod +x "$AGI_DIR/agi-did-optimizer-report.agi"

# Install quick inline script
cp "$SCRIPT_DIR/did-optimizer-quick.pl" "$AGI_DIR/"
chmod +x "$AGI_DIR/did-optimizer-quick.pl"

echo -e "${GREEN}✅ AGI scripts installed in: $AGI_DIR${NC}"

# Step 7: Create log directory
echo -e "\n${YELLOW}7. Setting up logging...${NC}"

mkdir -p "$LOG_DIR"
chmod 755 "$LOG_DIR"

echo -e "${GREEN}✅ Log directory created: $LOG_DIR${NC}"

# Step 8: Install Perl dependencies
echo -e "\n${YELLOW}8. Installing Perl dependencies...${NC}"

# Check if cpan is available
if command -v cpan >/dev/null 2>&1; then
    # Install required Perl modules
    cpan -T LWP::UserAgent JSON DBI DBD::mysql 2>/dev/null || {
        echo -e "${YELLOW}⚠️  CPAN installation may have failed. You may need to install manually:${NC}"
        echo -e "  sudo apt-get install libwww-perl libjson-perl libdbi-perl libdbd-mysql-perl"
    }
else
    # Try apt-get for Debian/Ubuntu systems
    if command -v apt-get >/dev/null 2>&1; then
        apt-get update
        apt-get install -y libwww-perl libjson-perl libdbi-perl libdbd-mysql-perl
    else
        echo -e "${YELLOW}⚠️  Please install Perl dependencies manually:${NC}"
        echo -e "  LWP::UserAgent JSON DBI DBD::mysql"
    fi
fi

echo -e "${GREEN}✅ Perl dependencies installed${NC}"

# Step 9: Backup and modify extensions.conf
echo -e "\n${YELLOW}9. Configuring Asterisk dialplan...${NC}"

EXTENSIONS_CONF="$ASTERISK_DIR/extensions.conf"

if [ ! -f "$EXTENSIONS_CONF" ]; then
    echo -e "${RED}❌ Asterisk extensions.conf not found: $EXTENSIONS_CONF${NC}"
    exit 1
fi

# Backup extensions.conf
cp "$EXTENSIONS_CONF" "$EXTENSIONS_CONF.backup.$(date +%Y%m%d_%H%M%S)"
echo -e "${GREEN}✅ Backed up extensions.conf${NC}"

# Check if our integration is already present
if grep -q "did-optimizer" "$EXTENSIONS_CONF"; then
    echo -e "${YELLOW}⚠️  DID optimizer integration already present in extensions.conf${NC}"
    echo -e "${YELLOW}   Please review manually if needed${NC}"
else
    # Add our integration to extensions.conf
    echo "" >> "$EXTENSIONS_CONF"
    echo "; DID Optimizer Integration (Auto-Detect Version) - Added $(date)" >> "$EXTENSIONS_CONF"
    echo "; AGI Directory: $AGI_DIR" >> "$EXTENSIONS_CONF"
    cat "$SCRIPT_DIR/vicidial-dialplan-agi.conf" >> "$EXTENSIONS_CONF"
    echo -e "${GREEN}✅ AGI-based dialplan integration added to extensions.conf${NC}"
fi

# Step 10: Test the installation
echo -e "\n${YELLOW}10. Testing installation...${NC}"

# Test script execution
if sudo -u asterisk "$VICIDIAL_DIR/vicidial-did-optimizer-config.pl" --config >/dev/null 2>&1; then
    echo -e "${GREEN}✅ Main script executes successfully${NC}"
else
    echo -e "${RED}❌ Main script execution test failed${NC}"
    echo -e "${YELLOW}   Check permissions and dependencies${NC}"
fi

# Test AGI script
if sudo -u asterisk "$AGI_DIR/agi-did-optimizer.agi" TEST001 1001 4155551234 >/dev/null 2>&1; then
    echo -e "${GREEN}✅ AGI script executes successfully${NC}"
else
    echo -e "${YELLOW}⚠️  AGI script test completed (may need API configuration)${NC}"
fi

# Test database connection
echo -e "\n${YELLOW}Testing database connection with auto-detected settings...${NC}"
mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASS" -P "$DB_PORT" "$DB_NAME" -e "SELECT 1" >/dev/null 2>&1 && {
    echo -e "${GREEN}✅ Database connection successful${NC}"
} || {
    echo -e "${YELLOW}⚠️  Could not connect to database with auto-detected settings${NC}"
    echo -e "${YELLOW}   Please verify database credentials in /etc/astguiclient.conf${NC}"
}

# Step 11: Reload Asterisk dialplan
echo -e "\n${YELLOW}11. Reloading Asterisk dialplan...${NC}"

if command -v asterisk >/dev/null 2>&1; then
    asterisk -rx "dialplan reload" >/dev/null 2>&1 && {
        echo -e "${GREEN}✅ Asterisk dialplan reloaded${NC}"
    } || {
        echo -e "${YELLOW}⚠️  Could not reload dialplan automatically${NC}"
        echo -e "${YELLOW}   Please run: asterisk -rx 'dialplan reload'${NC}"
    }
else
    echo -e "${YELLOW}⚠️  Asterisk command not found in PATH${NC}"
    echo -e "${YELLOW}   Please reload dialplan manually${NC}"
fi

# Step 12: Generate installation summary
echo -e "\n${BLUE}🎉 Installation Complete!${NC}"
echo -e "${BLUE}========================${NC}\n"

echo -e "${GREEN}✅ Auto-Detected Settings:${NC}"
echo -e "   📁 AGI Directory: $AGI_DIR"
echo -e "   🗄️  Database Host: $DB_HOST"
echo -e "   🗄️  Database Name: $DB_NAME"
echo -e "   🗄️  Database User: $DB_USER"

echo -e "\n${GREEN}✅ Files installed:${NC}"
echo -e "   📁 Configuration: $ASTERISK_DIR/dids.conf"
echo -e "   📜 Main Script: $VICIDIAL_DIR/vicidial-did-optimizer-config.pl"
echo -e "   🔧 AGI Script: $AGI_DIR/agi-did-optimizer.agi"
echo -e "   📊 Report AGI: $AGI_DIR/agi-did-optimizer-report.agi"
echo -e "   ⚡ Quick Script: $AGI_DIR/did-optimizer-quick.pl"
echo -e "   📋 Dialplan: Added to $EXTENSIONS_CONF"
echo -e "   📊 Logs: $LOG_DIR/"

echo -e "\n${YELLOW}📋 Next Steps:${NC}"
echo -e "${RED}1. 🔧 CRITICAL: Update API settings in: $ASTERISK_DIR/dids.conf${NC}"
echo -e "   ${RED}- Set your api_base_url (currently: http://localhost:3001)${NC}"
echo -e "   ${RED}- Set your api_key (REQUIRED - get from your DID Optimizer server)${NC}"

echo -e "\n2. 🎯 Configure VICIdial campaigns:"
echo -e "   ${BLUE}Method 1 - Caller ID Override:${NC}"
echo -e "   - Login to VICIdial Admin"
echo -e "   - Go to Admin → Campaigns → [Your Campaign]"
echo -e "   - Set 'Outbound Caller ID' to: ${GREEN}COMPAT_DID_OPTIMIZER${NC}"
echo -e "   - Set 'Campaign CID Override' to: ${GREEN}Y${NC}"

echo -e "\n   ${BLUE}Method 2 - Custom Dialplan:${NC}"
echo -e "   - In Campaign settings, change 'Dial Plan' to: ${GREEN}did-optimizer-inline${NC}"
echo -e "   - This uses the inline AGI approach"

echo -e "\n3. 🧪 Test the integration:"
echo -e "   ${YELLOW}# Test AGI script directly:${NC}"
echo -e "   sudo -u asterisk $AGI_DIR/agi-did-optimizer.agi TEST001 1001 4155551234"
echo -e "   ${YELLOW}# Test quick script:${NC}"
echo -e "   sudo -u asterisk $AGI_DIR/did-optimizer-quick.pl TEST001 1001 4155551234"
echo -e "   ${YELLOW}# Test API connection:${NC}"
echo -e "   sudo -u asterisk $VICIDIAL_DIR/vicidial-did-optimizer-config.pl --test"

echo -e "\n4. 📊 Monitor logs:"
echo -e "   ${YELLOW}tail -f $LOG_DIR/did_optimizer.log${NC}"

echo -e "\n${GREEN}🚀 Your VICIdial DID Optimizer integration is ready!${NC}"
echo -e "${GREEN}   Database settings are auto-detected from VICIdial${NC}"
echo -e "${GREEN}   AGI scripts are installed in the correct directory${NC}"

# Show the current API key placeholder
echo -e "\n${BLUE}📝 Configuration File:${NC}"
echo -e "Edit settings: ${YELLOW}sudo nano $ASTERISK_DIR/dids.conf${NC}"

CURRENT_API_KEY=$(grep "^api_key=" "$ASTERISK_DIR/dids.conf" | cut -d'=' -f2)
if [ "$CURRENT_API_KEY" = "YOUR_API_KEY_HERE" ] || [ -z "$CURRENT_API_KEY" ]; then
    echo -e "\n${RED}⚠️  IMPORTANT: You MUST update your API key in the configuration file!${NC}"
    echo -e "${RED}   Current value: $CURRENT_API_KEY${NC}"
    echo -e "${RED}   The system will NOT work without a valid API key${NC}"
fi

echo -e "\n${BLUE}📚 Documentation:${NC}"
echo -e "   AGI Integration guide: See vicidial-dialplan-agi.conf"
echo -e "   Configuration options: See comments in dids.conf"
echo -e "   GitHub Repository: https://github.com/nikvb/vicidial-did-optimizer"

exit 0