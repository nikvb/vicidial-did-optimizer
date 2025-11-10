# CentOS 7 Installation Guide - VICIdial DID Optimizer

Complete installation guide for CentOS 7 systems.

## Prerequisites

### 1. System Requirements
- CentOS 7.x
- Root or sudo access
- Active internet connection
- VICIdial already installed
- Asterisk already installed

### 2. EPEL Repository (Required)

Most Perl modules require the EPEL repository:

```bash
# Install EPEL repository
sudo yum install -y epel-release

# Update package cache
sudo yum update
```

## Required Packages for CentOS 7

### Core System Packages

```bash
# Install core Perl and development tools
sudo yum install -y \
    perl \
    perl-core \
    perl-CPAN \
    perl-devel \
    gcc \
    make \
    openssl \
    openssl-devel
```

### Perl Modules via YUM

```bash
# Install Perl modules available in CentOS/EPEL repos
sudo yum install -y \
    perl-libwww-perl \
    perl-JSON \
    perl-DBI \
    perl-DBD-MySQL \
    perl-IO-Socket-SSL \
    perl-Net-SSLeay \
    perl-LWP-Protocol-https \
    perl-URI
```

### Perl Modules via CPAN

Some modules may need to be installed via CPAN on CentOS 7:

```bash
# Configure CPAN (first time only)
sudo cpan

# At CPAN prompt, type:
o conf init

# Install required modules
sudo cpan -T Mozilla::CA
sudo cpan -T URI::Escape
```

**Note:** The `-T` flag skips tests for faster installation.

## Complete One-Line Installation

For a quick installation of all dependencies:

```bash
# Install all packages in one command
sudo yum install -y epel-release && \
sudo yum install -y perl perl-core perl-CPAN perl-devel gcc make openssl openssl-devel \
    perl-libwww-perl perl-JSON perl-DBI perl-DBD-MySQL \
    perl-IO-Socket-SSL perl-Net-SSLeay perl-LWP-Protocol-https perl-URI && \
sudo cpan -T Mozilla::CA
```

## Verify Installation

### Test Perl Modules

```bash
# Test each module
perl -MLWP::UserAgent -e 'print "LWP::UserAgent: OK\n"'
perl -MLWP::Protocol::https -e 'print "HTTPS Support: OK\n"'
perl -MIO::Socket::SSL -e 'print "SSL Support: OK\n"'
perl -MJSON -e 'print "JSON: OK\n"'
perl -MDBI -e 'print "DBI: OK\n"'
perl -MDBD::mysql -e 'print "MySQL: OK\n"'
perl -MURI::Escape -e 'print "URI::Escape: OK\n"'
perl -MMozilla::CA -e 'print "Mozilla::CA: OK\n"'
```

### Test HTTPS Connectivity

```bash
# Test HTTPS connection
perl -MLWP::UserAgent -e '
    my $ua = LWP::UserAgent->new(ssl_opts => { verify_hostname => 1 });
    my $response = $ua->get("https://www.google.com");
    print "HTTPS Test: ", $response->is_success ? "PASSED\n" : "FAILED\n";
'
```

## Run Installation Script

Once all prerequisites are installed, run the auto-detect installer:

```bash
cd /home/na/didapi
sudo ./install-vicidial-integration-autodetect.sh
```

The script will:
- Automatically detect CentOS 7
- Use `yum` as the package manager
- Install any missing Perl modules
- Configure VICIdial integration
- Set up AGI scripts

## Manual Testing After Installation

### 1. Test Configuration File

```bash
# Check configuration was created
cat /etc/asterisk/dids.conf

# Edit configuration
sudo nano /etc/asterisk/dids.conf

# Set your API key and URL
api_base_url=https://dids.amdy.io
api_key=YOUR_API_KEY_HERE
```

### 2. Test Perl Script

```bash
# Test the main Perl script
sudo -u asterisk /usr/share/astguiclient/vicidial-did-optimizer-config.pl --config
```

### 3. Test API Connection

Use the comprehensive test script:

```bash
cd /home/na/didapi
./test-vicidial-integration.pl
```

Or the quick test:

```bash
./quick-test.sh TEST001 4155551234
```

