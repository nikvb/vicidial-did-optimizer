#!/usr/bin/env python3
"""
Free Proxy Loader

Fetches free proxies from multiple sources when paid proxies are exhausted.
Note: Free proxies are unreliable - expect ~10-20% success rate.

Sources:
- ProxyScrape API
- Free-Proxy-List.net
- GeoNode Free Proxy API
"""

import asyncio
import aiohttp
import re
from typing import List, Dict, Optional


async def fetch_proxyscrape(protocol: str = "http", country: str = "US") -> List[Dict]:
    """Fetch from ProxyScrape API"""
    proxies = []
    url = f"https://api.proxyscrape.com/v2/?request=getproxies&protocol={protocol}&timeout=5000&country={country}&anonymity=elite"

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=10) as resp:
                text = await resp.text()
                for line in text.strip().split('\n'):
                    if ':' in line:
                        parts = line.strip().split(':')
                        if len(parts) == 2:
                            proxies.append({
                                'host': parts[0],
                                'port': int(parts[1]),
                                'username': None,
                                'password': None,
                                'country': country,
                                'source': 'proxyscrape'
                            })
    except Exception as e:
        print(f"ProxyScrape error: {e}")

    return proxies


async def fetch_geonode() -> List[Dict]:
    """Fetch from GeoNode free proxy API"""
    proxies = []
    url = "https://proxylist.geonode.com/api/proxy-list?limit=50&page=1&sort_by=lastChecked&sort_type=desc&protocols=http%2Chttps"

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=10) as resp:
                data = await resp.json()
                for p in data.get('data', []):
                    proxies.append({
                        'host': p['ip'],
                        'port': int(p['port']),
                        'username': None,
                        'password': None,
                        'country': p.get('country', 'US'),
                        'source': 'geonode'
                    })
    except Exception as e:
        print(f"GeoNode error: {e}")

    return proxies


async def fetch_free_proxy_list() -> List[Dict]:
    """Fetch from free-proxy-list.net (scrape HTML)"""
    proxies = []
    url = "https://free-proxy-list.net/"

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=10) as resp:
                html = await resp.text()
                # Find IP:PORT patterns
                pattern = r'(\d+\.\d+\.\d+\.\d+)</td><td>(\d+)'
                matches = re.findall(pattern, html)
                for ip, port in matches[:30]:
                    proxies.append({
                        'host': ip,
                        'port': int(port),
                        'username': None,
                        'password': None,
                        'country': 'unknown',
                        'source': 'free-proxy-list'
                    })
    except Exception as e:
        print(f"Free-proxy-list error: {e}")

    return proxies


async def load_all_free_proxies() -> List[Dict]:
    """Load proxies from all sources"""
    print("Loading free proxies from multiple sources...")

    results = await asyncio.gather(
        fetch_proxyscrape("http", "US"),
        fetch_proxyscrape("http", ""),  # Any country
        fetch_geonode(),
        fetch_free_proxy_list(),
        return_exceptions=True
    )

    all_proxies = []
    for result in results:
        if isinstance(result, list):
            all_proxies.extend(result)

    # Deduplicate by host:port
    seen = set()
    unique_proxies = []
    for p in all_proxies:
        key = f"{p['host']}:{p['port']}"
        if key not in seen:
            seen.add(key)
            unique_proxies.append(p)

    print(f"Loaded {len(unique_proxies)} unique free proxies")
    return unique_proxies


async def test_proxy(proxy: Dict, test_url: str = "https://httpbin.org/ip") -> bool:
    """Test if a proxy works"""
    proxy_url = f"http://{proxy['host']}:{proxy['port']}"

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                test_url,
                proxy=proxy_url,
                timeout=aiohttp.ClientTimeout(total=10)
            ) as resp:
                return resp.status == 200
    except:
        return False


async def get_working_proxies(count: int = 10) -> List[Dict]:
    """Load and test proxies, return working ones"""
    all_proxies = await load_all_free_proxies()

    print(f"Testing proxies (need {count} working)...")
    working = []

    # Test in batches
    batch_size = 20
    for i in range(0, len(all_proxies), batch_size):
        if len(working) >= count:
            break

        batch = all_proxies[i:i+batch_size]
        tasks = [test_proxy(p) for p in batch]
        results = await asyncio.gather(*tasks)

        for proxy, works in zip(batch, results):
            if works:
                working.append(proxy)
                print(f"  ✓ {proxy['host']}:{proxy['port']}")
                if len(working) >= count:
                    break

    print(f"Found {len(working)} working proxies")
    return working


if __name__ == "__main__":
    async def main():
        proxies = await get_working_proxies(5)
        print("\nWorking proxies:")
        for p in proxies:
            print(f"  {p['host']}:{p['port']} ({p['source']})")

    asyncio.run(main())
