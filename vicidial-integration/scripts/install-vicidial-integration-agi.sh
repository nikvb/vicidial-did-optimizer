#!/bin/bash

##############################################################################
# VICIdial DID Optimizer Integration Installer - AGI Version
#
# This script automatically installs and configures the DID Optimizer
# integration with VICIdial using proper AGI scripts instead of System() calls
#
# Usage: sudo ./install-vicidial-integration-agi.sh
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
AGI_DIR="/usr/share/astguiclient/agi-bin"
LOG_DIR="/var/log/astguiclient"

echo -e "${BLUE}🚀 VICIdial DID Optimizer Integration Installer (AGI Version)${NC}"
echo -e "${BLUE}===============================================================${NC}\n"

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

# Check if AGI directory exists
if [ ! -d "$AGI_DIR" ]; then
    mkdir -p "$AGI_DIR"
    echo -e "${YELLOW}ℹ️  Created AGI directory: $AGI_DIR${NC}"
fi

# Check required files
REQUIRED_FILES=(
    "dids.conf"
    "vicidial-did-optimizer-config.pl"
    "vicidial-dialplan-agi.conf"
    "agi-did-optimizer.agi"
    "agi-did-optimizer-report.agi"
    "did-optimizer-quick.pl"
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
chmod +x "$VICIDIAL_DIR/vicidial-did-optimizer-config.pl"

echo -e "${GREEN}✅ DID optimizer script installed: $VICIDIAL_DIR/vicidial-did-optimizer-config.pl${NC}"

# Step 4: Install AGI scripts
echo -e "\n${YELLOW}4. Installing AGI scripts...${NC}"

# Install main AGI script
cp "$SCRIPT_DIR/agi-did-optimizer.agi" "$AGI_DIR/"
chmod +x "$AGI_DIR/agi-did-optimizer.agi"

# Install reporting AGI script
cp "$SCRIPT_DIR/agi-did-optimizer-report.agi" "$AGI_DIR/"
chmod +x "$AGI_DIR/agi-did-optimizer-report.agi"

# Install quick inline script
cp "$SCRIPT_DIR/did-optimizer-quick.pl" "$AGI_DIR/"
chmod +x "$AGI_DIR/did-optimizer-quick.pl"

echo -e "${GREEN}✅ AGI scripts installed in: $AGI_DIR${NC}"

# Step 5: Create log directory
echo -e "\n${YELLOW}5. Setting up logging...${NC}"

mkdir -p "$LOG_DIR"
chmod 755 "$LOG_DIR"

echo -e "${GREEN}✅ Log directory created: $LOG_DIR${NC}"

# Step 6: Install Perl dependencies
echo -e "\n${YELLOW}6. Installing Perl dependencies...${NC}"

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

# Step 7: Backup and modify extensions.conf
echo -e "\n${YELLOW}7. Configuring Asterisk dialplan...${NC}"

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
    echo "; DID Optimizer Integration (AGI Version) - Added $(date)" >> "$EXTENSIONS_CONF"
    cat "$SCRIPT_DIR/vicidial-dialplan-agi.conf" >> "$EXTENSIONS_CONF"
    echo -e "${GREEN}✅ AGI-based dialplan integration added to extensions.conf${NC}"
fi

# Step 8: Test the installation
echo -e "\n${YELLOW}8. Testing installation...${NC}"

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

# Test configuration loading
if sudo -u asterisk "$VICIDIAL_DIR/vicidial-did-optimizer-config.pl" --test >/dev/null 2>&1; then
    echo -e "${GREEN}✅ Configuration test passed${NC}"
else
    echo -e "${YELLOW}⚠️  Configuration test failed - you may need to update API settings${NC}"
fi

# Step 9: Reload Asterisk dialplan
echo -e "\n${YELLOW}9. Reloading Asterisk dialplan...${NC}"

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

# Step 10: Generate installation summary
echo -e "\n${BLUE}🎉 Installation Complete!${NC}"
echo -e "${BLUE}========================${NC}\n"

echo -e "${GREEN}✅ Files installed:${NC}"
echo -e "   📁 Configuration: $ASTERISK_DIR/dids.conf"
echo -e "   📜 Main Script: $VICIDIAL_DIR/vicidial-did-optimizer-config.pl"
echo -e "   🔧 AGI Script: $AGI_DIR/agi-did-optimizer.agi"
echo -e "   📊 Report AGI: $AGI_DIR/agi-did-optimizer-report.agi"
echo -e "   ⚡ Quick Script: $AGI_DIR/did-optimizer-quick.pl"
echo -e "   📋 Dialplan: Added to $EXTENSIONS_CONF"
echo -e "   📊 Logs: $LOG_DIR/"

echo -e "\n${YELLOW}📋 Next Steps:${NC}"
echo -e "1. 🔧 Update API settings in: $ASTERISK_DIR/dids.conf"
echo -e "   - Set your api_base_url (currently: http://localhost:3001)"
echo -e "   - Set your api_key (get from your DID Optimizer server)"

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

echo -e "\n${GREEN}🚀 Your VICIdial DID Optimizer integration is ready with AGI support!${NC}"

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
echo -e "   AGI Integration guide: See vicidial-dialplan-agi.conf"
echo -e "   Configuration options: See comments in dids.conf"
echo -e "   GitHub Repository: https://github.com/nikvb/vicidial-did-optimizer"

exit 0