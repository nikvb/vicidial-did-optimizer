# CentOS 7 Installation Guide - VICIdial DID Optimizer

Complete installation guide for CentOS 7 systems using **100% CPAN-based installation** (no yum/dnf required for Perl modules).

## Why CPAN-Only Installation?

**CentOS 7 reached End of Life on June 30, 2024.**

Benefits of our CPAN-only approach:
- ✅ No dependency on EOL CentOS 7 repositories
- ✅ Latest stable Perl modules (not 5+ year old yum packages)
- ✅ Works even when vault.centos.org is slow/unreachable
- ✅ Simpler installation process
- ✅ No repository configuration needed

**Example Version Comparison:**
| Module | CentOS 7 yum | CPAN |
|--------|--------------|------|
| LWP::UserAgent | 6.06 (2014) | 6.77 (2024) |
| IO::Socket::SSL | 1.94 (2015) | 2.089 (2024) |
| DBD::mysql | 4.023 (2013) | 5.008 (2024) |

## Prerequisites

### System Requirements
- CentOS 7.x or RHEL 7.x
- Root or sudo access
- Active internet connection
- VICIdial already installed
- Asterisk already installed

### Required Build Tools

**IMPORTANT:** The following build tools must be installed via yum (one-time setup):

```bash
# Install build essentials (required for compiling Perl modules)
sudo yum install -y gcc make perl openssl openssl-devel
```

**Why these are needed:**
- `gcc` - Compiles XS (C-based) Perl modules
- `make` - Builds module makefiles
- `perl` - Perl interpreter (usually pre-installed)
- `openssl` + `openssl-devel` - SSL/TLS support for HTTPS

**That's it!** Everything else is installed via CPAN.

## Quick Installation (Recommended)

### One-Line Installer

Download and run the automated CPAN-based installer:

```bash
curl -fsSL https://raw.githubusercontent.com/nikvb/vicidial-did-optimizer/main/vicidial-integration/scripts/install-centos7.sh | sudo bash
```

This script will:
1. ✅ Check for build tools (gcc, make, perl, openssl)
2. ✅ Auto-configure CPAN non-interactively
3. ✅ Install all Perl modules via CPAN
4. ✅ Verify installation
5. ✅ Test HTTPS connectivity

**Installation time:** 5-10 minutes (depending on internet speed)

### Manual Installation

If you prefer manual control:

#### 1. Install Build Tools

```bash
sudo yum install -y gcc make perl openssl openssl-devel
```

#### 2. Download Installer

```bash
cd /tmp
wget https://raw.githubusercontent.com/nikvb/vicidial-did-optimizer/main/vicidial-integration/scripts/install-centos7.sh
chmod +x install-centos7.sh
```

#### 3. Run Installer

```bash
sudo ./install-centos7.sh
```

The installer will guide you through the process with colored output and progress indicators.

## What Gets Installed via CPAN

All Perl modules are installed directly from CPAN (latest stable versions):

### Core Modules
- **LWP::UserAgent** - HTTP/HTTPS client for API requests
- **LWP::Protocol::https** - HTTPS protocol support
- **IO::Socket::SSL** - SSL socket layer
- **Net::SSLeay** - OpenSSL bindings
- **Mozilla::CA** - Mozilla's CA certificate bundle

### Data Handling
- **JSON** - JSON encoding/decoding for API responses
- **URI::Escape** - URL encoding/decoding

### Database
- **DBI** - Database independent interface
- **DBD::mysql** - MySQL/MariaDB driver for VICIdial database

### Installation Flags

Modules are installed with `-T` flag (skip tests):
```bash
cpan -T Module::Name
```

**Why skip tests?**
- Tests can take 10-30 minutes per module
- Tests often fail on production environments (lack of test dependencies)
- Installation without tests is safe for production use

## Verify Installation

### Test Perl Modules

The installer automatically tests all modules, but you can verify manually:

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
perl -MLWP::UserAgent -e '
    my $ua = LWP::UserAgent->new(ssl_opts => { verify_hostname => 1 });
    my $response = $ua->get("https://www.google.com");
    print "HTTPS Test: ", $response->is_success ? "PASSED\n" : "FAILED\n";
'
```

**Expected output:** `HTTPS Test: PASSED`

## Next Steps

After prerequisites are installed, run the main VICIdial integration installer:

```bash
curl -fsSL https://raw.githubusercontent.com/nikvb/vicidial-did-optimizer/main/vicidial-integration/scripts/install-vicidial-integration-autodetect.sh | sudo bash
```

Or download and run manually:

```bash
cd /tmp
wget https://raw.githubusercontent.com/nikvb/vicidial-did-optimizer/main/vicidial-integration/scripts/install-vicidial-integration-autodetect.sh
chmod +x install-vicidial-integration-autodetect.sh
sudo ./install-vicidial-integration-autodetect.sh
```

## Troubleshooting

### Issue: "gcc: command not found" or "make: command not found"

**Cause:** Build tools not installed

**Solution:**
```bash
sudo yum install -y gcc make
```

### Issue: "Can't locate openssl/ssl.h" during module compilation

**Cause:** OpenSSL development headers missing

**Solution:**
```bash
sudo yum install -y openssl-devel
```

### Issue: CPAN asks interactive questions

**Cause:** CPAN not configured yet

**Solution:** The installer auto-configures CPAN. To do manually:
```bash
sudo perl -MCPAN -e 'my $c = "CPAN::HandleConfig"; $c->load(doit => 1, autoconfig => 1);'
```

### Issue: Module installation fails with errors

**Solution:** Force installation (ignores test failures):
```bash
sudo cpan -f Module::Name
```

### Issue: "Can't connect to cpan.org"

**Cause:** Firewall blocking HTTPS

**Solution:**
```bash
# Check firewall
sudo firewall-cmd --state

