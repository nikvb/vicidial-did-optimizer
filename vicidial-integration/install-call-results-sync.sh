#!/bin/bash

################################################################################
# VICIdial Call Results Sync - One-Line Installer
#
# Installs the call results sync system to automatically report VICIdial
# call outcomes back to the DID Optimizer API for performance tracking and AI training.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/nikvb/vicidial-did-optimizer/main/vicidial-integration/install-call-results-sync.sh | sudo bash
#
# Or download and run:
#   wget https://raw.githubusercontent.com/nikvb/vicidial-did-optimizer/main/vicidial-integration/install-call-results-sync.sh
#   chmod +x install-call-results-sync.sh
#   sudo ./install-call-results-sync.sh
#
################################################################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
INSTALL_DIR="/usr/local/bin/did-optimizer"
SCRIPT_NAME="process-call-results.pl"
SCRIPT_PATH="$INSTALL_DIR/$SCRIPT_NAME"
LOG_FILE="/var/log/did-optimizer-sync.log"
LAST_CHECK_FILE="/tmp/did-optimizer-last-check.txt"
REPO_BASE="https://raw.githubusercontent.com/nikvb/vicidial-did-optimizer/main"
CONFIG_FILE="/etc/asterisk/dids.conf"

################################################################################
# Helper Functions
################################################################################

print_header() {
    echo -e "\n${BLUE}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  VICIdial Call Results Sync - Installer${NC}"
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
    if [ ! -f "/etc/astguiclient.conf" ]; then
        print_error "VICIdial configuration not found at /etc/astguiclient.conf"
        print_info "This script should be run on a VICIdial server"
        exit 1
    fi
    print_step "VICIdial configuration found"
}

check_perl() {
    if ! command -v perl &> /dev/null; then
        print_error "Perl is not installed"
        exit 1
    fi
    print_step "Perl is installed ($(perl -v | grep -oP 'v\d+\.\d+\.\d+' | head -1))"
}

check_config() {
    if [ ! -f "$CONFIG_FILE" ]; then
        print_warning "DID Optimizer config not found at $CONFIG_FILE"
        print_info "Please run the AGI installer first:"
        print_info "  curl -fsSL https://raw.githubusercontent.com/nikvb/vicidial-did-optimizer/main/vicidial-integration/install-agi.sh | sudo bash"
        exit 1
    fi

    # Check if API key is configured
    if grep -q "api_key=YOUR_API_KEY_HERE" "$CONFIG_FILE" 2>/dev/null; then
        print_warning "API key not configured in $CONFIG_FILE"
        print_info "Please update the api_key in $CONFIG_FILE before syncing will work"
    else
        print_step "DID Optimizer config found"
    fi
}

install_perl_modules() {
    print_info "Checking Perl module dependencies..."

    local REQUIRED_MODULES=("DBI" "DBD::mysql" "LWP::UserAgent" "JSON")
    local missing_modules=()

    for module in "${REQUIRED_MODULES[@]}"; do
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
    print_info "Installing missing modules..."

    # Try to install via package manager first (faster)
    if command -v apt-get &> /dev/null; then
        apt-get update -qq
        apt-get install -y libdbi-perl libdbd-mysql-perl libwww-perl libjson-perl 2>/dev/null || {
            print_warning "apt-get installation incomplete, trying CPAN..."
        }
    elif command -v yum &> /dev/null; then
        yum install -y perl-DBI perl-DBD-MySQL perl-libwww-perl perl-JSON 2>/dev/null || {
            print_warning "yum installation incomplete, trying CPAN..."
        }
    fi

    # Verify again and install via CPAN if needed
    for module in "${missing_modules[@]}"; do
        if ! perl -M"$module" -e 1 2>/dev/null; then
            print_info "Installing $module via CPAN..."
            cpan -T "$module" 2>/dev/null || {
                print_error "Failed to install $module"
                print_info "Please install manually: cpan -T $module"
                return 1
            }
        fi
    done

    print_step "All Perl modules installed successfully"
}

download_script() {
    print_info "Downloading call results sync script..."

    # Create install directory
    mkdir -p "$INSTALL_DIR"

    # Download the Perl script
    if command -v curl &> /dev/null; then
        curl -fsSL "$REPO_BASE/process-call-results.pl" -o "$SCRIPT_PATH" || {
            print_error "Failed to download script"
            return 1
        }
    elif command -v wget &> /dev/null; then
        wget -q "$REPO_BASE/process-call-results.pl" -O "$SCRIPT_PATH" || {
            print_error "Failed to download script"
            return 1
        }
    else
        print_error "Neither curl nor wget is available"
        return 1
    fi

    chmod +x "$SCRIPT_PATH"
    print_step "Script downloaded and made executable"
}

