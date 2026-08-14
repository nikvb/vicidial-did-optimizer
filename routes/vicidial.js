import express from 'express';
import VICIdialSetting from '../models/VICIdialSetting.js';
import Campaign from '../models/Campaign.js';
import axios from 'axios';
import https from 'https';
import { authenticate } from '../middleware/auth.js';
import {
  testConnection as didSyncTestConnection,
  syncDidsForTenant,
  fetchDidList,
} from '../services/vicidial-sync-service.js';

const router = express.Router();

// Apply auth to all routes except download-config (which uses API key)
router.use((req, res, next) => {
  if (req.path === '/download-config') return next();
  return authenticate(req, res, next);
});

// GET /api/v1/settings/vicidial - Get VICIdial settings (tenant-scoped)
router.get('/', async (req, res) => {
  try {
    const tenantId = req.user?.tenant?._id || req.user?.tenant;
    if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant required' });

    const settings = await VICIdialSetting.findOne({ tenantId });
    if (!settings) {
      return res.status(404).json({ success: false, error: 'VICIdial settings not found' });
    }
    res.json({ success: true, data: settings });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// POST /api/v1/settings/vicidial - Save VICIdial settings (tenant-scoped)
router.post('/', async (req, res) => {
  const { hostname, username, password } = req.body;

  try {
    const tenantId = req.user?.tenant?._id || req.user?.tenant;
    if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant required' });

    let settings = await VICIdialSetting.findOne({ tenantId });
    if (settings) {
      settings.hostname = hostname;
      settings.username = username;
      settings.password = password;
      await settings.save();
    } else {
      settings = new VICIdialSetting({ tenantId, hostname, username, password });
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

    // Use campaigns_list (the same call /sync-campaigns makes) instead of version.
    // VICIdial's `version` function bypasses auth entirely — so testing with it would
    // pass even with wrong credentials, only to fail at sync time. campaigns_list
    // requires real credentials AND the campaigns_list permission, so a successful
    // test guarantees a successful sync.
    const response = await axios.get(url, {
      params: {
        function: 'campaigns_list',
        source: 'didoptimizer-test',
        user: username,
        pass: password,
        stage: 'pipe',
        header: 'YES',
      },
      timeout: 10000, // 10 second timeout
      validateStatus: (status) => status < 500, // Don't throw on 4xx errors
      httpsAgent: new https.Agent({
        rejectUnauthorized: false // Allow self-signed certificates
      })
    });

    console.log(`📡 VICIdial response status: ${response.status}`);
    console.log(`📄 VICIdial response: ${response.data?.substring(0, 200)}`);

    // Bad credentials — VICIdial echoes them back in the response, sanitize before showing
    if (response.data && (response.data.includes('Login incorrect') || response.data.includes('|BAD|'))) {
      return res.status(401).json({
        success: false,
        message: 'Authentication failed',
        details: 'VICIdial rejected the username/password. Please verify your API user credentials in VICIdial Admin → Users.'
      });
    }

    // IP not whitelisted on the VICIdial side
    if (response.data && (response.data.includes('IP NOT IN ALLOWED LIST') || response.data.includes('ip_address NOT ALLOWED'))) {
      return res.status(403).json({
        success: false,
        message: 'IP not whitelisted in VICIdial',
        details: 'Your VICIdial server is rejecting our IP. Add 65.21.161.173 to the API user\'s "Allowed IPs" list.'
      });
    }

    // Permission missing for campaigns_list
    if (response.data && (response.data.includes('PERMISSION') || response.data.includes('USER DOES NOT HAVE PERMISSION'))) {
      return res.status(403).json({
        success: false,
        message: 'Permission denied',
        details: 'API user is missing the "campaigns_list" permission. Grant it in VICIdial Admin → Users → API permissions.'
      });
    }

    // Success — campaigns_list returns either a header line "campaign_id|..." or "NO VIEWABLE CAMPAIGNS"
    const isCampaignsListOK = response.data && (
      response.data.includes('campaign_id|') ||
      response.data.includes('NO VIEWABLE CAMPAIGNS')
    );

    if (isCampaignsListOK) {
      // Auto-save the working credentials so a subsequent Sync uses the same values
      // the user just verified. Without this, customers hit "Test passed but Sync failed"
      // because Sync reads from the DB and Test reads from the form.
      const tenantId = req.user?.tenant?._id || req.user?.tenant;
      let saved = false;
      if (tenantId) {
        try {
          await VICIdialSetting.findOneAndUpdate(
            { tenantId },
            { tenantId, hostname, username, password },
            { upsert: true, new: true }
          );
          saved = true;
        } catch (saveErr) {
          console.error('⚠️ Test passed but auto-save failed:', saveErr.message);
        }
      }
      // Count campaigns from the pipe-delimited response (subtract 1 for header row)
      const lineCount = response.data.trim().split('\n').filter(l => l.trim()).length;
      const campaignCount = response.data.includes('campaign_id|')
        ? Math.max(0, lineCount - 1)
        : 0;
      return res.json({
        success: true,
        message: saved
          ? `Successfully authenticated with VICIdial (${campaignCount} campaigns visible) — credentials saved`
          : `Successfully authenticated with VICIdial (${campaignCount} campaigns visible)`,
        campaignCount,
        saved
      });
    }

    // Generic ERROR response we didn't recognize
    if (response.data && response.data.includes('ERROR')) {
      return res.status(400).json({
        success: false,
        message: 'VICIdial returned an error',
        details: response.data.substring(0, 200)
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

// POST /api/v1/settings/vicidial/sync-campaigns - Sync campaigns from VICIdial (tenant-scoped)
router.post('/sync-campaigns', async (req, res) => {
  try {
    const tenantId = req.user?.tenant?._id || req.user?.tenant;
    if (!tenantId) return res.status(403).json({ success: false, message: 'Tenant required' });

    // Get VICIdial settings for THIS tenant
    const settings = await VICIdialSetting.findOne({ tenantId });
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
      // Wrong VICIdial username/password — the most common failure.
      // VICIdial echoes the password verbatim in its error response, so we sanitize before
      // showing to the user.
      if (response.data.includes('Login incorrect') || response.data.includes('|BAD|')) {
        return res.status(401).json({
          success: false,
          message: 'VICIdial login incorrect',
          details: 'The VICIdial username or password is wrong. Update them in Settings → VICIdial Integration → API Connection, then click Test Connection before retrying sync.'
        });
      }

      // IP not whitelisted
      if (response.data.includes('IP NOT IN ALLOWED LIST') || response.data.includes('ip_address NOT ALLOWED')) {
        return res.status(403).json({
          success: false,
          message: 'IP not whitelisted in VICIdial',
          details: 'Your VICIdial server is rejecting our IP. Add 65.21.161.173 to the API user\'s "Allowed IPs" list (VICIdial Admin → Users → API IPs).'
        });
      }

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

    // Save campaigns to database (tenant-scoped — reuse tenantId from above)
    let syncedCount = 0;
    for (const camp of campaigns) {
      await Campaign.findOneAndUpdate(
        { campaignId: camp.campaignId, tenantId: tenantId },
        {
          ...camp,
          tenantId: tenantId,
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

// GET /api/v1/settings/vicidial/campaigns - Get synced campaigns (tenant-scoped)
router.get('/campaigns', async (req, res) => {
  try {
    const tenantId = req.user?.tenant?._id || req.user?.tenant;
    if (!tenantId) return res.status(403).json({ success: false, message: 'Tenant required' });

    const campaigns = await Campaign.find({ tenantId }).sort({ campaignName: 1 });

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
router.get('/generate-config', authenticate, async (req, res) => {
  try {
    console.log('🔧 [CONFIG] Generate config request received');
    console.log('🔧 [CONFIG] User ID:', req.user?._id);
    console.log('🔧 [CONFIG] User tenant ID:', req.user?.tenant?._id);

    // Get user's tenant (already populated by auth middleware)
    const tenant = req.user?.tenant;

    if (!tenant) {
      console.log('❌ [CONFIG] No tenant found');
      return res.status(404).json({
        success: false,
        error: 'Tenant not found. Please ensure you are logged in.'
      });
    }

    console.log('✅ [CONFIG] Tenant found:', tenant.name);
    console.log('🔧 [CONFIG] API Keys count:', tenant.apiKeys?.length || 0);

    // Find first active API key
    const activeApiKey = tenant.apiKeys?.find(key => key.isActive);

    if (!activeApiKey) {
      console.log('❌ [CONFIG] No active API key found');
      return res.status(400).json({
        success: false,
        error: 'No API key found. Please create an API key in Settings → API Keys first.'
      });
    }

    const apiKey = activeApiKey.key;
    console.log('✅ [CONFIG] API key found:', apiKey.substring(0, 12) + '...');

    // Update lastUsed timestamp for the API key
    activeApiKey.lastUsed = new Date();
    await tenant.save();
    console.log('✅ [CONFIG] API key lastUsed updated');

    const config = `# DID Optimizer Pro Configuration
# Location: /etc/asterisk/dids.conf
#
# This file contains configuration settings for VICIdial DID Optimizer integration
# Make sure this file is readable only by asterisk user for security
#
# Recommended permissions:
# chmod 600 /etc/asterisk/dids.conf

[general]
# API Configuration
api_base_url=${process.env.FASTAPI_BASE_URL || 'http://api3.amdy.io:5001'}
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
    console.error('❌ [CONFIG] Error generating config:', error.message);
    console.error('❌ [CONFIG] Error stack:', error.stack);
    res.status(500).json({ success: false, error: error.message || 'Failed to generate configuration file' });
  }
});

// GET /api/v1/settings/vicidial/download-config?key=did_xxx
// Public endpoint — used by install-agi.sh to fetch dids.conf with just the API key
router.get('/download-config', async (req, res) => {
  try {
    const apiKey = req.query.key;
    if (!apiKey) {
      return res.status(400).json({ error: 'API key required. Usage: ?key=did_your_api_key' });
    }

    const Tenant = (await import('../models/Tenant.js')).default;
    const tenant = await Tenant.findOne({
      'apiKeys.key': apiKey,
      'apiKeys.isActive': true,
      isActive: true
    });

    if (!tenant) {
      return res.status(401).json({ error: 'Invalid API key' });
    }

    const config = `# DID Optimizer Pro Configuration
# Location: /etc/asterisk/dids.conf
# Generated for: ${tenant.name}
# Generated at: ${new Date().toISOString()}
#
# chmod 600 /etc/asterisk/dids.conf

[general]
api_base_url=http://api3.amdy.io:5001
api_key=${apiKey}
api_timeout=5
api_retry_count=2
api_retry_delay=1

# Leave empty — toll-free numbers are rejected as outbound CID by carriers
fallback_did=

log_file=/var/log/astguiclient/did-optimizer.log
log_level=INFO
debug_mode=0

# Cache disabled — caching breaks DID rotation (all calls in same batch get same DID)
cache_enabled=0

privacy_mode=0

# Dial prefixes to strip (longest first, comma-separated)
# Adjust for your VICIdial trunk configuration
dial_prefixes=9011,91,9
`;

    res.set('Content-Type', 'text/plain');
    res.send(config);
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate config: ' + error.message });
  }
});

// ============================================================================
// DID INVENTORY SYNC
// ============================================================================
//
// These endpoints let a tenant sync their VICIdial DID inventory into the
// didapi DID collection. See services/vicidial-sync-service.js for the full
// design, including the (important) note that canonical VICIdial does NOT
// ship a "list DIDs" function — we discover via did_log_export by default.

// PUT /api/v1/settings/vicidial/sync-config
// Update the sync configuration (mode, interval, lookback, etc.) without
// touching credentials. Credentials are managed via the existing POST /.
router.put('/sync-config', async (req, res) => {
  try {
    const tenantId = req.user?.tenant?._id || req.user?.tenant;
    if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant required' });

    const allowed = [
      'didSyncEnabled',
      'didSyncIntervalMinutes',
      'didSyncMode',
      'didSyncLookbackDays',
      'didSyncApiListFunction',
    ];
    const update = {};
    for (const k of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, k)) update[k] = req.body[k];
    }

    const settings = await VICIdialSetting.findOneAndUpdate(
      { tenantId },
      { $set: update },
      { new: true }
    );
    if (!settings) {
      return res.status(404).json({
        success: false,
        error: 'VICIdial not configured — save credentials first.'
      });
    }
    res.json({ success: true, data: settings });
  } catch (err) {
    console.error('❌ sync-config update error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/settings/vicidial/test-connection
// Lightweight reachability + auth check using the `version` API function.
// (Different from POST /test which uses campaigns_list; that one also asserts
// the campaigns_list permission. This one just confirms creds + connectivity.)
router.post('/test-connection', async (req, res) => {
  try {
    const tenantId = req.user?.tenant?._id || req.user?.tenant;
    if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant required' });

    // Accept inline overrides for an unsaved form, fall back to saved record.
    const { hostname, username, password } = req.body || {};
    let settings;
    if (hostname && username && password) {
      settings = { hostname, username, password };
    } else {
      settings = await VICIdialSetting.findOne({ tenantId });
      if (!settings) {
        return res.status(404).json({ success: false, error: 'VICIdial not configured for this tenant' });
      }
    }

    const result = await didSyncTestConnection(settings);
    if (!result.ok) {
      return res.status(400).json({
        success: false,
        code: result.code,
        message: result.message,
        raw: result.raw,
      });
    }
    res.json({ success: true, version: result.version });
  } catch (err) {
    console.error('❌ test-connection error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/settings/vicidial/sync-dids
// Manually trigger a sync. Body: { dryRun?: boolean }
router.post('/sync-dids', async (req, res) => {
  try {
    const tenantId = req.user?.tenant?._id || req.user?.tenant;
    if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant required' });

    const dryRun = req.body?.dryRun === true;
    const userId = req.user?._id;
    const result = await syncDidsForTenant(tenantId, { dryRun, userId });

    res.json({
      success: true,
      mode: result.mode,
      dryRun: result.dryRun,
      counts: result.counts,
      // Cap the per-DID op log to avoid mega payloads for big tenants.
      sampleOps: result.opsLog.slice(0, 50),
    });
  } catch (err) {
    console.error('❌ sync-dids error:', err.message);
    const status =
      err.code === 'NOT_CONFIGURED' ? 404 :
      err.code === 'AUTH' ? 401 :
      err.code === 'IP_NOT_ALLOWED' ? 403 :
      err.code === 'PERMISSION' ? 403 :
      err.code === 'CONFIG' ? 400 :
      err.code === 'NO_USER' ? 400 :
      500;
    res.status(status).json({ success: false, code: err.code, error: err.message });
  }
});

// POST /api/v1/settings/vicidial/preview-dids
// Dry-run preview — fetches the DID list from VICIdial without touching the DB.
// Useful for the "Sync now" UI to show "we'd add X, deactivate Y" before commit.
router.post('/preview-dids', async (req, res) => {
  try {
    const tenantId = req.user?.tenant?._id || req.user?.tenant;
    if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant required' });

    const settings = await VICIdialSetting.findOne({ tenantId });
    if (!settings) return res.status(404).json({ success: false, error: 'VICIdial not configured' });

    const { mode, dids } = await fetchDidList(settings);
    res.json({
      success: true,
      mode,
      count: dids.length,
      // Sample first 100 so UI can preview without 50k-row payloads.
      sample: dids.slice(0, 100),
    });
  } catch (err) {
    console.error('❌ preview-dids error:', err.message);
    const status =
      err.code === 'NOT_CONFIGURED' ? 404 :
      err.code === 'AUTH' ? 401 :
      err.code === 'IP_NOT_ALLOWED' ? 403 :
      err.code === 'PERMISSION' ? 403 :
      err.code === 'CONFIG' ? 400 :
      500;
    res.status(status).json({ success: false, code: err.code, error: err.message });
  }
});

// GET /api/v1/settings/vicidial/sync-status
// Returns the most recent sync result for this tenant.
router.get('/sync-status', async (req, res) => {
  try {
    const tenantId = req.user?.tenant?._id || req.user?.tenant;
    if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant required' });

    const settings = await VICIdialSetting.findOne({ tenantId }).lean();
    if (!settings) {
      return res.json({
        success: true,
        configured: false,
      });
    }
    res.json({
      success: true,
      configured: true,
      didSyncEnabled: !!settings.didSyncEnabled,
      didSyncIntervalMinutes: settings.didSyncIntervalMinutes || 60,
      didSyncMode: settings.didSyncMode || 'did_log_discovery',
      didSyncLookbackDays: settings.didSyncLookbackDays || 30,
      didSyncApiListFunction: settings.didSyncApiListFunction || '',
      lastDidSyncAt: settings.lastDidSyncAt,
      lastDidSyncStatus: settings.lastDidSyncStatus,
      lastDidSyncMessage: settings.lastDidSyncMessage,
      lastDidSyncCounts: settings.lastDidSyncCounts || { fetched: 0, added: 0, updated: 0, deactivated: 0, unchanged: 0 },
    });
  } catch (err) {
    console.error('❌ sync-status error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
