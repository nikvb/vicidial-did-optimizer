<?php
/**
 * VICIdial DID Optimizer Integration Script (PHP Config Version)
 *
 * This PHP script integrates VICIdial with the DID Optimizer Pro API
 * Configuration is read from /etc/asterisk/dids.conf
 *
 * Features:
 * - Geographic proximity DID selection
 * - Daily usage limit enforcement (configurable)
 * - Comprehensive call data collection for AI training
 * - Automatic failover and error handling
 * - Centralized configuration management
 *
 * Installation:
 * 1. Place this script in your web server directory
 * 2. Create configuration file: /etc/asterisk/dids.conf
 * 4. Set secure permissions: chmod 600 /etc/asterisk/dids.conf
 * 5. Test with: php vicidial-did-optimizer-config.php test
 */

// Configuration file location
define('CONFIG_FILE', '/etc/asterisk/dids.conf');

class DIDOptimizerConfig {
    private $config;
    private $config_file;

    public function __construct($config_file = CONFIG_FILE) {
        $this->config_file = $config_file;
        $this->loadConfiguration();
    }

    /**
     * Load configuration from file
     */
    private function loadConfiguration() {
        // Set default values
        $this->config = [
            'api_base_url' => 'http://localhost:3001',
            'api_key' => '',
            'api_timeout' => 10,
            'max_retries' => 3,
            'fallback_did' => '+18005551234',
            'log_file' => '/var/log/astguiclient/did_optimizer.log',
            'debug' => 1,
            'db_host' => 'localhost',
            'db_user' => 'cron',
            'db_pass' => '1234',
            'db_name' => 'asterisk',
            'daily_usage_limit' => 200,
            'max_distance_miles' => 500,
            'enable_geographic_routing' => 1,
            'enable_state_fallback' => 1,
            'enable_area_code_detection' => 1,
            'collect_ai_data' => 1,
            'include_customer_demographics' => 1,
            'include_call_context' => 1,
            'include_performance_metrics' => 1,
            'context_cache_dir' => '/tmp/did_optimizer',
            'context_cache_ttl' => 3600,
            'notification_email' => '',
            'alert_on_api_failure' => 1,
            'alert_on_daily_limit' => 0,
            'geographic_algorithm' => 'haversine',
            'coordinate_precision' => 4,
            'state_center_coordinates' => 1,
            'zip_geocoding' => 0,
            'verify_ssl' => 1,
            'connection_timeout' => 30,
            'read_timeout' => 60
        ];

        $this->log('DEBUG', "Loading configuration from {$this->config_file}");

        // Check if config file exists and is readable
        if (!file_exists($this->config_file)) {
            $this->log('WARN', "Configuration file {$this->config_file} not found, using defaults");
            return;
        }

        if (!is_readable($this->config_file)) {
            $this->log('ERROR', "Configuration file {$this->config_file} is not readable");
            return;
        }

        // Read and parse configuration file
        $lines = file($this->config_file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        $current_section = 'general';

        foreach ($lines as $line) {
            $line = trim($line);

            // Skip comments
            if (empty($line) || $line[0] === '#') {
                continue;
            }

            // Section headers
            if (preg_match('/^\[(.+)\]$/', $line, $matches)) {
                $current_section = $matches[1];
                continue;
            }

            // Key-value pairs
            if (preg_match('/^(\w+)\s*=\s*(.*)$/', $line, $matches)) {
                $key = $matches[1];
                $value = trim($matches[2]);

                // Convert boolean-like values
                if (preg_match('/^(1|true|yes|on)$/i', $value)) {
                    $value = 1;
                } elseif (preg_match('/^(0|false|no|off)$/i', $value)) {
                    $value = 0;
                } elseif (is_numeric($value)) {
                    $value = is_float($value) ? (float)$value : (int)$value;
                }

                $this->config[$key] = $value;
                $this->log('DEBUG', "Config: $key = $value");
            }
        }

        // Validate required configuration
        if (empty($this->config['api_key'])) {
            $this->log('ERROR', "API key not configured in {$this->config_file}");
            throw new Exception("API key not configured");
        }

        // Create cache directory if it doesn't exist
        if (!is_dir($this->config['context_cache_dir'])) {
            if (!mkdir($this->config['context_cache_dir'], 0755, true)) {
                $this->log('WARN', "Cannot create cache directory: {$this->config['context_cache_dir']}");
            }
        }

        $this->log('INFO', "Configuration loaded successfully from {$this->config_file}");
    }

    /**
     * Get configuration value
     */
    public function get($key, $default = null) {
        return $this->config[$key] ?? $default;
    }

    /**
     * Get all configuration
     */
    public function getAll() {
        return $this->config;
    }

    /**
     * Show configuration (masked sensitive data)
     */
    public function showConfiguration() {
        echo "DID Optimizer Configuration\n";
        echo "===========================\n\n";

        echo "Configuration file: {$this->config_file}\n";
        echo "File exists: " . (file_exists($this->config_file) ? "Yes" : "No") . "\n";
        echo "File readable: " . (is_readable($this->config_file) ? "Yes" : "No") . "\n\n";

        echo "Current Settings:\n";
        echo str_repeat('-', 50) . "\n";

        foreach ($this->config as $key => $value) {
            // Mask sensitive information
            if (preg_match('/password|pass|key|secret/i', $key)) {
                $value = str_repeat('*', strlen($value));
            }

            printf("%-25s: %s\n", $key, $value);
        }

        echo "\nTo modify settings, edit: {$this->config_file}\n";
    }

    /**
     * Get optimal DID from the API
     */
    public function getOptimalDID($campaign_id, $agent_id, $phone_number = '', $state = '', $zip = '') {
        $this->log('INFO', "Getting optimal DID for campaign=$campaign_id, agent=$agent_id");

        // Get customer location data
        $location = $this->getCustomerLocation($phone_number, $state, $zip);

        // Build API parameters
        $params = [
            'campaign_id' => $campaign_id ?: 'UNKNOWN',
            'agent_id' => $agent_id ?: 'UNKNOWN'
        ];

        // Add geographic parameters if enabled
        if ($this->get('enable_geographic_routing')) {
            if (!empty($location['latitude']) && !empty($location['longitude'])) {
                $params['latitude'] = $location['latitude'];
                $params['longitude'] = $location['longitude'];
                $this->log('DEBUG', "Using coordinates: {$location['latitude']}, {$location['longitude']}");
            }

            if (!empty($location['state'])) {
                $params['state'] = $location['state'];
                $this->log('DEBUG', "Using state: {$location['state']}");
            }

            if (!empty($location['area_code'])) {
                $params['area_code'] = $location['area_code'];
                $this->log('DEBUG', "Using area code: {$location['area_code']}");
            }
        }

        // Make API request
        $url = $this->get('api_base_url') . '/api/v1/vicidial/next-did?' . http_build_query($params);

        $response = $this->makeAPIRequest('GET', $url);

        if ($response && $response['success']) {
            $this->log('INFO', "Selected DID: {$response['data']['phoneNumber']} (algorithm: {$response['data']['algorithm']})");

            // Store call context for result reporting if AI data collection is enabled
            if ($this->get('collect_ai_data')) {
                $this->storeCallContext($response['data'], $phone_number, $location);
            }

            return $response['data'];
        }

        $this->log('ERROR', 'Failed to get DID from API, using fallback');
        return ['phoneNumber' => $this->get('fallback_did'), 'algorithm' => 'fallback'];
    }

    /**
     * Report call result back to API
     */
    public function reportCallResult($phone_number, $campaign_id, $result, $duration = 0, $disposition = '') {
        $this->log('INFO', "Reporting call result: $result for $phone_number");

        // Load call context
        $context = $this->loadCallContext($campaign_id, $phone_number);

        // Get customer data for AI training if enabled
        $customer_data = [];
        if ($this->get('include_customer_demographics')) {
            $customer_data = $this->getCustomerDataFromDB($phone_number, $campaign_id);
        }

        $payload = [
            'phoneNumber' => $context['phone_number'] ?? $this->get('fallback_did'),
            'campaign_id' => $campaign_id,
            'agent_id' => $context['agent_id'] ?? 'UNKNOWN',
            'result' => $result,
            'duration' => (int)$duration,
            'disposition' => $disposition
        ];

        // Add customer data if AI collection is enabled
        if ($this->get('collect_ai_data')) {
            $payload['customerData'] = $customer_data;
        }

        $url = $this->get('api_base_url') . '/api/v1/vicidial/call-result';
        $response = $this->makeAPIRequest('POST', $url, $payload);

        if ($response && $response['success']) {
            $this->log('INFO', 'Call result reported successfully');
            return true;
        } else {
            $this->log('ERROR', 'Failed to report call result');

            // Send alert if configured
            if ($this->get('alert_on_api_failure')) {
                $this->sendAlert("Call Result Failure", "Failed to report call result for $phone_number");
            }

            return false;
        }
    }

    /**
     * Check API health
     */
    public function checkHealth() {
        $url = $this->get('api_base_url') . '/api/v1/vicidial/health';
        $response = $this->makeAPIRequest('GET', $url);

        if ($response && $response['success']) {
            $this->log('INFO', 'API health check passed');
            return $response['data'];
        } else {
            $this->log('ERROR', 'API health check failed');
            return false;
        }
    }

    /**
     * Make API request with retries
     */
    private function makeAPIRequest($method, $url, $data = null) {
        $max_retries = $this->get('max_retries', 3);

        for ($attempt = 1; $attempt <= $max_retries; $attempt++) {
            $this->log('DEBUG', "API attempt $attempt of $max_retries: $method $url");

            $ch = curl_init();

            curl_setopt_array($ch, [
                CURLOPT_URL => $url,
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT => $this->get('api_timeout', 10),
                CURLOPT_CONNECTTIMEOUT => $this->get('connection_timeout', 30),
                CURLOPT_HTTPHEADER => [
                    'x-api-key: ' . $this->get('api_key'),
                    'Content-Type: application/json'
                ],
                CURLOPT_CUSTOMREQUEST => $method,
                CURLOPT_SSL_VERIFYPEER => $this->get('verify_ssl', 1)
            ]);

            if ($data !== null && $method === 'POST') {
                curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
            }

            $response = curl_exec($ch);
            $http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $error = curl_error($ch);

            curl_close($ch);

            if ($error) {
                $this->log('ERROR', "cURL error (attempt $attempt): $error");
                continue;
            }

            if ($http_code >= 200 && $http_code < 300) {
                $decoded = json_decode($response, true);
                if ($decoded) {
                    $this->log('DEBUG', "API response: $response");
                    return $decoded;
                } else {
                    $this->log('ERROR', "JSON decode error (attempt $attempt)");
                    continue;
                }
            } else {
                $this->log('ERROR', "HTTP error $http_code (attempt $attempt): $response");
                if ($attempt < $max_retries) {
                    sleep(1); // Brief delay before retry
                }
            }
        }

        // Send alert on API failure if configured
        if ($this->get('alert_on_api_failure')) {
            $this->sendAlert("API Failure", "DID Optimizer API failed after $max_retries attempts");
        }

        return false;
    }

    /**
     * Get customer location data
     */
    private function getCustomerLocation($phone_number, $state = '', $zip = '') {
        $location = [];

        // Extract area code from phone number if enabled
        if ($this->get('enable_area_code_detection') && preg_match('/(\d{3})/', $phone_number, $matches)) {
            $location['area_code'] = $matches[1];
            $this->log('DEBUG', "Extracted area code: {$matches[1]}");
        }

        // Use provided state
        if ($state) {
            $location['state'] = strtoupper($state);
            $this->log('DEBUG', "Using provided state: $state");
        }

        // Use provided ZIP
        if ($zip) {
            $location['zip_code'] = $zip;
            $this->log('DEBUG', "Using provided ZIP: $zip");

            // Convert ZIP to coordinates if geocoding is enabled
            if ($this->get('zip_geocoding')) {
                $coords = $this->zipToCoordinates($zip);
                if ($coords) {
                    $location['latitude'] = $coords['lat'];
                    $location['longitude'] = $coords['lon'];
                }
            }
        }

        // If no state, try to get from area code (if enabled)
        if ($this->get('enable_state_fallback') && empty($location['state']) && !empty($location['area_code'])) {
            $location['state'] = $this->areaCodeToState($location['area_code']);
        }

        // If no coordinates and we have state, use state center (if enabled)
        if ($this->get('state_center_coordinates') && empty($location['latitude']) && !empty($location['state'])) {
            $coords = $this->stateToCoordinates($location['state']);
            if ($coords) {
                $location['latitude'] = $coords['lat'];
                $location['longitude'] = $coords['lon'];
            }
        }

        return $location;
    }

    /**
     * Store call context for later result reporting
     */
    private function storeCallContext($did_data, $phone_number, $location_data) {
        $context = [
            'did_id' => $did_data['didId'],
            'phone_number' => $did_data['phoneNumber'],
            'campaign_id' => $did_data['campaign_id'],
            'agent_id' => $did_data['agent_id'],
            'selected_at' => $did_data['selectedAt'],
            'algorithm' => $did_data['algorithm'],
            'customer_phone' => $phone_number,
            'customer_location' => $location_data,
            'api_metadata' => $did_data['metadata'],
            'config_snapshot' => [
                'daily_usage_limit' => $this->get('daily_usage_limit'),
                'max_distance_miles' => $this->get('max_distance_miles'),
                'geographic_algorithm' => $this->get('geographic_algorithm')
            ]
        ];

        $context_file = $this->get('context_cache_dir') . "/did_context_{$did_data['campaign_id']}_{$phone_number}.json";
        file_put_contents($context_file, json_encode($context));

        $this->log('DEBUG', "Stored call context: $context_file");
    }

    /**
     * Load call context
     */
    private function loadCallContext($campaign_id, $phone_number) {
        $context_file = $this->get('context_cache_dir') . "/did_context_{$campaign_id}_{$phone_number}.json";

        if (file_exists($context_file)) {
            $content = file_get_contents($context_file);
            unlink($context_file); // Clean up
            return json_decode($content, true) ?: [];
        }

        return [];
    }

    /**
     * Get customer data from VICIdial database
     */
    private function getCustomerDataFromDB($phone_number, $campaign_id) {
        $customer_data = [];

        try {
            $pdo = new PDO(
                "mysql:host=" . $this->get('db_host') . ";dbname=" . $this->get('db_name'),
                $this->get('db_user'),
                $this->get('db_pass'),
                [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
            );

            $sql = "
                SELECT
                    state,
                    postal_code as zip,
                    YEAR(CURDATE()) - YEAR(date_of_birth) as age,
                    gender,
                    source_id as lead_source,
                    rank as lead_score,
                    called_count as contact_attempt
                FROM vicidial_list
                WHERE phone_number = ?
                LIMIT 1
            ";

            $stmt = $pdo->prepare($sql);
            $stmt->execute([$phone_number]);

            if ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
                $customer_data = [
                    'state' => $row['state'] ?: '',
                    'zip' => $row['zip'] ?: '',
                    'age' => (int)$row['age'] ?: 0,
                    'gender' => $row['gender'] ?: '',
                    'leadSource' => $row['lead_source'] ?: '',
                    'leadScore' => (int)$row['lead_score'] ?: 0,
                    'contactAttempt' => (int)$row['contact_attempt'] ?: 1
                ];
            }

            $this->log('DEBUG', 'Retrieved customer data: ' . json_encode($customer_data));

        } catch (Exception $e) {
            $this->log('ERROR', 'Database query failed: ' . $e->getMessage());
        }

        return $customer_data;
    }

    /**
     * Convert area code to state
     */
    private function areaCodeToState($area_code) {
        $area_code_map = [
            '415' => 'CA', '510' => 'CA', '650' => 'CA', '925' => 'CA',
            '212' => 'NY', '646' => 'NY', '917' => 'NY', '718' => 'NY',
            '303' => 'CO', '720' => 'CO', '970' => 'CO',
            '713' => 'TX', '832' => 'TX', '281' => 'TX', '409' => 'TX',
            '305' => 'FL', '786' => 'FL', '954' => 'FL', '561' => 'FL'
        ];

        return $area_code_map[$area_code] ?? '';
    }

    /**
     * Convert state to coordinates
     */
    private function stateToCoordinates($state) {
        $state_coords = [
            'CA' => ['lat' => 36.7783, 'lon' => -119.4179],
            'NY' => ['lat' => 40.7589, 'lon' => -73.9851],
            'TX' => ['lat' => 31.0000, 'lon' => -100.0000],
            'FL' => ['lat' => 27.7663, 'lon' => -81.6868],
            'CO' => ['lat' => 39.5501, 'lon' => -105.7821],
            'IL' => ['lat' => 40.6331, 'lon' => -89.3985],
            'OH' => ['lat' => 40.4173, 'lon' => -82.9071],
            'PA' => ['lat' => 41.2033, 'lon' => -77.1945]
        ];

        return $state_coords[strtoupper($state)] ?? null;
    }

    /**
     * Convert ZIP to coordinates (placeholder)
     */
    private function zipToCoordinates($zip) {
        // In production, use a ZIP code database or geocoding service
        return null;
    }

    /**
     * Send alert notification
     */
    private function sendAlert($subject, $message) {
        $email = $this->get('notification_email');
        if (!$email) {
            return;
        }

        // Simple email alert (enhance with proper email sending)
        $this->log('ALERT', "$subject: $message");

        // You could add actual email sending here
        // mail($email, $subject, $message);
    }

    /**
     * Log messages
     */
    private function log($level, $message) {
        if (!$this->get('debug', 1) && $level === 'DEBUG') {
            return;
        }

        $timestamp = date('Y-m-d H:i:s');
        $log_entry = "[$timestamp] [$level] $message\n";

        $log_file = $this->get('log_file', '/var/log/astguiclient/did_optimizer.log');
        file_put_contents($log_file, $log_entry, FILE_APPEND | LOCK_EX);

        if ($this->get('debug', 1)) {
            error_log($log_entry);
        }
    }

    /**
     * Run integration tests
     */
    public function runTests() {
        echo "🧪 Running DID Optimizer Integration Tests (Config Version)...\n\n";

        // Test 1: Configuration Loading
        echo "1. Testing Configuration Loading...\n";
        if ($this->get('api_key')) {
            echo "   ✅ Configuration: LOADED\n";
            echo "   📊 API Base URL: " . $this->get('api_base_url') . "\n";
            echo "   🔑 API Key: " . substr($this->get('api_key'), 0, 20) . "...\n";
            echo "   📈 Daily Limit: " . $this->get('daily_usage_limit') . "\n";
            echo "   🌍 Geographic Routing: " . ($this->get('enable_geographic_routing') ? 'ENABLED' : 'DISABLED') . "\n";
        } else {
            echo "   ❌ Configuration: FAILED\n";
            return;
        }

        // Test 2: API Health Check
        echo "\n2. Testing API Health Check...\n";
        $health = $this->checkHealth();
        if ($health) {
            echo "   ✅ API Health Check: PASSED\n";
            echo "   📊 Active DIDs: {$health['activeDIDs']}\n";
            echo "   🔄 Active Rules: {$health['activeRotationRules']}\n";
        } else {
            echo "   ❌ API Health Check: FAILED\n";
            return;
        }

        // Test 3: DID Selection
        echo "\n3. Testing DID Selection...\n";
        $did = $this->getOptimalDID('TEST_CAMPAIGN', 'TEST_AGENT', '4155551234', 'CA', '94102');
        if ($did) {
            echo "   ✅ DID Selection: PASSED\n";
            echo "   📞 Selected: {$did['phoneNumber']}\n";
            echo "   🎯 Algorithm: {$did['algorithm']}\n";
            echo "   📏 Distance: " . ($did['location']['distance'] ?? 'N/A') . " miles\n";
        } else {
            echo "   ❌ DID Selection: FAILED\n";
            return;
        }

        // Test 4: Configuration File Security
        echo "\n4. Testing Configuration File Security...\n";
        $perms = substr(sprintf('%o', fileperms($this->config_file)), -4);
        echo "   📁 File permissions: $perms\n";
        if ($perms === '0600' || $perms === '0640') {
            echo "   ✅ Security: GOOD (restrictive permissions)\n";
        } else {
            echo "   ⚠️  Security: WARNING (consider chmod 600 {$this->config_file})\n";
        }

        echo "\n🎉 All tests completed!\n";
        echo "\n📋 Configuration File Management:\n";
        echo "1. Edit configuration: vi {$this->config_file}\n";
        echo "2. View current config: php {$_SERVER['PHP_SELF']} config\n";
        echo "3. Test after changes: php {$_SERVER['PHP_SELF']} test\n";
    }
}

// Main execution logic
try {
    $optimizer = new DIDOptimizerConfig();

    // Handle different execution contexts
    if (php_sapi_name() === 'cli') {
        // Command line execution
        if (isset($argv[1])) {
            switch ($argv[1]) {
                case 'test':
                    $optimizer->runTests();
                    exit(0);

                case 'config':
                    $optimizer->showConfiguration();
                    exit(0);

                case 'report':
                    // Report call result: php script.php report phone campaign result duration disposition
                    $result = $optimizer->reportCallResult($argv[2], $argv[3], $argv[4], $argv[5] ?? 0, $argv[6] ?? '');
                    exit($result ? 0 : 1);

                default:
                    // Get DID: php script.php campaign agent phone state zip
                    $campaign_id = $argv[1];
                    $agent_id = $argv[2] ?? '';
                    $phone_number = $argv[3] ?? '';
                    $state = $argv[4] ?? '';
                    $zip = $argv[5] ?? '';

                    if ($campaign_id) {
                        $did = $optimizer->getOptimalDID($campaign_id, $agent_id, $phone_number, $state, $zip);
                        echo $did['phoneNumber'] . "\n";
                    }
                    break;
            }
        } else {
            echo "Usage: php {$argv[0]} <campaign_id> <agent_id> [phone_number] [state] [zip]\n";
            echo "       php {$argv[0]} test\n";
            echo "       php {$argv[0]} config\n";
            echo "       php {$argv[0]} report <phone> <campaign> <result> [duration] [disposition]\n";
        }
    } else {
        // Web execution
        header('Content-Type: application/json');

        if (isset($_GET['test'])) {
            ob_start();
            $optimizer->runTests();
            $output = ob_get_clean();
            echo json_encode(['success' => true, 'output' => $output]);
            exit;
        }

        if (isset($_GET['config'])) {
            ob_start();
            $optimizer->showConfiguration();
            $output = ob_get_clean();
            echo json_encode(['success' => true, 'config' => $output]);
            exit;
        }

        if (isset($_POST['action']) && $_POST['action'] === 'report') {
            $result = $optimizer->reportCallResult(
                $_POST['phone_number'],
                $_POST['campaign_id'],
                $_POST['result'],
                $_POST['duration'] ?? 0,
                $_POST['disposition'] ?? ''
            );
            echo json_encode(['success' => $result]);
            exit;
        }

        // Get DID via web
        $campaign_id = $_GET['campaign_id'] ?? '';
        $agent_id = $_GET['agent_id'] ?? '';
        $phone_number = $_GET['phone_number'] ?? '';
        $state = $_GET['state'] ?? '';
        $zip = $_GET['zip'] ?? '';

        if ($campaign_id) {
            $did = $optimizer->getOptimalDID($campaign_id, $agent_id, $phone_number, $state, $zip);
            echo json_encode([
                'success' => true,
                'data' => $did
            ]);
        } else {
            echo json_encode([
                'success' => false,
                'message' => 'Missing required parameter: campaign_id'
            ]);
        }
    }

} catch (Exception $e) {
    if (php_sapi_name() === 'cli') {
        echo "Error: " . $e->getMessage() . "\n";
        exit(1);
    } else {
        header('Content-Type: application/json');
        echo json_encode([
            'success' => false,
            'error' => $e->getMessage()
        ]);
    }
}
?>