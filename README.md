# 🚀 VICIdial DID Optimizer

**Multi-Tenant DID Optimization Service for VICIdial** with intelligent rotation algorithms, real-time analytics, and machine learning-based optimization.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![VICIdial](https://img.shields.io/badge/VICIdial-Compatible-blue.svg)](http://www.vicidial.org/)

## 📋 Overview

This system provides intelligent Direct Inward Dialing (DID) optimization for VICIdial call centers, featuring:

- **🌍 Geographic Proximity Matching**: Automatically selects DIDs closest to customer locations
- **📊 Daily Usage Limits**: Prevents DID burnout with configurable usage caps
- **🤖 AI-Powered Optimization**: Machine learning models that improve selection over time
- **🔐 Multi-Tenant Architecture**: Secure isolation for multiple organizations
- **📈 Real-Time Analytics**: Comprehensive metrics and reporting
- **⚡ High Performance**: Optimized for high-volume call centers

## 🎯 Key Features

### Intelligent DID Selection
- **Geographic Algorithm**: Uses Haversine formula for precise distance calculations
- **Usage Balancing**: Automatically distributes calls across DID pools
- **State/Area Code Matching**: Prioritizes local presence for better answer rates
- **Reputation Filtering**: Automatically excludes DIDs with poor reputation scores (<50)
- **Fallback Strategies**: Multiple algorithms ensure calls always get a DID

### VICIdial Integration
- **Seamless Setup**: Simple configuration via Asterisk dialplan
- **Real-Time API**: Fast DID selection during active calls
- **Comprehensive Reporting**: Collects call outcomes for AI training
- **Campaign-Specific Rules**: Different optimization strategies per campaign

### Analytics & Monitoring
- **Usage Tracking**: Monitor DID performance and utilization
- **Success Metrics**: Track answer rates, conversion rates, and more
- **Alert System**: Notifications for API failures or limit breaches
- **Export Options**: Data exports for external analysis

## 🚀 Quick Installation

### Prerequisites

- VICIdial server with Asterisk
- MongoDB server for DID Optimizer data
- Node.js 18+ for the API server
- Root access on VICIdial server for installation

### Step 1: Install DID Optimizer API Server

```bash
# Clone the repository
git clone https://github.com/nikvb/vicidial-did-optimizer.git
cd vicidial-did-optimizer

# Install dependencies
npm install

# Configure environment variables
cp .env.example .env
# Edit .env with your settings (MongoDB URL, API key, etc.)

# Start the server
PORT=5000 node server-full.js
```

### Step 2: Install VICIdial Integration (on VICIdial server)

```bash
# 1. Download the installer
wget https://raw.githubusercontent.com/nikvb/vicidial-did-optimizer/main/vicidial-integration/install-vicidial-integration-autodetect.sh

# 2. Make it executable
chmod +x install-vicidial-integration-autodetect.sh

# 3. Run the installer (as root)
sudo ./install-vicidial-integration-autodetect.sh
```

The installer will:
- ✅ Auto-detect your VICIdial database settings
- ✅ Auto-detect your AGI directory location
- ✅ Install all required AGI scripts
- ✅ Configure the API endpoint settings
- ✅ Set up logging in `/var/log/astguiclient/`
- ✅ Install Perl dependencies automatically

### Step 3: Configure API Endpoint

After installation, edit `/etc/asterisk/dids.conf` to set your API server details:

```ini
[general]
# Your DID Optimizer API server
api_base_url=http://your-api-server:5000
api_key=YOUR_ACTUAL_API_KEY_HERE

# Fallback DID when API is unavailable
fallback_did=+18005551234
```

### Option 2: Manual Installation

1. **Install the DID Optimizer Service** (see [Server Setup](#server-setup))
2. **Configure VICIdial Integration** (see [VICIdial Setup](#vicidial-setup))

## 🖥️ Server Setup

### Prerequisites
- Node.js 18+
- MongoDB 4.4+
- Redis 6+
- PostgreSQL 12+ (optional)

### Installation Steps

```bash
# Clone the repository
git clone https://github.com/nikvb/vicidial-did-optimizer.git
cd vicidial-did-optimizer

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your database credentials

# Start the service
npm start
```

### Environment Configuration

```bash
# Database
MONGODB_URI=mongodb://localhost:27017/did_optimizer
REDIS_URL=redis://localhost:6379

# API Configuration
PORT=3001
JWT_SECRET=your_jwt_secret_here
API_KEY=your_secure_api_key

# VICIdial Integration
VICIDIAL_DB_HOST=localhost
VICIDIAL_DB_USER=cron
VICIDIAL_DB_PASS=1234
VICIDIAL_DB_NAME=asterisk
```

## 📞 VICIdial Setup

### 1. Install Integration Files

The installer automatically handles this, or manually:

```bash
# Copy configuration
sudo cp dids.conf /etc/asterisk/
sudo chmod 600 /etc/asterisk/dids.conf

# Copy integration script
sudo cp vicidial-did-optimizer-config.pl /usr/share/astguiclient/
sudo chmod +x /usr/share/astguiclient/vicidial-did-optimizer-config.pl

# Install Perl dependencies
sudo apt-get install libwww-perl libjson-perl libdbi-perl libdbd-mysql-perl
```

### 2. Configure API Settings

Edit `/etc/asterisk/dids.conf`:

```ini
[general]
# Your DID Optimizer server
api_base_url=http://your-server.com:3001
api_key=your_actual_api_key_here

# Optimization settings
daily_usage_limit=200
max_distance_miles=500
enable_geographic_routing=1
```

### 3. Update Asterisk Dialplan

Add to `/etc/asterisk/extensions.conf` (or let the installer handle this):

```asterisk
; DID Optimizer Integration
[did-optimizer]
exten => _X.,1,NoOp(=== DID Optimizer: Processing ${EXTEN} ===)
exten => _X.,n,System(/usr/share/astguiclient/vicidial-did-optimizer-config.pl "${campaign}" "${agent}" "${EXTEN}" > /tmp/did_${campaign}_${UNIQUEID})
exten => _X.,n,Set(SELECTED_DID=${FILE(/tmp/did_${campaign}_${UNIQUEID})})
exten => _X.,n,Set(CALLERID(num)=${SELECTED_DID})
exten => _X.,n,Goto(vicidial-auto,${EXTEN},1)

; Modify your [vicidial-auto] context - add as first line:
[vicidial-auto]
exten => _X.,1,GotoIf($["${CALLERID(num)}" = "COMPAT_DID_OPTIMIZER"]?did-optimizer,${EXTEN},1)
; ... rest of your existing dialplan ...
```

### 4. Configure VICIdial Campaign

1. **Login to VICIdial Admin Interface**
2. **Go to:** Admin → Campaigns → [Your Campaign]
3. **Set Outbound Caller ID:** `COMPAT_DID_OPTIMIZER`
4. **Set Campaign CID Override:** `Y`
5. **Click SUBMIT**

### 5. Reload Asterisk

```bash
sudo asterisk -rx "dialplan reload"
```

## 🧪 Testing

### Test API Connection
```bash
sudo -u asterisk /usr/share/astguiclient/vicidial-did-optimizer-config.pl --test
```

### Test DID Selection
```bash
sudo -u asterisk /usr/share/astguiclient/vicidial-did-optimizer-config.pl "CAMPAIGN001" "1001" "4155551234" "CA" "94102"
```

### Monitor Logs
```bash
# DID Optimizer logs
tail -f /var/log/astguiclient/did_optimizer.log

# Asterisk logs
tail -f /var/log/asterisk/messages
```

## 📊 API Endpoints

### Get Next DID
```http
GET /api/v1/dids/next?campaign_id=SALES001&agent_id=1001&customer_phone=4155551234&customer_state=CA&customer_zip=94102
```

### Health Check
```http
GET /api/v1/health
```

### Analytics
```http
GET /api/v1/analytics/metrics
GET /api/v1/analytics/reports
```

## 🔧 Configuration Options

### Rotation Algorithms
- **`geographic`**: Distance-based selection with daily limits
- **`round_robin`**: Equal distribution across DIDs
- **`random`**: Random selection from available pool
- **`least_used`**: Prioritizes DIDs with lowest usage
- **`ml_optimized`**: AI-powered selection (requires training)

### Geographic Settings
- **`max_distance_miles`**: Maximum distance for DID selection
- **`enable_state_fallback`**: Use state-level matching if no local DIDs
- **`enable_area_code_detection`**: Match area codes when possible

### Performance Tuning
- **`daily_usage_limit`**: Max calls per DID per day (default: 200)
- **`api_timeout`**: Request timeout in seconds (default: 10)
- **`cache_ttl`**: Cache time-to-live in seconds (default: 3600)

## 🚨 Troubleshooting

### Common Issues

**❌ "API key not configured"**
```bash
# Solution: Update the config file
sudo nano /etc/asterisk/dids.conf
# Set: api_key=your_actual_key_here
```

**❌ "Permission denied"**
```bash
# Solution: Fix file permissions
sudo chmod 600 /etc/asterisk/dids.conf
```

**❌ "Can't locate JSON.pm"**
```bash
# Solution: Install Perl dependencies
sudo apt-get install libwww-perl libjson-perl libdbi-perl libdbd-mysql-perl
```

### Debug Commands
```bash
# Check script permissions
ls -la /usr/share/astguiclient/vicidial-did-optimizer-config.pl

# Test API connectivity
curl -H "x-api-key: YOUR_KEY" http://your-server:3001/api/v1/health

# Check configuration loading
sudo -u asterisk /usr/share/astguiclient/vicidial-did-optimizer-config.pl --config
```

## 📚 Documentation

- **[Quick Setup Guide](QUICK_SETUP_GUIDE.md)** - Get up and running in 3 steps
- **[Dialplan Integration](VICIDIAL_DIALPLAN_INTEGRATION.md)** - Detailed VICIdial setup
- **[Step-by-Step Dialplan Modification](DIALPLAN_MODIFICATION_STEPS.md)** - Manual configuration guide
- **[API Documentation](docs/API.md)** - Complete API reference
- **[Configuration Reference](docs/CONFIGURATION.md)** - All configuration options

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Setup
```bash
git clone https://github.com/nikvb/vicidial-did-optimizer.git
cd vicidial-did-optimizer
npm install
npm run dev
```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- **📧 Email**: support@example.com
- **🐛 Issues**: [GitHub Issues](https://github.com/nikvb/vicidial-did-optimizer/issues)
- **💬 Discussions**: [GitHub Discussions](https://github.com/nikvb/vicidial-did-optimizer/discussions)

## 🎉 Success Stories

When working correctly, you'll see:

✅ **Improved Answer Rates**: Local presence increases customer pickup rates
✅ **Balanced DID Usage**: Prevents individual DIDs from being flagged as spam
✅ **Real-Time Optimization**: AI learns and improves selection over time
✅ **Comprehensive Analytics**: Deep insights into call performance

---

**🚀 Transform your VICIdial campaigns with intelligent DID optimization!**