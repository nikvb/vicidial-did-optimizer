# CentOS 7 Quick Start Guide

## One-Line Quick Install

```bash
# Download and run the CentOS 7 prerequisites installer
cd /home/na/didapi && sudo ./install-centos7.sh
```

## Manual Installation Commands

### Quick Install (Copy & Paste)

```bash
# Install EPEL and update
sudo yum install -y epel-release && sudo yum makecache fast

# Install all required packages
sudo yum install -y \
  perl perl-core perl-CPAN perl-devel gcc make openssl openssl-devel ca-certificates \
  perl-libwww-perl perl-JSON perl-DBI perl-DBD-MySQL \
  perl-IO-Socket-SSL perl-Net-SSLeay perl-LWP-Protocol-https perl-URI

# Install additional CPAN modules
sudo cpan -T Mozilla::CA

# Update CA certificates
sudo update-ca-trust
```

## Verify Installation

```bash
# Test all required modules
perl -MLWP::UserAgent -e 'print "✓ LWP::UserAgent\n"'
perl -MLWP::Protocol::https -e 'print "✓ HTTPS Support\n"'
perl -MIO::Socket::SSL -e 'print "✓ SSL Support\n"'
perl -MJSON -e 'print "✓ JSON\n"'
perl -MDBI -e 'print "✓ DBI\n"'
perl -MDBD::mysql -e 'print "✓ MySQL Driver\n"'
```

## Run Installation

```bash
# Run the auto-detect installer
cd /home/na/didapi
sudo ./install-vicidial-integration-autodetect.sh
```

## Test Integration

```bash
# Comprehensive test
./test-vicidial-integration.pl

# Quick API test
./quick-test.sh
```

## Configuration

```bash
# Edit configuration file
sudo nano /etc/asterisk/dids.conf

# Required settings:
api_base_url=https://dids.amdy.io
api_key=YOUR_API_KEY_HERE
```

## Common Issues

### Issue: "Can't locate LWP/Protocol/https.pm"
```bash
sudo yum install -y perl-LWP-Protocol-https perl-IO-Socket-SSL
```

### Issue: "Can't locate Mozilla/CA.pm"
```bash
sudo cpan -T Mozilla::CA
```

### Issue: "SSL connect attempt failed"
```bash
sudo yum install -y ca-certificates
sudo update-ca-trust
```

### Issue: Firewall blocking HTTPS
```bash
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

### Issue: SELinux blocking scripts
```bash
# Check logs
sudo grep denied /var/log/audit/audit.log

# Temporary disable for testing (not recommended for production)
sudo setenforce 0
```

## Package Reference

### Via YUM (from EPEL):
- `perl-libwww-perl` - HTTP/HTTPS client library
- `perl-JSON` - JSON encoder/decoder
- `perl-DBI` - Database interface
- `perl-DBD-MySQL` - MySQL database driver
- `perl-IO-Socket-SSL` - SSL socket support
- `perl-Net-SSLeay` - OpenSSL bindings
- `perl-LWP-Protocol-https` - HTTPS protocol handler
- `perl-URI` - URI manipulation library

### Via CPAN:
- `Mozilla::CA` - Mozilla CA certificate bundle

## Testing Commands

```bash
# Test HTTPS connectivity
perl -MLWP::UserAgent -e '
  my $ua = LWP::UserAgent->new(ssl_opts => { verify_hostname => 1 });
  my $response = $ua->get("https://www.google.com");
  print $response->is_success ? "PASSED\n" : "FAILED\n";
'

# Test API endpoint
curl -H "x-api-key: YOUR_KEY" "https://dids.amdy.io/api/v1/health"

# Test DID selection
./quick-test.sh TEST001 4155551234
```

## Directory Structure

```
/etc/asterisk/dids.conf              # Configuration file
/usr/share/astguiclient/*.pl         # Main Perl scripts
/var/lib/asterisk/agi-bin/*.agi      # AGI scripts
/var/log/astguiclient/*.log          # Log files
```

## Support

If issues persist:
1. Check logs: `tail -f /var/log/astguiclient/did_optimizer.log`
2. Run verbose test: `./test-vicidial-integration.pl --verbose`
3. Check system logs: `sudo journalctl -xe`
4. Verify firewall: `sudo firewall-cmd --list-all`
5. Check SELinux: `sudo grep denied /var/log/audit/audit.log`
