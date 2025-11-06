#!/bin/bash

################################################################################
# VICIdial DID Optimizer - AGI Installation Script
#
# This script installs the vicidial-did-optimizer.agi script and its
# dependencies on a VICIdial server.
#
# Usage: sudo ./install-agi.sh
################################################################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
AGI_DIR="/var/lib/asterisk/agi-bin"
AGI_SCRIPT="vicidial-did-optimizer.agi"
AGI_SOURCE="https://raw.githubusercontent.com/YOUR_ORG/didapi/main/vicidial-integration/vicidial-did-optimizer.agi"
CONFIG_FILE="/etc/asterisk/dids.conf"
LOG_DIR="/var/log/astguiclient"
ASTERISK_USER="asterisk"
ASTERISK_GROUP="asterisk"

# Required Perl modules
PERL_MODULES=(
    "LWP::UserAgent"
    "JSON"
    "URI::Escape"
    "Cache::FileCache"
    "Asterisk::AGI"
    "Time::HiRes"
)

################################################################################
# Helper Functions
################################################################################

print_header() {
    echo -e "\n${BLUE}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  VICIdial DID Optimizer - AGI Installation${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}\n"
}

print_step() {
    echo -e "${GREEN}[✓]${NC} $1"
}

print_error() {
    echo -e "${RED}[✗]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

print_info() {
    echo -e "${BLUE}[i]${NC} $1"
}

check_root() {
    if [[ $EUID -ne 0 ]]; then
        print_error "This script must be run as root (use sudo)"
        exit 1
    fi
}

check_vicidial() {
    if [ ! -d "$AGI_DIR" ]; then
        print_error "VICIdial AGI directory not found: $AGI_DIR"
        print_info "This script should be run on a VICIdial server"
        exit 1
    fi
    print_step "VICIdial AGI directory found"
}

check_perl() {
    if ! command -v perl &> /dev/null; then
        print_error "Perl is not installed"
        exit 1
    fi
    print_step "Perl is installed ($(perl -v | grep -oP 'v\d+\.\d+\.\d+' | head -1))"
}

install_perl_modules() {
    print_info "Checking Perl module dependencies..."

    local missing_modules=()

    for module in "${PERL_MODULES[@]}"; do
        if ! perl -M"$module" -e 1 2>/dev/null; then
            missing_modules+=("$module")
        else
            print_step "$module is installed"
        fi
    done

    if [ ${#missing_modules[@]} -eq 0 ]; then
        print_step "All Perl modules are installed"
        return 0
    fi

    print_warning "Missing Perl modules: ${missing_modules[*]}"
    print_info "Installing missing modules via CPAN..."

    # Install CPAN if not available
    if ! command -v cpan &> /dev/null; then
        print_info "Installing CPAN..."
        yum install -y perl-CPAN perl-YAML 2>/dev/null || apt-get install -y cpanminus 2>/dev/null
    fi

    # Try cpanm first (faster), fall back to cpan
    if command -v cpanm &> /dev/null; then
        for module in "${missing_modules[@]}"; do
            print_info "Installing $module..."
            cpanm --notest "$module" || {
                print_error "Failed to install $module via cpanm"
                return 1
            }
        done
    else
        for module in "${missing_modules[@]}"; do
            print_info "Installing $module..."
            cpan -T "$module" || {
                print_error "Failed to install $module via cpan"
                return 1
            }
        done
    fi

    print_step "All Perl modules installed successfully"
}

download_agi_script() {
    print_info "Downloading AGI script..."

    # If running from the repo directory, copy locally
    if [ -f "./vicidial-did-optimizer.agi" ]; then
        print_info "Using local copy of AGI script"
        cp "./vicidial-did-optimizer.agi" "$AGI_DIR/$AGI_SCRIPT"
    elif [ -f "../vicidial-integration/vicidial-did-optimizer.agi" ]; then
        print_info "Using local copy from vicidial-integration directory"
        cp "../vicidial-integration/vicidial-did-optimizer.agi" "$AGI_DIR/$AGI_SCRIPT"
    else
        # Download from GitHub
        print_info "Downloading from GitHub..."
        if command -v wget &> /dev/null; then
            wget -q -O "$AGI_DIR/$AGI_SCRIPT" "$AGI_SOURCE" || {
                print_error "Failed to download AGI script"
                exit 1
            }
        elif command -v curl &> /dev/null; then
            curl -s -o "$AGI_DIR/$AGI_SCRIPT" "$AGI_SOURCE" || {
                print_error "Failed to download AGI script"
                exit 1
            }
        else
            print_error "Neither wget nor curl is available"
            exit 1
        fi
    fi

    print_step "AGI script downloaded to $AGI_DIR/$AGI_SCRIPT"
}

set_permissions() {
    print_info "Setting file permissions..."

    # Make AGI script executable
    chmod 755 "$AGI_DIR/$AGI_SCRIPT"
    chown ${ASTERISK_USER}:${ASTERISK_GROUP} "$AGI_DIR/$AGI_SCRIPT"

    print_step "Permissions set (755, ${ASTERISK_USER}:${ASTERISK_GROUP})"
}

create_log_directory() {
    if [ ! -d "$LOG_DIR" ]; then
        print_info "Creating log directory: $LOG_DIR"
        mkdir -p "$LOG_DIR"
    fi

    chown ${ASTERISK_USER}:${ASTERISK_GROUP} "$LOG_DIR"
    chmod 755 "$LOG_DIR"

    print_step "Log directory ready: $LOG_DIR"
}

verify_config() {
    if [ ! -f "$CONFIG_FILE" ]; then
        print_warning "Configuration file not found: $CONFIG_FILE"
        print_info "Please download dids.conf from the DID Optimizer web interface"
        print_info "and place it at: $CONFIG_FILE"
        print_info "Then run: sudo chmod 600 $CONFIG_FILE && sudo chown ${ASTERISK_USER}:${ASTERISK_GROUP} $CONFIG_FILE"
    else
        print_step "Configuration file exists: $CONFIG_FILE"

        # Check permissions
        local perms=$(stat -c %a "$CONFIG_FILE" 2>/dev/null || stat -f %OLp "$CONFIG_FILE" 2>/dev/null)
        if [ "$perms" != "600" ]; then
            print_warning "Configuration file permissions should be 600 (currently: $perms)"
            chmod 600 "$CONFIG_FILE"
            print_step "Corrected permissions to 600"
        fi

        # Check ownership
        chown ${ASTERISK_USER}:${ASTERISK_GROUP} "$CONFIG_FILE"
    fi
}

test_installation() {
    print_info "Testing AGI script..."

    # Basic syntax check
    if perl -c "$AGI_DIR/$AGI_SCRIPT" 2>&1 | grep -q "syntax OK"; then
        print_step "Perl syntax check passed"
    else
        print_error "Perl syntax check failed"
        perl -c "$AGI_DIR/$AGI_SCRIPT"
        return 1
    fi

    # Test with --test flag if available
    if grep -q "test mode" "$AGI_DIR/$AGI_SCRIPT" 2>/dev/null; then
        print_info "Running test mode..."
        su - ${ASTERISK_USER} -s /bin/bash -c "perl $AGI_DIR/$AGI_SCRIPT --test" || {
            print_warning "Test mode execution failed (this may be normal if config is not set up)"
        }
    fi
}

print_next_steps() {
    echo -e "\n${GREEN}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  Installation Complete!${NC}"
    echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}\n"

    echo -e "${BLUE}Next Steps:${NC}\n"

    if [ ! -f "$CONFIG_FILE" ]; then
        echo -e "1. ${YELLOW}Download dids.conf${NC}"
        echo -e "   - Log in to DID Optimizer web interface"
        echo -e "   - Go to Settings → VICIdial Integration"
        echo -e "   - Click 'Download dids.conf'"
        echo -e "   - Upload to: ${CONFIG_FILE}"
        echo -e "   - Run: ${BLUE}sudo chmod 600 $CONFIG_FILE${NC}"
        echo -e "   - Run: ${BLUE}sudo chown ${ASTERISK_USER}:${ASTERISK_GROUP} $CONFIG_FILE${NC}\n"
    fi

    echo -e "2. ${YELLOW}Configure Dialplan${NC}"
    echo -e "   Add to /etc/asterisk/extensions.conf:\n"
    echo -e "   ${BLUE}exten => _91NXXNXXXXXX,1,NoOp(Starting DID Optimizer for \${EXTEN})${NC}"
    echo -e "   ${BLUE}exten => _91NXXNXXXXXX,n,Set(CUSTOMER_PHONE=\${EXTEN:1})${NC}"
    echo -e "   ${BLUE}exten => _91NXXNXXXXXX,n,AGI(vicidial-did-optimizer.agi)${NC}"
    echo -e "   ${BLUE}exten => _91NXXNXXXXXX,n,NoOp(Selected DID: \${OPTIMIZER_DID})${NC}"
    echo -e "   ${BLUE}exten => _91NXXNXXXXXX,n,Set(CALLERID(num)=\${OPTIMIZER_DID})${NC}"
    echo -e "   ${BLUE}exten => _91NXXNXXXXXX,n,Dial(SIP/gateway/\${EXTEN:1},60,tTo)${NC}\n"

    echo -e "3. ${YELLOW}Reload Asterisk Dialplan${NC}"
    echo -e "   ${BLUE}asterisk -rx \"dialplan reload\"${NC}\n"

    echo -e "4. ${YELLOW}Test${NC}"
    echo -e "   - Make a test call"
    echo -e "   - Monitor logs: ${BLUE}tail -f $LOG_DIR/did-optimizer.log${NC}"
    echo -e "   - Check DID Optimizer dashboard for call activity\n"

    echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}\n"
}

################################################################################
# Main Installation Process
################################################################################

main() {
    print_header

    check_root
    check_vicidial
    check_perl
    install_perl_modules
    download_agi_script
    set_permissions
    create_log_directory
    verify_config
    test_installation
    print_next_steps
}

# Run installation
main

exit 0
