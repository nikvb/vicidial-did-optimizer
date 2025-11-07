import axios from 'axios';

class WebshareProxyService {
  constructor() {
    this.apiKey = process.env.WEBSHARE_API_KEY || 'qcv48genia4yzeayykuh4qzvqusywmbgko6k2ppv';
    this.baseURL = 'https://proxy.webshare.io/api/v2';
    this.proxies = [];
    this.currentProxyIndex = 0;
    this.lastFetchTime = 0;
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes cache
    this.isInitialized = false;
    this.maxRetries = 3;
  }

  async initialize() {
    if (this.isInitialized) return;

    try {
      console.log('🌐 Initializing Webshare proxy service...');
      await this.fetchProxies();
      this.isInitialized = true;
      console.log(`✅ Webshare proxy service initialized with ${this.proxies.length} proxies`);
    } catch (error) {
      console.error('❌ Failed to initialize Webshare proxy service:', error.message);
      this.isInitialized = false;
    }
  }

  async fetchProxies() {
    try {
      const response = await axios.get(`${this.baseURL}/proxy/list/`, {
        headers: {
          'Authorization': `Token ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        params: {
          mode: 'direct',
          page_size: 100 // Get more proxies for better rotation
        },
        timeout: 10000
      });

      if (response.data && response.data.results) {
        this.proxies = response.data.results
          .filter(proxy => proxy.valid && !proxy.last_verification || proxy.last_verification.indexOf('invalid') === -1)
          .map(proxy => ({
            id: proxy.id,
            host: proxy.proxy_address,
            port: proxy.port,
            username: proxy.username,
            password: proxy.password,
            country: proxy.country_code,
            city: proxy.city_name,
            lastUsed: 0,
            usageCount: 0,
            errors: 0
          }));

        this.lastFetchTime = Date.now();
        console.log(`🔄 Fetched ${this.proxies.length} valid proxies from Webshare`);

        // Log proxy countries for debugging
        const countries = [...new Set(this.proxies.map(p => p.country))];
        console.log(`📍 Available proxy countries: ${countries.join(', ')}`);
      } else {
        throw new Error('Invalid response format from Webshare API');
      }
    } catch (error) {
      console.error('❌ Error fetching proxies from Webshare:', error.message);
      if (error.response) {
        console.error('API Response:', error.response.status, error.response.data);
      }
      throw error;
    }
  }

  async getNextProxy() {
    await this.ensureProxiesAvailable();

    if (this.proxies.length === 0) {
      throw new Error('No proxies available from Webshare');
    }

    // Round-robin with preference for less-used proxies
    const sortedProxies = [...this.proxies].sort((a, b) => {
      // Prefer proxies with fewer errors
      if (a.errors !== b.errors) return a.errors - b.errors;
      // Then prefer less recently used
      if (a.lastUsed !== b.lastUsed) return a.lastUsed - b.lastUsed;
      // Finally prefer less frequently used
      return a.usageCount - b.usageCount;
    });

    const proxy = sortedProxies[0];
    proxy.lastUsed = Date.now();
    proxy.usageCount++;

    return {
      host: proxy.host,
      port: proxy.port,
      username: proxy.username,
      password: proxy.password,
      country: proxy.country,
      city: proxy.city,
      proxyUrl: `http://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`,
      id: proxy.id
    };
  }

  async getRandomProxy() {
    await this.ensureProxiesAvailable();

    if (this.proxies.length === 0) {
      throw new Error('No proxies available from Webshare');
    }

    // Filter out proxies with too many errors
    const healthyProxies = this.proxies.filter(p => p.errors < 3);
    const availableProxies = healthyProxies.length > 0 ? healthyProxies : this.proxies;

    const randomIndex = Math.floor(Math.random() * availableProxies.length);
    const proxy = availableProxies[randomIndex];

    proxy.lastUsed = Date.now();
    proxy.usageCount++;

    return {
      host: proxy.host,
      port: proxy.port,
      username: proxy.username,
      password: proxy.password,
      country: proxy.country,
      city: proxy.city,
      proxyUrl: `http://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`,
      id: proxy.id
    };
  }

  async ensureProxiesAvailable() {
    // Refresh proxies if cache is stale or we have no proxies
    if (!this.isInitialized ||
        this.proxies.length === 0 ||
        (Date.now() - this.lastFetchTime) > this.cacheTimeout) {

      console.log('🔄 Refreshing proxy list from Webshare...');
      await this.fetchProxies();
    }
  }

  markProxyError(proxyId) {
    const proxy = this.proxies.find(p => p.id === proxyId);
    if (proxy) {
      proxy.errors++;
      console.log(`⚠️ Proxy ${proxy.host}:${proxy.port} error count: ${proxy.errors}`);
    }
  }

  markProxySuccess(proxyId) {
    const proxy = this.proxies.find(p => p.id === proxyId);
    if (proxy && proxy.errors > 0) {
      proxy.errors = Math.max(0, proxy.errors - 1); // Reduce error count on success
    }
  }

  getProxyStats() {
    return {
      totalProxies: this.proxies.length,
      healthyProxies: this.proxies.filter(p => p.errors < 3).length,
      errorProxies: this.proxies.filter(p => p.errors >= 3).length,
      countries: [...new Set(this.proxies.map(p => p.country))],
      lastFetch: new Date(this.lastFetchTime).toISOString(),
      cacheValid: (Date.now() - this.lastFetchTime) < this.cacheTimeout,
      isInitialized: this.isInitialized
    };
  }

  async testProxy(proxyUrl) {
    try {
      const response = await axios.get('https://httpbin.org/ip', {
        proxy: false,
        httpsAgent: new (await import('https-proxy-agent')).HttpsProxyAgent(proxyUrl),
        timeout: 10000
      });

      return {
        success: true,
        ip: response.data.origin,
        responseTime: response.headers['x-response-time'] || 'unknown'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Get a proxy specifically for a country (if available)
  async getProxyByCountry(countryCode) {
    await this.ensureProxiesAvailable();

    const countryProxies = this.proxies.filter(p =>
      p.country.toLowerCase() === countryCode.toLowerCase() && p.errors < 3
    );

    if (countryProxies.length === 0) {
      console.log(`⚠️ No healthy proxies available for country: ${countryCode}, using random proxy`);
      return await this.getRandomProxy();
    }

    const proxy = countryProxies[Math.floor(Math.random() * countryProxies.length)];
    proxy.lastUsed = Date.now();
    proxy.usageCount++;

    return {
      host: proxy.host,
      port: proxy.port,
      username: proxy.username,
      password: proxy.password,
      country: proxy.country,
      city: proxy.city,
      proxyUrl: `http://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`,
      id: proxy.id
    };
  }
}

// Export singleton instance
export default new WebshareProxyService();