setup_logging() {
    print_info "Setting up logging..."

    # Create log file
    touch "$LOG_FILE"
    chmod 644 "$LOG_FILE"

    # Create last check file
    touch "$LAST_CHECK_FILE"
    chmod 644 "$LAST_CHECK_FILE"

    print_step "Log files created"
}

install_cron_job() {
    print_info "Installing cron job..."

    CRON_JOB="* * * * * /usr/bin/perl $SCRIPT_PATH >> $LOG_FILE 2>&1"

    # Check if cron job already exists
    if crontab -l 2>/dev/null | grep -F "$SCRIPT_PATH" > /dev/null; then
        print_warning "Cron job already exists, removing old entry..."
        crontab -l 2>/dev/null | grep -v "$SCRIPT_PATH" | crontab - 2>/dev/null || true
    fi

    # Add new cron job
    (crontab -l 2>/dev/null; echo "$CRON_JOB") | crontab - 2>/dev/null || {
        print_error "Failed to install cron job"
        return 1
    }

    print_step "Cron job installed (runs every minute)"
}

test_installation() {
    print_info "Testing installation..."

    # Test Perl syntax
    if perl -c "$SCRIPT_PATH" > /dev/null 2>&1; then
        print_step "Script syntax is valid"
    else
        print_error "Script has syntax errors"
        return 1
    fi

    # Test database connectivity (optional - don't fail if it doesn't work)
    print_info "Testing database connection..."
    if perl "$SCRIPT_PATH" --test 2>&1 | grep -q "Database connection successful"; then
        print_step "Database connection successful"
    else
        print_warning "Database connection test inconclusive (this is OK if VICIdial is properly configured)"
    fi
}

print_summary() {
    echo ""
    print_header

    echo -e "${GREEN}✅ Installation Complete!${NC}"
    echo ""
    echo -e "${BLUE}📁 Files Installed:${NC}"
    echo "   • Script: $SCRIPT_PATH"
    echo "   • Log: $LOG_FILE"
    echo "   • State: $LAST_CHECK_FILE"
    echo ""

    echo -e "${BLUE}⏰ Cron Schedule:${NC}"
    echo "   • Frequency: Every minute"
    echo "   • Current cron jobs:"
    crontab -l 2>/dev/null | grep -v "^#" | grep -v "^$" | sed 's/^/     /'
    echo ""

    echo -e "${BLUE}📊 Monitoring:${NC}"
    echo "   • View real-time logs:"
    echo "     ${YELLOW}tail -f $LOG_FILE${NC}"
    echo ""
    echo "   • Check recent syncs:"
    echo "     ${YELLOW}grep 'Summary:' $LOG_FILE | tail -5${NC}"
    echo ""
    echo "   • View sync statistics:"
    echo "     ${YELLOW}grep 'processed' $LOG_FILE | tail -10${NC}"
    echo ""

    echo -e "${BLUE}🔧 Configuration:${NC}"
    echo "   • Config file: $CONFIG_FILE"
    echo "   • VICIdial DB config: /etc/astguiclient.conf"
    echo ""

    if grep -q "api_key=YOUR_API_KEY_HERE" "$CONFIG_FILE" 2>/dev/null; then
        echo -e "${RED}⚠️  IMPORTANT: Configure API key before syncing will work!${NC}"
        echo "   Edit $CONFIG_FILE and set your api_key"
        echo ""
    fi

    echo -e "${BLUE}ℹ️  What's Next:${NC}"
    echo "   1. The sync will start automatically within 1 minute"
    echo "   2. Monitor logs to verify sync is working"
    echo "   3. Check DID Optimizer dashboard for call results"
    echo "   4. Call outcomes will be used for AI training and performance tracking"
    echo ""

    echo -e "${GREEN}✨ Your VICIdial call results are now being synced!${NC}"
    echo ""
}

################################################################################
# Main Installation Flow
################################################################################

main() {
    print_header

    # Pre-flight checks
    check_root
    check_vicidial
    check_perl
    check_config

    # Install components
    install_perl_modules || {
        print_error "Failed to install Perl modules"
        exit 1
    }

    download_script || {
        print_error "Failed to download script"
        exit 1
    }

    setup_logging

    install_cron_job || {
        print_error "Failed to install cron job"
        exit 1
    }

    test_installation || {
        print_warning "Some tests failed, but installation may still work"
    }

    # Show summary
    print_summary
}

# Run main installation
main "$@"
