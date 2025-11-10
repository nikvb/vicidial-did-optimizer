#!/bin/bash
################################################################################
# Quick CentOS 7 Prerequisites Installer for VICIdial DID Optimizer
#
# This script installs all required Perl modules and dependencies
# for CentOS 7 systems before running the main installation script
#
# Usage: sudo ./install-centos7.sh
################################################################################

set -e  # Exit on any error

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  CentOS 7 Prerequisites Installer                       ║${NC}"
echo -e "${BLUE}║  VICIdial DID Optimizer Integration                     ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════╝${NC}\n"

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}❌ This script must be run as root (use sudo)${NC}"
   exit 1
fi

# Check OS version
if [ ! -f /etc/redhat-release ]; then
    echo -e "${RED}❌ This script is for CentOS/RHEL systems only${NC}"
    exit 1
fi

OS_VERSION=$(cat /etc/redhat-release)
echo -e "${BLUE}Detected OS: $OS_VERSION${NC}"
echo -e "${BLUE}Note: This installer does NOT use yum/dnf - all Perl modules installed via CPAN${NC}\n"

# Step 1: Verify Prerequisites
echo -e "${YELLOW}Step 1: Checking Prerequisites...${NC}"

# Check for Perl
if command -v perl >/dev/null 2>&1; then
    PERL_VERSION=$(perl -e 'print $^V')
    echo -e "${GREEN}  ✓ Perl ${PERL_VERSION}${NC}"
else
    echo -e "${RED}  ✗ Perl not found${NC}"
    echo -e "${YELLOW}Please install Perl first (usually pre-installed on CentOS)${NC}"
    exit 1
fi

# Check for gcc
if command -v gcc >/dev/null 2>&1; then
    GCC_VERSION=$(gcc --version | head -n1 | awk '{print $NF}')
    echo -e "${GREEN}  ✓ gcc ${GCC_VERSION}${NC}"
else
    echo -e "${YELLOW}  ⚠ gcc not found (required for compiling Perl modules)${NC}"
    echo -e "${YELLOW}  Install with: yum groupinstall 'Development Tools'${NC}"
    echo -e "${YELLOW}  Or manually install: yum install gcc${NC}"
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Check for make
if command -v make >/dev/null 2>&1; then
    MAKE_VERSION=$(make --version | head -n1 | awk '{print $NF}')
    echo -e "${GREEN}  ✓ make ${MAKE_VERSION}${NC}"
else
    echo -e "${YELLOW}  ⚠ make not found (required for compiling Perl modules)${NC}"
    echo -e "${YELLOW}  Install with: yum install make${NC}"
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Check for OpenSSL
if command -v openssl >/dev/null 2>&1; then
    OPENSSL_VERSION=$(openssl version | awk '{print $2}')
    echo -e "${GREEN}  ✓ openssl ${OPENSSL_VERSION}${NC}"
else
    echo -e "${YELLOW}  ⚠ openssl not found (required for HTTPS support)${NC}"
fi

# Check for OpenSSL development headers
if [ -f /usr/include/openssl/ssl.h ] || [ -f /usr/local/include/openssl/ssl.h ]; then
    echo -e "${GREEN}  ✓ openssl-devel headers found${NC}"
else
    echo -e "${YELLOW}  ⚠ openssl-devel headers not found (may be needed for SSL modules)${NC}"
    echo -e "${YELLOW}  Install with: yum install openssl-devel${NC}"
fi

echo -e "${GREEN}✅ Prerequisites check complete${NC}\n"

# Step 2: Configure CPAN (Non-Interactive)
echo -e "${YELLOW}Step 2: Configuring CPAN...${NC}"
echo -e "${BLUE}Using CPAN for latest stable Perl modules (newer than CentOS 7 repos)${NC}\n"

# Auto-configure CPAN if not already configured
if [ ! -f ~/.cpan/CPAN/MyConfig.pm ] && [ ! -f /root/.cpan/CPAN/MyConfig.pm ]; then
    echo -e "${YELLOW}Setting up CPAN for first time use...${NC}"

    # Non-interactive CPAN configuration
    perl -MCPAN -e 'my $c = "CPAN::HandleConfig"; $c->load(doit => 1, autoconfig => 1);' 2>/dev/null || {
        # Fallback method
        (echo y; echo sudo; echo local::lib) | cpan >/dev/null 2>&1
    }

    echo -e "${GREEN}✅ CPAN configured${NC}"
else
    echo -e "${GREEN}✅ CPAN already configured${NC}"
fi