### 4. Test AGI Script

```bash
# Test AGI script execution
sudo -u asterisk /var/lib/asterisk/agi-bin/agi-did-optimizer.agi TEST001 1001 4155551234
```

## Troubleshooting

### Issue: "Can't locate LWP/Protocol/https.pm"

**Solution:**
```bash
sudo yum install -y perl-LWP-Protocol-https perl-IO-Socket-SSL perl-Net-SSLeay
```

### Issue: "Can't locate Mozilla/CA.pm"

**Solution:**
```bash
sudo cpan -T Mozilla::CA
```

### Issue: "SSL connect attempt failed"

**Solution:**
```bash
# Update CA certificates
sudo yum install -y ca-certificates
sudo update-ca-trust

# Reinstall SSL modules
sudo yum reinstall perl-IO-Socket-SSL perl-Net-SSLeay
```

### Issue: CPAN configuration prompts

**Solution:**
```bash
# Use automatic configuration
(echo y; echo sudo; echo local::lib) | cpan

# Or configure CPAN non-interactively
sudo perl -MCPAN -e 'my $c = "CPAN::HandleConfig"; $c->load(doit => 1, autoconfig => 1);'
```

### Issue: Module installation fails with test errors

**Solution:**
```bash
# Force install without tests
sudo cpan -f Module::Name
```

## Security Considerations

### Firewall Configuration

If you have firewall enabled, ensure API endpoint is accessible:

```bash
# Check firewall status
sudo firewall-cmd --state

# Allow HTTPS outbound (usually already allowed)
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

### SELinux Considerations

CentOS 7 has SELinux enabled by default. You may need to adjust policies:

```bash
# Check SELinux status
getenforce

# If enforcing and having issues, check logs
sudo grep denied /var/log/audit/audit.log

# Temporary disable for testing (not recommended for production)
sudo setenforce 0

# Re-enable
sudo setenforce 1
```

## Package List Summary

### Required Packages (via yum):
- `epel-release` - Extra Packages for Enterprise Linux
- `perl` - Perl interpreter
- `perl-core` - Core Perl modules
- `perl-CPAN` - CPAN module installer
- `perl-devel` - Perl development files
- `gcc` - C compiler (for building modules)
- `make` - Build tool
- `openssl` - SSL/TLS toolkit
- `openssl-devel` - OpenSSL development files
- `perl-libwww-perl` - LWP (web user agent)
- `perl-JSON` - JSON encoder/decoder
- `perl-DBI` - Database independent interface
- `perl-DBD-MySQL` - MySQL driver for DBI
- `perl-IO-Socket-SSL` - SSL socket support
- `perl-Net-SSLeay` - OpenSSL bindings
- `perl-LWP-Protocol-https` - HTTPS protocol support
- `perl-URI` - URI manipulation

### Optional Packages (via CPAN):
- `Mozilla::CA` - Mozilla's CA certificate bundle
- `URI::Escape` - URL encoding/decoding

## Verification Checklist

- [ ] EPEL repository installed
- [ ] All Perl packages installed via yum
- [ ] CPAN modules installed (Mozilla::CA)
- [ ] HTTPS support verified (`perl -MLWP::Protocol::https -e 1`)
- [ ] SSL support verified (`perl -MIO::Socket::SSL -e 1`)
- [ ] Configuration file created (`/etc/asterisk/dids.conf`)
- [ ] API key configured
- [ ] Test script passes (`./test-vicidial-integration.pl`)
- [ ] AGI scripts executable
- [ ] Asterisk dialplan reloaded

## Support

If you encounter issues specific to CentOS 7:

1. Check `/var/log/astguiclient/did_optimizer.log`
2. Run comprehensive test: `./test-vicidial-integration.pl --verbose`
3. Verify Perl modules: `perl -V`
4. Check SELinux logs: `sudo grep denied /var/log/audit/audit.log`
5. Review system logs: `sudo journalctl -xe`

## References

- CentOS 7 Perl Packages: https://centos.pkgs.org/7/centos-x86_64/
- EPEL Repository: https://fedoraproject.org/wiki/EPEL
- VICIdial Documentation: http://www.vicidial.org/docs/