# If active, ensure HTTPS is allowed (usually is by default)
sudo firewall-cmd --list-all | grep https

# Test connectivity
curl -I https://cpan.org
```

### Issue: "SSL connect attempt failed"

**Cause:** CA certificates outdated

**Solution:**
```bash
# Update CA certificates
sudo yum install -y ca-certificates
sudo update-ca-trust

# Reinstall SSL modules via CPAN
sudo cpan -f IO::Socket::SSL Net::SSLeay Mozilla::CA
```

### Issue: CPAN builds are very slow

**Cause:** Running tests (can take 30+ minutes)

**Solution:** Always use `-T` flag:
```bash
cpan -T Module::Name  # Skip tests (recommended)
```

## Advanced Configuration

### Custom CPAN Mirror

If CPAN mirrors are slow, specify a faster mirror:

```bash
# Edit CPAN configuration
sudo cpan
> o conf urllist push http://cpan.mirrors.uk2.net/
> o conf commit
> exit
```

### Offline Installation

For systems without internet access:

1. Download modules on internet-connected machine:
```bash
cpanm --mirror-only --mirror http://www.cpan.org/ \
  --save-dists /path/to/tarballs \
  LWP::UserAgent JSON DBI DBD::mysql
```

2. Transfer tarballs to offline machine

3. Install from local directory:
```bash
cpan -T /path/to/tarballs/*.tar.gz
```

### View Installation Logs

```bash
# View CPAN build log
cat ~/.cpan/build.log

# View last 50 lines
tail -50 ~/.cpan/build.log

# Search for errors
grep -i error ~/.cpan/build.log
```

## Security Considerations

### Firewall Configuration

```bash
# Check firewall status
sudo firewall-cmd --state

# Ensure HTTPS outbound is allowed (usually default)
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

### SELinux Considerations

CentOS 7 has SELinux enabled by default:

```bash
# Check SELinux status
getenforce

# If enforcing and having AGI execution issues
sudo grep denied /var/log/audit/audit.log

# Temporary disable for testing (NOT for production)
sudo setenforce 0

# Re-enable
sudo setenforce 1
```

## Performance Notes

### CPAN Cache Location

CPAN builds cache in `/root/.cpan/` (if running as root):

```bash
# View cache size
du -sh ~/.cpan/

# Clean old builds (safe to delete)
rm -rf ~/.cpan/build/*
```

### Module Load Time

First time loading a module may be slow. This is normal:
- Perl compiles modules on first use
- Subsequent loads are instant

## Installation Verification Checklist

After installation completes:

- [ ] gcc and make installed (`gcc --version && make --version`)
- [ ] Perl installed (`perl -v`)
- [ ] OpenSSL installed (`openssl version`)
- [ ] CPAN configured (`perl -MCPAN -e 1`)
- [ ] All Perl modules installed (see "Test Perl Modules" section)
- [ ] HTTPS test passed
- [ ] Ready to run main VICIdial integration installer

## Comparison: Old (yum) vs New (CPAN) Approach

| Aspect | Old (yum-based) | New (CPAN-only) |
|--------|-----------------|-----------------|
| **Repository dependency** | Requires EPEL + vault.centos.org | None |
| **Module versions** | 5-10 years old | Latest stable |
| **Installation steps** | 5+ commands | 1 command |
| **Failure points** | Repository unreachable, EOL issues | Rare |
| **Internet needed** | Yes (for repos) | Yes (for CPAN) |
| **Build tools** | Installed via yum | Installed via yum (one-time) |
| **Maintenance** | Requires repo updates | Self-contained |

## Support

If you encounter issues:

1. **Check installer output** - It shows detailed progress and errors
2. **View CPAN logs** - `cat ~/.cpan/build.log`
3. **Test modules individually** - See "Test Perl Modules" section
4. **Check build tools** - `gcc --version && make --version`
5. **Verify OpenSSL** - `openssl version && ls /usr/include/openssl/ssl.h`

## References

- CPAN: https://www.cpan.org/
- Perl Documentation: https://perldoc.perl.org/
- VICIdial Documentation: http://www.vicidial.org/docs/
- GitHub Repository: https://github.com/nikvb/vicidial-did-optimizer

---

**Note:** This installation method is specifically designed for CentOS 7's EOL status. For CentOS 8+ or other modern distributions, the main installer will automatically use dnf/yum where appropriate.