# Upgrade CPAN itself to latest version
echo -e "${YELLOW}Upgrading CPAN to latest version...${NC}"
cpan -T CPAN 2>&1 | tail -3

echo ""

# Step 3: Install Perl Modules via CPAN
echo -e "${YELLOW}Step 3: Installing Perl Modules via CPAN...${NC}"

# List of required modules
PERL_MODULES=(
    "LWP::UserAgent"
    "LWP::Protocol::https"
    "IO::Socket::SSL"
    "Net::SSLeay"
    "Mozilla::CA"
    "JSON"
    "DBI"
    "DBD::mysql"
    "URI::Escape"
)

# Install each module via CPAN
for module in "${PERL_MODULES[@]}"; do
    echo -e "${YELLOW}Installing $module...${NC}"
    # -T = skip tests for faster installation (tests can take very long)
    # Output last 2 lines to show result
    cpan -T "$module" 2>&1 | tail -2
done

echo -e "\n${GREEN}✅ All Perl modules installed via CPAN${NC}\n"

# Step 4: Update CA Certificates
echo -e "${YELLOW}Step 4: Updating CA Certificates...${NC}"
update-ca-trust
echo -e "${GREEN}✅ CA certificates updated${NC}\n"

# Step 5: Verify Installation
echo -e "${YELLOW}Step 5: Verifying Perl Modules...${NC}"

REQUIRED_MODULES=(
    "LWP::UserAgent"
    "LWP::Protocol::https"
    "IO::Socket::SSL"
    "Net::SSLeay"
    "JSON"
    "DBI"
    "DBD::mysql"
    "URI::Escape"
)

FAILED_MODULES=0

for module in "${REQUIRED_MODULES[@]}"; do
    if perl -M"$module" -e 1 2>/dev/null; then
        echo -e "  ${GREEN}✅ $module${NC}"
    else
        echo -e "  ${RED}❌ $module${NC}"
        FAILED_MODULES=$((FAILED_MODULES + 1))
    fi
done

# Check Mozilla::CA separately (optional but recommended)
if perl -MMozilla::CA -e 1 2>/dev/null; then
    echo -e "  ${GREEN}✅ Mozilla::CA${NC}"
else
    echo -e "  ${YELLOW}⚠️  Mozilla::CA (optional)${NC}"
fi

echo ""

# Step 6: Test HTTPS Connectivity
echo -e "${YELLOW}Step 6: Testing HTTPS Support...${NC}"
HTTPS_TEST=$(perl -MLWP::UserAgent -e '
    my $ua = LWP::UserAgent->new(ssl_opts => { verify_hostname => 1 });
    my $response = $ua->get("https://www.google.com");
    print $response->is_success ? "OK" : "FAILED";
' 2>/dev/null)

if [ "$HTTPS_TEST" = "OK" ]; then
    echo -e "${GREEN}✅ HTTPS connectivity test passed${NC}\n"
else
    echo -e "${RED}❌ HTTPS connectivity test failed${NC}"
    echo -e "${YELLOW}Check SSL/TLS configuration${NC}\n"
fi

# Summary
echo -e "${BLUE}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Installation Summary                                   ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════╝${NC}\n"

if [ $FAILED_MODULES -eq 0 ] && [ "$HTTPS_TEST" = "OK" ]; then
    echo -e "${GREEN}✅ All prerequisites installed successfully!${NC}\n"

    echo -e "${YELLOW}Next Steps:${NC}"
    echo -e "1. Run the main installation script:"
    echo -e "   ${BLUE}sudo ./install-vicidial-integration-autodetect.sh${NC}\n"

    echo -e "2. Or test the installation first:"
    echo -e "   ${BLUE}./test-vicidial-integration.pl${NC}\n"

    exit 0
else
    echo -e "${RED}⚠️  Some modules failed to install${NC}\n"

    echo -e "${YELLOW}Troubleshooting:${NC}"
    echo -e "1. Ensure build tools are installed:"
    echo -e "   ${BLUE}gcc --version && make --version${NC}\n"

    echo -e "2. Check OpenSSL development headers:"
    echo -e "   ${BLUE}ls -la /usr/include/openssl/ssl.h${NC}\n"

    echo -e "3. Manually install missing modules:"
    echo -e "   ${BLUE}sudo cpan -f Module::Name${NC}\n"

    echo -e "4. Check firewall/proxy settings if HTTPS test failed\n"

    echo -e "5. View detailed CPAN logs:"
    echo -e "   ${BLUE}cat ~/.cpan/build.log${NC}\n"

    exit 1
fi
