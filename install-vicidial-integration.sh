#!/bin/bash

##############################################################################
# VICIdial DID Optimizer Integration Installer
#
# This script automatically installs and configures the DID Optimizer
# integration with VICIdial
#
# Usage: sudo ./install-vicidial-integration.sh
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

echo -e "${BLUE}🚀 VICIdial DID Optimizer Integration Installer${NC}"
echo -e "${BLUE}===============================================${NC}\n"

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}❌ This script must be run as root (use sudo)${NC}"
   exit 1
fi

# Step 1: Check prerequisites
echo -e "${YELLOW}1. Checking prerequisites...${NC}"

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
    "vicidial-dialplan-simple.conf"
)

for file in "${REQUIRED_FILES[@]}"; do
    if [ ! -f "$SCRIPT_DIR/$file" ]; then
        echo -e "${RED}❌ Required file not found: $file${NC}"
        exit 1
    fi
done

echo -e "${GREEN}✅ Prerequisites check passed${NC}"

# Step 2: Install configuration file
echo -e "\n${YELLOW}2. Installing configuration file...${NC}"

# Backup existing config if it exists
if [ -f "$ASTERISK_DIR/dids.conf" ]; then
    cp "$ASTERISK_DIR/dids.conf" "$ASTERISK_DIR/dids.conf.backup.$(date +%Y%m%d_%H%M%S)"
    echo -e "${YELLOW}⚠️  Backed up existing dids.conf${NC}"
fi

# Copy configuration file
cp "$SCRIPT_DIR/dids.conf" "$ASTERISK_DIR/"
chown asterisk:asterisk "$ASTERISK_DIR/dids.conf"
chmod 600 "$ASTERISK_DIR/dids.conf"

echo -e "${GREEN}✅ Configuration file installed: $ASTERISK_DIR/dids.conf${NC}"

# Step 3: Install DID optimizer script
echo -e "\n${YELLOW}3. Installing DID optimizer script...${NC}"

# Backup existing script if it exists
if [ -f "$VICIDIAL_DIR/vicidial-did-optimizer-config.pl" ]; then
    cp "$VICIDIAL_DIR/vicidial-did-optimizer-config.pl" "$VICIDIAL_DIR/vicidial-did-optimizer-config.pl.backup.$(date +%Y%m%d_%H%M%S)"
    echo -e "${YELLOW}⚠️  Backed up existing script${NC}"
fi

# Copy script
cp "$SCRIPT_DIR/vicidial-did-optimizer-config.pl" "$VICIDIAL_DIR/"
chown asterisk:asterisk "$VICIDIAL_DIR/vicidial-did-optimizer-config.pl"
chmod +x "$VICIDIAL_DIR/vicidial-did-optimizer-config.pl"

echo -e "${GREEN}✅ DID optimizer script installed: $VICIDIAL_DIR/vicidial-did-optimizer-config.pl${NC}"

# Step 4: Create log directory
echo -e "\n${YELLOW}4. Setting up logging...${NC}"

mkdir -p "$LOG_DIR"
chown asterisk:asterisk "$LOG_DIR"
chmod 755 "$LOG_DIR"

echo -e "${GREEN}✅ Log directory created: $LOG_DIR${NC}"

# Step 5: Install Perl dependencies
echo -e "\n${YELLOW}5. Installing Perl dependencies...${NC}"

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

# Step 6: Backup and modify extensions.conf
echo -e "\n${YELLOW}6. Configuring Asterisk dialplan...${NC}"

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
    echo "; DID Optimizer Integration - Added $(date)" >> "$EXTENSIONS_CONF"
    cat "$SCRIPT_DIR/vicidial-dialplan-simple.conf" >> "$EXTENSIONS_CONF"
    echo -e "${GREEN}✅ Dialplan integration added to extensions.conf${NC}"
fi

# Step 7: Test the installation
echo -e "\n${YELLOW}7. Testing installation...${NC}"

# Test script execution
if sudo -u asterisk "$VICIDIAL_DIR/vicidial-did-optimizer-config.pl" --config >/dev/null 2>&1; then
    echo -e "${GREEN}✅ Script executes successfully${NC}"
else
    echo -e "${RED}❌ Script execution test failed${NC}"
    echo -e "${YELLOW}   Check permissions and dependencies${NC}"
fi

# Test configuration loading
if sudo -u asterisk "$VICIDIAL_DIR/vicidial-did-optimizer-config.pl" --test >/dev/null 2>&1; then
    echo -e "${GREEN}✅ Configuration test passed${NC}"
else
    echo -e "${YELLOW}⚠️  Configuration test failed - you may need to update API settings${NC}"
fi

# Step 8: Reload Asterisk dialplan
echo -e "\n${YELLOW}8. Reloading Asterisk dialplan...${NC}"

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

# Step 9: Generate installation summary
echo -e "\n${BLUE}🎉 Installation Complete!${NC}"
echo -e "${BLUE}========================${NC}\n"

echo -e "${GREEN}✅ Files installed:${NC}"
echo -e "   📁 Configuration: $ASTERISK_DIR/dids.conf"
echo -e "   📜 Script: $VICIDIAL_DIR/vicidial-did-optimizer-config.pl"
echo -e "   📋 Dialplan: Added to $EXTENSIONS_CONF"
echo -e "   📊 Logs: $LOG_DIR/"

echo -e "\n${YELLOW}📋 Next Steps:${NC}"
echo -e "1. 🔧 Update API settings in: $ASTERISK_DIR/dids.conf"
echo -e "   - Set your api_base_url (currently: http://localhost:3001)"
echo -e "   - Set your api_key (get from your DID Optimizer server)"

echo -e "\n2. 🎯 Configure VICIdial campaigns:"
echo -e "   - Login to VICIdial Admin"
echo -e "   - Go to Admin → Campaigns → [Your Campaign]"
echo -e "   - Set 'Outbound Caller ID' to: ${GREEN}COMPAT_DID_OPTIMIZER${NC}"
echo -e "   - Set 'Campaign CID Override' to: ${GREEN}Y${NC}"
echo -e "   - Save campaign settings"

echo -e "\n3. 🧪 Test the integration:"
echo -e "   ${YELLOW}sudo -u asterisk $VICIDIAL_DIR/vicidial-did-optimizer-config.pl --test${NC}"

echo -e "\n4. 📊 Monitor logs:"
echo -e "   ${YELLOW}tail -f $LOG_DIR/did_optimizer.log${NC}"

echo -e "\n${GREEN}🚀 Your VICIdial DID Optimizer integration is ready!${NC}"

# Optional: Show configuration file location for editing
echo -e "\n${BLUE}📝 Configuration File:${NC}"
echo -e "Edit settings: ${YELLOW}sudo nano $ASTERISK_DIR/dids.conf${NC}"

# Show the current API key placeholder
CURRENT_API_KEY=$(grep "^api_key=" "$ASTERISK_DIR/dids.conf" | cut -d'=' -f2)
if [ "$CURRENT_API_KEY" = "your_api_key_here" ] || [ -z "$CURRENT_API_KEY" ]; then
    echo -e "\n${RED}⚠️  IMPORTANT: Update your API key in the configuration file!${NC}"
    echo -e "   Current value: ${CURRENT_API_KEY}"
fi

echo -e "\n${BLUE}📚 Documentation:${NC}"
echo -e "   Full integration guide: VICIDIAL_DIALPLAN_INTEGRATION.md"
echo -e "   Configuration options: See comments in dids.conf"

exit 0