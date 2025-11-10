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
echo -e "${BLUE}Detected OS: $OS_VERSION${NC}\n"

# Step 1: Install EPEL Repository
echo -e "${YELLOW}Step 1: Installing EPEL Repository...${NC}"
if rpm -q epel-release >/dev/null 2>&1; then
    echo -e "${GREEN}✅ EPEL already installed${NC}"
else
    yum install -y epel-release
    echo -e "${GREEN}✅ EPEL installed${NC}"
fi

# Update package cache
echo -e "${YELLOW}Updating package cache...${NC}"
yum makecache fast
echo ""

# Step 2: Install Core Perl and Development Tools
echo -e "${YELLOW}Step 2: Installing Core Perl and Development Tools...${NC}"
yum install -y \
    perl \
    perl-core \
    perl-CPAN \
    perl-devel \
    gcc \
    make \
    openssl \
    openssl-devel \
    ca-certificates

echo -e "${GREEN}✅ Core tools installed${NC}\n"

# Step 3: Configure CPAN (Non-Interactive)
echo -e "${YELLOW}Step 3: Configuring CPAN...${NC}"
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

# Step 4: Install Perl Modules via CPAN
echo -e "${YELLOW}Step 4: Installing Perl Modules via CPAN...${NC}"

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

# Step 5: Update CA Certificates
echo -e "${YELLOW}Step 5: Updating CA Certificates...${NC}"
update-ca-trust
echo -e "${GREEN}✅ CA certificates updated${NC}\n"

# Step 6: Verify Installation
echo -e "${YELLOW}Step 6: Verifying Perl Modules...${NC}"

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

# Step 7: Test HTTPS Connectivity
echo -e "${YELLOW}Step 7: Testing HTTPS Support...${NC}"
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
    echo -e "1. Check EPEL repository:"
    echo -e "   ${BLUE}yum repolist | grep epel${NC}\n"

    echo -e "2. Manually install missing modules:"
    echo -e "   ${BLUE}sudo cpan -f Module::Name${NC}\n"

    echo -e "3. Check firewall/proxy settings if HTTPS test failed\n"

    echo -e "4. View detailed logs:"
    echo -e "   ${BLUE}cat ~/.cpan/build.log${NC}\n"

    exit 1
fi
