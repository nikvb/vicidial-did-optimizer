import express from 'express';
import VICIdialSetting from '../models/VICIdialSetting.js';
import Campaign from '../models/Campaign.js';
import axios from 'axios';
import https from 'https';

const router = express.Router();

// GET /api/v1/settings/vicidial - Get VICIdial settings
router.get('/', async (req, res) => {
  try {
    const settings = await VICIdialSetting.findOne();
    if (!settings) {
      return res.status(404).json({ success: false, error: 'VICIdial settings not found' });
    }
    res.json({ success: true, data: settings });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// POST /api/v1/settings/vicidial - Save VICIdial settings
router.post('/', async (req, res) => {
  const { hostname, username, password } = req.body;

  try {
    let settings = await VICIdialSetting.findOne();
    if (settings) {
      // Update existing settings
      settings.hostname = hostname;
      settings.username = username;
      settings.password = password; // Plain text - VICIdial API requires it
      await settings.save();
    } else {
      // Create new settings
      settings = new VICIdialSetting({ hostname, username, password });
      await settings.save();
    }
    res.json({ success: true, data: settings });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// POST /api/v1/settings/vicidial/test - Test VICIdial connection
router.post('/test', async (req, res) => {
  const { hostname, username, password } = req.body;

  // Validate input
  if (!hostname || !username || !password) {
    return res.status(400).json({
      success: false,
      message: 'Missing required fields',
      details: 'Please provide hostname, username, and password'
    });
  }

  try {
    // Allow full URL or just hostname (defaults to https://)
    let url;
    if (hostname.startsWith('http://') || hostname.startsWith('https://')) {
      url = `${hostname}/vicidial/non_agent_api.php`;
    } else {
      // Default to https:// (most VICIdial servers use HTTPS)
      url = `https://${hostname}/vicidial/non_agent_api.php`;
    }
    console.log(`🔗 Testing VICIdial connection to: ${url}`);

    const response = await axios.get(url, {
      params: {
        function: 'version',
        source: 'test',
        user: username,
        pass: password,
      },
      timeout: 10000, // 10 second timeout
      validateStatus: (status) => status < 500, // Don't throw on 4xx errors
      httpsAgent: new https.Agent({
        rejectUnauthorized: false // Allow self-signed certificates
      })
    });

    console.log(`📡 VICIdial response status: ${response.status}`);
    console.log(`📄 VICIdial response: ${response.data?.substring(0, 200)}`);

    // Check if response contains VERSION string
    if (response.data && response.data.includes('VERSION')) {
      return res.json({
        success: true,
        message: 'Successfully connected to VICIdial',
        version: response.data.trim()
      });
    }

    // Check for authentication errors
    if (response.data && (response.data.includes('ERROR') || response.data.includes('INVALID'))) {
      return res.status(401).json({
        success: false,
        message: 'Authentication failed',
        details: 'Invalid username or password. Please check your VICIdial API credentials.'
      });
    }

    // Check for permission errors
    if (response.data && response.data.includes('PERMISSION')) {
      return res.status(403).json({
        success: false,
        message: 'Permission denied',
        details: 'User does not have API permissions. Please grant the required API permissions in VICIdial admin panel.'
      });
    }

    // Unknown response
    return res.status(400).json({
      success: false,
      message: 'Unexpected response from VICIdial',
      details: `Received: ${response.data?.substring(0, 100)}...`
    });

  } catch (error) {
    console.error('❌ VICIdial connection error:', error.message);

    // Network/DNS errors
    if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') {
      return res.status(404).json({
        success: false,
        message: 'Hostname not found',
        details: `Cannot resolve hostname "${hostname}". Please check the VICIdial server address.`
      });
    }

    // Connection refused
    if (error.code === 'ECONNREFUSED') {
      return res.status(503).json({
        success: false,
        message: 'Connection refused',
        details: `Cannot connect to ${hostname}. Please check if VICIdial is running and accessible.`
      });
    }

    // Host unreachable (network issue or firewall)
    if (error.code === 'EHOSTUNREACH' || error.code === 'ENETUNREACH') {
      return res.status(503).json({
        success: false,
        message: 'Host unreachable',
        details: `Cannot reach ${hostname}. The server may be down, behind a firewall, or our IP addresses (65.21.161.173, 2a01:4f9:3071:240b::2) may need to be whitelisted.`
      });
    }

    // Timeout
    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      return res.status(504).json({
        success: false,
        message: 'Connection timeout',
        details: `Server did not respond within 10 seconds. Please check if ${hostname} is reachable.`
      });
    }

    // SSL/TLS errors
    if (error.message.includes('certificate') || error.message.includes('SSL') || error.message.includes('TLS')) {
      return res.status(495).json({
        success: false,
        message: 'SSL certificate error',
        details: 'Invalid or self-signed SSL certificate. Try using HTTP instead or install a valid certificate.'
      });
    }

    // Firewall/IP blocking
    if (error.code === 'ETIMEDOUT') {
      return res.status(503).json({
        success: false,
        message: 'Connection timed out',
        details: `Cannot reach ${hostname}. Please whitelist our IP addresses (65.21.161.173, 2a01:4f9:3071:240b::2) in your VICIdial firewall.`
      });
    }

    // Generic error
    return res.status(500).json({
      success: false,
      message: 'Connection failed',
      details: error.message || 'An unexpected error occurred while connecting to VICIdial.'
    });
  }
});

// POST /api/v1/settings/vicidial/sync-campaigns - Sync campaigns from VICIdial
router.post('/sync-campaigns', async (req, res) => {
  try {
    // Get VICIdial settings
    const settings = await VICIdialSetting.findOne();
    if (!settings) {
      return res.status(404).json({
        success: false,
        message: 'VICIdial not configured',
        details: 'Please configure VICIdial connection first in Settings → VICIdial Integration'
      });
    }

    // Build URL
    let url;
    if (settings.hostname.startsWith('http://') || settings.hostname.startsWith('https://')) {
      url = `${settings.hostname}/vicidial/non_agent_api.php`;
    } else {
      url = `https://${settings.hostname}/vicidial/non_agent_api.php`;
    }

    console.log(`🔄 Syncing campaigns from VICIdial: ${url}`);

    // Call VICIdial API
    const response = await axios.get(url, {
      params: {
        function: 'campaigns_list',
        source: 'didoptimizer',
        user: settings.username,
        pass: settings.password,
        stage: 'pipe',
        header: 'YES',
      },
      timeout: 30000,
      validateStatus: (status) => status < 500,
      httpsAgent: new https.Agent({
        rejectUnauthorized: false
      })
    });

    console.log(`📡 VICIdial campaigns response: ${response.data?.substring(0, 200)}`);

    // Check for errors
    if (response.data && response.data.includes('ERROR')) {
      // Check for permission error
      if (response.data.includes('PERMISSION') || response.data.includes('USER DOES NOT HAVE PERMISSION')) {
        return res.status(403).json({
          success: false,
          message: 'Permission denied',
          details: 'The API user does not have permission to access campaigns. Please grant the "campaigns_list" permission in VICIdial admin panel under User → Modify user → API permissions.'
        });
      }

      // Check for no viewable campaigns
      if (response.data.includes('NO VIEWABLE CAMPAIGNS')) {
        return res.json({
          success: true,
          message: 'No campaigns found',
          campaigns: [],
          synced: 0
        });
      }

      return res.status(400).json({
        success: false,
        message: 'VICIdial API error',
        details: response.data
      });
    }

    // Parse campaigns
    const lines = response.data.trim().split('\n');
    const campaigns = [];
    const header = lines[0]; // campaign_id|campaign_name|active|user_group|dial_method|dial_level|lead_order|dial_statuses

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const parts = line.split('|');
      if (parts.length >= 8) {
        campaigns.push({
          campaignId: parts[0],
          campaignName: parts[1],
          active: parts[2],
          userGroup: parts[3],
          dialMethod: parts[4],
          dialLevel: parseInt(parts[5]) || 0,
          leadOrder: parts[6],
          dialStatuses: parts[7],
        });
      }
    }

    console.log(`📊 Found ${campaigns.length} campaigns`);

    // Get user's tenant ID
    const userTenantId = req.user?.tenantId;

    // Save campaigns to database
    let syncedCount = 0;
    for (const camp of campaigns) {
      await Campaign.findOneAndUpdate(
        { campaignId: camp.campaignId, tenantId: userTenantId },
        {
          ...camp,
          tenantId: userTenantId,
          lastSyncedAt: new Date(),
          syncSource: 'api',
        },
        { upsert: true, new: true }
      );
      syncedCount++;
    }

    console.log(`✅ Synced ${syncedCount} campaigns to database`);

    res.json({
      success: true,
      message: `Successfully synced ${syncedCount} campaign${syncedCount !== 1 ? 's' : ''}`,
      campaigns: campaigns,
      synced: syncedCount
    });

  } catch (error) {
    console.error('❌ Campaign sync error:', error.message);

    // Network errors
    if (error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT' || error.code === 'EHOSTUNREACH') {
      return res.status(503).json({
        success: false,
        message: 'Cannot connect to VICIdial',
        details: 'Please check your VICIdial connection settings.'
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Campaign sync failed',
      details: error.message || 'An unexpected error occurred'
    });
  }
});

// GET /api/v1/settings/vicidial/campaigns - Get synced campaigns
router.get('/campaigns', async (req, res) => {
  try {
    const userTenantId = req.user?.tenantId;
    const campaigns = await Campaign.find(
      userTenantId ? { tenantId: userTenantId } : {}
    ).sort({ campaignName: 1 });

    res.json({
      success: true,
      campaigns: campaigns,
      count: campaigns.length
    });
  } catch (error) {
    console.error('❌ Error fetching campaigns:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch campaigns',
      error: error.message
    });
  }
});

// GET /api/v1/settings/vicidial/generate-config - Generate dids.conf file
router.get('/generate-config', async (req, res) => {
  try {
    // Get user's API key
    const apiKey = req.user?.apiKey || process.env.API_KEY || 'YOUR_API_KEY_HERE';

    const config = `# DID Optimizer Pro Configuration
# Location: /etc/asterisk/dids.conf
#
# This file contains configuration settings for VICIdial DID Optimizer integration
# Make sure this file is readable only by asterisk user for security
#
# Recommended permissions:
# chown asterisk:asterisk /etc/asterisk/dids.conf
# chmod 600 /etc/asterisk/dids.conf

[general]
# API Configuration
api_base_url=${process.env.API_BASE_URL || 'https://dids.amdy.io'}
api_key=${apiKey}
api_timeout=10
max_retries=3

# Fallback DID when API is unavailable
fallback_did=+18005551234

# Logging Configuration
log_file=/var/log/astguiclient/did-optimizer.log
debug=1

# Database Configuration for Customer Data (VICIdial)
# These values are read from /etc/astguiclient.conf if available
db_host=localhost
db_user=cron
db_pass=1234
db_name=asterisk

# Performance Settings
daily_usage_limit=200
max_distance_miles=500

# Geographic Settings
enable_geographic_routing=1
enable_state_fallback=1
enable_area_code_detection=1

# AI Training Data Collection
collect_ai_data=1
include_customer_demographics=1
include_call_context=1
include_performance_metrics=1

# Cache Settings
context_cache_dir=/tmp/did_optimizer
context_cache_ttl=3600

# Notification Settings (optional)
notification_email=
alert_on_api_failure=1
alert_on_daily_limit=0

# Privacy Mode (mask phone numbers in logs)
privacy_mode=0

# Advanced Geographic Settings
geographic_algorithm=haversine
coordinate_precision=4
state_center_coordinates=1
zip_geocoding=0

# Connection Settings
verify_ssl=1
connection_timeout=30
read_timeout=60
`;

    res.set('Content-Type', 'text/plain');
    res.set('Content-Disposition', 'attachment; filename="dids.conf"');
    res.send(config);
  } catch (error) {
    console.error('Error generating config:', error);
    res.status(500).json({ success: false, error: 'Failed to generate configuration file' });
  }
});

export default router;
