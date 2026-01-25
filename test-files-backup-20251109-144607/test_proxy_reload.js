import webshareProxyService from './services/webshare-proxy-service.js';

async function testProxyReload() {
  console.log('🔄 Testing Webshare proxy reload...\n');

  // Force re-fetch proxies
  webshareProxyService.isInitialized = false;
  webshareProxyService.proxies = [];

  await webshareProxyService.initialize();

  const stats = webshareProxyService.getProxyStats();
  console.log('\n📊 Proxy Statistics:');
  console.log(`  Total Proxies: ${stats.totalProxies}`);
  console.log(`  Healthy Proxies: ${stats.healthyProxies}`);
  console.log(`  Countries: ${stats.countries.join(', ')}`);

  if (stats.totalProxies > 0) {
    console.log('\n✅ Proxy reload successful!');

    // Get a random proxy to test
    const testProxy = await webshareProxyService.getRandomProxy();
    console.log('\n🧪 Sample proxy:');
    console.log(`  ${testProxy.country}/${testProxy.city} - ${testProxy.host}:${testProxy.port}`);
  } else {
    console.log('\n❌ No proxies loaded!');
  }
}

testProxyReload().catch(console.error);
