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
- **🎯 VICIdial AGI Integration**: Proper AGI-based integration following VICIdial best practices

## 🎯 Key Features

### Intelligent DID Selection
- **Geographic Algorithm**: Uses Haversine formula for precise distance calculations
- **Usage Balancing**: Automatically distributes calls across DID pools
- **State/Area Code Matching**: Prioritizes local presence for better answer rates
- **Fallback Strategies**: Multiple algorithms ensure calls always get a DID

### VICIdial Integration
- **🔥 AGI-Based Integration**: Uses proper AGI scripts instead of System() calls
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

### Option 1: AGI-Based Installation (Recommended)

```bash
# 1. Download the AGI installer
wget https://raw.githubusercontent.com/nikvb/vicidial-did-optimizer/main/install-vicidial-integration-agi.sh

# 2. Make it executable
chmod +x install-vicidial-integration-agi.sh

# 3. Run the installer (as root)
sudo ./install-vicidial-integration-agi.sh
```

### Option 2: System() Call Installation (Alternative)

```bash
# 1. Download the standard installer
wget https://raw.githubusercontent.com/nikvb/vicidial-did-optimizer/main/install-vicidial-integration.sh

# 2. Make it executable
chmod +x install-vicidial-integration.sh

# 3. Run the installer (as root)
sudo ./install-vicidial-integration.sh
```

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

### AGI-Based Integration (Recommended)

The AGI installer automatically handles this, or manually:

```bash
# Copy AGI scripts
sudo cp agi-did-optimizer.agi /usr/share/astguiclient/agi-bin/
sudo cp agi-did-optimizer-report.agi /usr/share/astguiclient/agi-bin/
sudo chmod +x /usr/share/astguiclient/agi-bin/agi-did-optimizer*.agi

# Copy configuration
sudo cp dids.conf /etc/asterisk/
sudo chown asterisk:asterisk /etc/asterisk/dids.conf
sudo chmod 600 /etc/asterisk/dids.conf
```

### Update Asterisk Dialplan (AGI Version)

Add to `/etc/asterisk/extensions.conf`:

```asterisk
; DID Optimizer Integration - AGI Version
[did-optimizer]
exten => _X.,1,NoOp(=== DID Optimizer: Processing ${EXTEN} ===)
exten => _X.,n,Set(CUSTOMER_PHONE=${EXTEN})
exten => _X.,n,Set(CAMPAIGN_ID=${campaign})
exten => _X.,n,Set(AGENT_ID=${agent})

; Call DID optimizer AGI script
exten => _X.,n,AGI(agi-did-optimizer.agi,${CAMPAIGN_ID},${AGENT_ID},${CUSTOMER_PHONE})

; Set the optimized caller ID (set by AGI)
exten => _X.,n,Set(CALLERID(num)=${OPTIMIZED_DID})
exten => _X.,n,NoOp(DID Optimizer: Selected ${OPTIMIZED_DID})
exten => _X.,n,Goto(vicidial-auto,${EXTEN},1)

; Call completion handler
exten => h,1,AGI(agi-did-optimizer-report.agi,${CAMPAIGN_ID},${CUSTOMER_PHONE},${DIALSTATUS},${ANSWEREDTIME},${disposition})

; Modify your [vicidial-auto] context - add as first line:
[vicidial-auto]
exten => _X.,1,GotoIf($["${CALLERID(num)}" = "COMPAT_DID_OPTIMIZER"]?did-optimizer,${EXTEN},1)
; ... rest of your existing dialplan ...
```

### Configure VICIdial Campaign

1. **Login to VICIdial Admin Interface**
2. **Go to:** Admin → Campaigns → [Your Campaign]
3. **Set Outbound Caller ID:** `COMPAT_DID_OPTIMIZER`
4. **Set Campaign CID Override:** `Y`
5. **Click SUBMIT**

### Configure API Settings

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

### Reload Asterisk

```bash
sudo asterisk -rx "dialplan reload"
```

## 🧪 Testing

### Test AGI Scripts
```bash
# Test main AGI script
sudo -u asterisk /usr/share/astguiclient/agi-bin/agi-did-optimizer.agi TEST001 1001 4155551234

# Test quick script
sudo -u asterisk /usr/share/astguiclient/agi-bin/did-optimizer-quick.pl TEST001 1001 4155551234

# Test API connection
sudo -u asterisk /usr/share/astguiclient/vicidial-did-optimizer-config.pl --test
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
sudo chown asterisk:asterisk /etc/asterisk/dids.conf
sudo chmod 600 /etc/asterisk/dids.conf
sudo chmod +x /usr/share/astguiclient/agi-bin/agi-did-optimizer*.agi
```

**❌ "Can't locate JSON.pm"**
```bash
# Solution: Install Perl dependencies
sudo apt-get install libwww-perl libjson-perl libdbi-perl libdbd-mysql-perl
```

### Debug Commands
```bash
# Check AGI script permissions
ls -la /usr/share/astguiclient/agi-bin/agi-did-optimizer*

# Test API connectivity
curl -H "x-api-key: YOUR_KEY" http://your-server:3001/api/v1/health

# Check configuration loading
sudo -u asterisk /usr/share/astguiclient/vicidial-did-optimizer-config.pl --config
```

## 📚 Documentation

- **[Quick Setup Guide](QUICK_SETUP_GUIDE.md)** - Get up and running in 3 steps
- **[AGI Dialplan Integration](vicidial-dialplan-agi.conf)** - AGI-based VICIdial setup
- **[System() Dialplan Integration](vicidial-dialplan-simple.conf)** - Alternative System() setup
- **[Step-by-Step Dialplan Modification](DIALPLAN_MODIFICATION_STEPS.md)** - Manual configuration guide

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

- **🐛 Issues**: [GitHub Issues](https://github.com/nikvb/vicidial-did-optimizer/issues)
- **💬 Discussions**: [GitHub Discussions](https://github.com/nikvb/vicidial-did-optimizer/discussions)

## 🎉 Success Stories

When working correctly, you'll see:

✅ **Improved Answer Rates**: Local presence increases customer pickup rates
✅ **Balanced DID Usage**: Prevents individual DIDs from being flagged as spam
✅ **Real-Time Optimization**: AI learns and improves selection over time
✅ **Comprehensive Analytics**: Deep insights into call performance
✅ **Proper VICIdial Integration**: AGI-based approach follows VICIdial best practices

---

**🚀 Transform your VICIdial campaigns with intelligent DID optimization!**