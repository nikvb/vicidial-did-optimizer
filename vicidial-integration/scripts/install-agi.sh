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
AGI_SOURCE="https://raw.githubusercontent.com/nikvb/vicidial-did-optimizer/main/vicidial-integration/agi/vicidial-did-optimizer.agi"
CONFIG_FILE="/etc/asterisk/dids.conf"
LOG_DIR="/var/log/astguiclient"

# Required Perl modules
PERL_MODULES=(
    "LWP::UserAgent"
    "LWP::Protocol::https"
    "JSON"
    "URI::Escape"
    "Cache::FileCache"
    "Asterisk::AGI"
    "Time::HiRes"
    "HTTP::Request"
    "IO::Socket::SSL"
    "Mozilla::CA"
    "Net::SSLeay"
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

clean_previous() {
    print_info "Cleaning previous installation..."
    rm -f "$AGI_DIR/vicidial-did-optimizer.agi"
    rm -f "$AGI_DIR/agi-did-optimizer-report.agi"
    rm -f "$CONFIG_FILE"
    rm -f /usr/src/install-agi.sh
    # Remove our h-extension entries from extensions.conf
    if [ -f /etc/asterisk/extensions.conf ]; then
        sed -i '/agi-did-optimizer-report.agi/d' /etc/asterisk/extensions.conf
    fi
    print_step "Previous files removed"
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

install_system_deps() {
    print_info "Installing system dependencies for SSL/HTTPS..."

    if command -v dnf &> /dev/null; then
        dnf install -y --skip-broken gcc make openssl openssl-devel perl-devel \
            perl-IO-Socket-SSL perl-Net-SSLeay perl-Mozilla-CA \
            perl-LWP-Protocol-https ca-certificates 2>&1 | grep -v "Nothing to do" || true
    elif command -v yum &> /dev/null; then
        for pkg in gcc make openssl openssl-devel perl-devel \
            perl-IO-Socket-SSL perl-Net-SSLeay perl-LWP-Protocol-https ca-certificates; do
            yum install -y "$pkg" 2>&1 | grep -q "already installed\|Complete" || true
        done
    elif command -v apt-get &> /dev/null; then
        apt-get update -qq
        apt-get install -y build-essential libssl-dev \
            libwww-perl libnet-ssleay-perl libio-socket-ssl-perl \
            libmozilla-ca-perl cpanminus ca-certificates 2>/dev/null || true
    fi

    # Update CA certificates
    if command -v update-ca-trust &> /dev/null; then
        update-ca-trust extract 2>/dev/null || true
    elif command -v update-ca-certificates &> /dev/null; then
        update-ca-certificates 2>/dev/null || true
    fi

    print_step "System dependencies installed"
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
    print_info "Installing missing modules..."

    # Install cpanminus if not available
    if ! command -v cpanm &> /dev/null; then
        print_info "Installing cpanminus..."
        if command -v dnf &> /dev/null; then
            dnf install -y perl-App-cpanminus 2>/dev/null || \
                curl -L https://cpanmin.us | perl - --self-upgrade 2>/dev/null
        elif command -v yum &> /dev/null; then
            yum install -y perl-App-cpanminus 2>/dev/null || \
                curl -L https://cpanmin.us | perl - --self-upgrade 2>/dev/null
        elif command -v apt-get &> /dev/null; then
            apt-get install -y cpanminus 2>/dev/null
        fi
    fi

    for module in "${missing_modules[@]}"; do
        print_info "Installing $module..."
        if command -v cpanm &> /dev/null; then
            if ! cpanm --notest --quiet "$module"; then
                print_error "Failed to install $module"
                return 1
            fi
        else
            if ! yes '' | cpan -T "$module" 2>&1 | grep -q "OK\|up to date"; then
                print_error "Failed to install $module"
                return 1
            fi
        fi
        print_step "$module installed"
    done

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
        print_info "Downloading from GitHub..."
        local CACHE_BUST="?$(date +%s)"
        if command -v curl &> /dev/null; then
            curl -fsSL -o "$AGI_DIR/$AGI_SCRIPT" "${AGI_SOURCE}${CACHE_BUST}" || {
                print_error "Failed to download AGI script"
                exit 1
            }
        elif command -v wget &> /dev/null; then
            wget -q -O "$AGI_DIR/$AGI_SCRIPT" "${AGI_SOURCE}${CACHE_BUST}" || {
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

download_report_agi() {
    print_info "Installing call-result reporting AGI (h extension)..."

    REPORT_SCRIPT="agi-did-optimizer-report.agi"
    REPORT_SOURCE="https://raw.githubusercontent.com/nikvb/vicidial-did-optimizer/main/vicidial-integration/agi/agi-did-optimizer-report.agi"

    if [ -f "./agi-did-optimizer-report.agi" ]; then
        cp "./agi-did-optimizer-report.agi" "$AGI_DIR/$REPORT_SCRIPT"
    elif [ -f "../agi/agi-did-optimizer-report.agi" ]; then
        cp "../agi/agi-did-optimizer-report.agi" "$AGI_DIR/$REPORT_SCRIPT"
    else
        if command -v wget &> /dev/null; then
            wget -q -O "$AGI_DIR/$REPORT_SCRIPT" "$REPORT_SOURCE" || {
                print_warning "Failed to download report AGI — skipping"
                return 0
            }
        elif command -v curl &> /dev/null; then
            curl -s -o "$AGI_DIR/$REPORT_SCRIPT" "$REPORT_SOURCE" || {
                print_warning "Failed to download report AGI — skipping"
                return 0
            }
        fi
    fi

    chmod 755 "$AGI_DIR/$REPORT_SCRIPT"
    print_step "Report AGI installed to $AGI_DIR/$REPORT_SCRIPT"
}

set_permissions() {
    print_info "Setting file permissions..."
    chmod 755 "$AGI_DIR/$AGI_SCRIPT"
    # VICIdial runs as root — no chown needed
    print_step "Permissions set (755)"
}

create_log_directory() {
    if [ ! -d "$LOG_DIR" ]; then
        print_info "Creating log directory: $LOG_DIR"
        mkdir -p "$LOG_DIR"
    fi
    chmod 755 "$LOG_DIR"
    # VICIdial runs as root — no chown needed
    print_step "Log directory ready: $LOG_DIR"
}

setup_config() {
    if [ -f "$CONFIG_FILE" ]; then
        print_step "Configuration file already exists: $CONFIG_FILE"
        return 0
    fi

    # Accept API key as first script argument, env var, or interactive prompt
    local API_KEY_INPUT="${1:-$DID_API_KEY}"

    if [ -z "$API_KEY_INPUT" ]; then
        print_info "No configuration file found at $CONFIG_FILE"
        echo ""
        echo -e "${YELLOW}Enter your DID Optimizer API key to auto-generate the config.${NC}"
        echo -e "${YELLOW}(Find it in the web UI: Settings → API Keys)${NC}"
        echo ""
        if [ -t 0 ] || [ -e /dev/tty ]; then
            read -p "API Key (or press Enter to skip): " API_KEY_INPUT < /dev/tty 2>/dev/null || read -p "API Key: " API_KEY_INPUT
        fi
    fi

    if [ -z "$API_KEY_INPUT" ]; then
        print_warning "Skipped config download — you'll need to create $CONFIG_FILE manually"
        print_info "Get it from: Settings → VICIdial Integration in the web UI"
        return 0
    fi

    print_info "Fetching configuration from API..."

    local CONFIG_URL="https://dids.amdy.io/api/v1/settings/vicidial/download-config?key=${API_KEY_INPUT}"
    local TEMP_CONFIG="/tmp/dids.conf.$$"

    if command -v curl &> /dev/null; then
        curl -s -f -o "$TEMP_CONFIG" "$CONFIG_URL" 2>/dev/null
    elif command -v wget &> /dev/null; then
        wget -q -O "$TEMP_CONFIG" "$CONFIG_URL" 2>/dev/null
    fi

    if [ -f "$TEMP_CONFIG" ] && grep -q "api_key=" "$TEMP_CONFIG" 2>/dev/null; then
        mv "$TEMP_CONFIG" "$CONFIG_FILE"
        chmod 600 "$CONFIG_FILE"
        print_step "Configuration downloaded and saved to $CONFIG_FILE"
    else
        rm -f "$TEMP_CONFIG"
        print_error "Failed to fetch config — invalid API key or network error"
        print_info "You can create it manually from: Settings → VICIdial Integration"
        return 0
    fi
}

install_logrotate() {
    print_info "Configuring log rotation..."

    if ! command -v logrotate &> /dev/null; then
        print_warning "logrotate not found — skipping log rotation setup"
        return 0
    fi

    cat > /etc/logrotate.d/did-optimizer << 'EOF'
/var/log/astguiclient/did-optimizer.log
/var/log/astguiclient/did-optimizer-stats.log {
    su root root
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    create 644 root root
    dateext
    dateformat -%Y%m%d
    sharedscripts
    postrotate
        # AGI script opens/closes the log on every call — no restart needed
        true
    endscript
}
EOF

    # Validate the config
    if logrotate --debug /etc/logrotate.d/did-optimizer 2>&1 | grep -q "error:"; then
        print_warning "logrotate config validation produced warnings — check /etc/logrotate.d/did-optimizer"
    else
        print_step "Log rotation configured (daily, 30-day retention, compressed)"
    fi
}

setup_hangup_handler() {
    local EXTENSIONS_CONF="/etc/asterisk/extensions.conf"
    local REPORT_AGI="agi-did-optimizer-report.agi"

    if [ ! -f "$EXTENSIONS_CONF" ]; then
        print_warning "extensions.conf not found — skipping h-extension setup"
        print_info "Manually add to your dialplan: exten => h,n,AGI($REPORT_AGI)"
        return 0
    fi

    # Clean up any previous installations of our AGI in h extensions
    if grep -q "$REPORT_AGI" "$EXTENSIONS_CONF" 2>/dev/null; then
        print_info "Removing previous h-extension entries..."
        sed -i "/$REPORT_AGI/d" "$EXTENSIONS_CONF"
        print_step "Cleaned up old entries"
    fi

    # Find all VICIdial h,1 call_log lines and inject our AGI after each one
    local COUNT=0
    if grep -q "exten => h,1,AGI(agi://127.0.0.1:4577/call_log" "$EXTENSIONS_CONF" 2>/dev/null; then
        sed -i "/exten => h,1,AGI(agi:\/\/127.0.0.1:4577\/call_log/a exten => h,n,AGI($REPORT_AGI)" "$EXTENSIONS_CONF"
        COUNT=$(grep -c "$REPORT_AGI" "$EXTENSIONS_CONF")
        print_step "Injected h-extension handler after $COUNT VICIdial call_log entries"
    else
        print_warning "No VICIdial h-extension found in extensions.conf"
        print_info "Manually add to your dialplan: exten => h,n,AGI($REPORT_AGI)"
        return 0
    fi

    # Reload Asterisk dialplan
    if command -v asterisk &> /dev/null; then
        asterisk -rx "dialplan reload" > /dev/null 2>&1
        print_step "Asterisk dialplan reloaded"
    else
        print_warning "Asterisk CLI not found — reload dialplan manually: asterisk -rx 'dialplan reload'"
    fi
}

test_installation() {
    print_info "Testing AGI script..."

    if perl -c "$AGI_DIR/$AGI_SCRIPT" 2>&1 | grep -q "syntax OK"; then
        print_step "Perl syntax check passed"
    else
        print_error "Perl syntax check failed"
        perl -c "$AGI_DIR/$AGI_SCRIPT"
        return 1
    fi

    # Verify HTTPS modules
    print_info "Verifying HTTPS/SSL Perl modules..."
    local https_ok=true
    for module in "Net::SSLeay" "IO::Socket::SSL" "Mozilla::CA" "LWP::Protocol::https"; do
        if perl -M"$module" -e 'exit 0' 2>/dev/null; then
            print_step "$module working"
        else
            print_error "$module failed to load"
            https_ok=false
        fi
    done

    if [ "$https_ok" = false ]; then
        print_error "Some HTTPS modules are not working"
        return 1
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
        echo -e "   - Copy the configuration and paste into: ${CONFIG_FILE}"
        echo -e "   - Run: ${BLUE}sudo chmod 600 $CONFIG_FILE${NC}\n"
    fi

    echo -e "2. ${YELLOW}Configure Dialplan in VICIdial Admin${NC}"
    echo -e "   ${RED}⚠️  DO NOT edit /etc/asterisk/extensions.conf directly!${NC}"
    echo -e "   Use VICIdial Admin → Carriers → Dialplan Entry:\n"
    echo -e "   ${BLUE}; BEFORE your Dial() command:${NC}"
    echo -e "   ${BLUE}exten => _91NXXNXXXXXX,n,AGI(vicidial-did-optimizer.agi)${NC}"
    echo -e "   ${BLUE}exten => _91NXXNXXXXXX,n,Set(CALLERID(num)=\${OPTIMIZER_DID})${NC}\n"
    echo -e "   ${BLUE}; AFTER all extensions (reports call result at hangup):${NC}"
    echo -e "   ${BLUE}exten => h,1,AGI(agi-did-optimizer-report.agi)${NC}\n"
    echo -e "   Paste these into the Dialplan Entry and click Submit.\n"

    echo -e "3. ${YELLOW}Test Integration${NC}"
    echo -e "   - Make a test call"
    echo -e "   - Monitor logs: ${BLUE}tail -f $LOG_DIR/did-optimizer.log${NC}"
    echo -e "   - Stats log:    ${BLUE}tail -f $LOG_DIR/did-optimizer-stats.log${NC}"
    echo -e "   - Check DID Optimizer dashboard for call activity\n"

    echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}\n"
}

################################################################################
# Main Installation Process
################################################################################

main() {
    print_header

    check_root
    clean_previous
    check_vicidial
    check_perl
    install_system_deps
    install_perl_modules || { print_error "Perl module installation failed"; exit 1; }
    download_agi_script
    download_report_agi
    set_permissions
    create_log_directory
    install_logrotate
    setup_config "$1"
    setup_hangup_handler
    test_installation
    print_next_steps
}

main "$@"
exit 0
