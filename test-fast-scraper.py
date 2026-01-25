#!/usr/bin/env python3
"""
Fast scraper limit test - target 10+ requests per second
"""

import asyncio
import aiohttp
import time
import random
from datetime import datetime

# Import the fast scraper
import sys
sys.path.insert(0, '/home/na/didapi/scripts')
from fast_robokiller_scraper import scrape_single, scrape_batch, is_blocked

def generate_test_numbers(count=100):
    """Generate random US phone numbers"""
    area_codes = ['212', '310', '415', '305', '702', '602', '480', '714', '949', '858',
                  '619', '818', '323', '213', '424', '562', '626', '657', '909', '951']
    numbers = []
    for _ in range(count):
        area = random.choice(area_codes)
        exchange = random.randint(200, 999)
        subscriber = random.randint(1000, 9999)
        numbers.append(f"{area}{exchange}{subscriber}")
    return numbers


class ProxyRotator:
    """Smart proxy rotation with blocking detection"""

    def __init__(self):
        self.proxies = []
        self.blocked_proxies = set()
        self.proxy_stats = {}  # proxy_url -> {success: 0, fail: 0, blocked: 0}
        self.current_index = 0

    async def load_proxies(self):
        """Load all proxies from Webshare"""
        api_key = 'qcv48genia4yzeayykuh4qzvqusywmbgko6k2ppv'
        async with aiohttp.ClientSession() as session:
            async with session.get(
                'https://proxy.webshare.io/api/v2/proxy/list/',
                headers={'Authorization': f'Token {api_key}'},
                params={'mode': 'direct', 'page_size': 100}
            ) as resp:
                data = await resp.json()
                if data.get('results'):
                    for p in data['results']:
                        if p.get('valid', True):
                            proxy_url = f"http://{p['username']}:{p['password']}@{p['proxy_address']}:{p['port']}"
                            self.proxies.append({
                                'url': proxy_url,
                                'host': p['proxy_address'],
                                'port': p['port'],
                                'country': p['country_code'],
                                'city': p.get('city_name', '')
                            })
                            self.proxy_stats[proxy_url] = {'success': 0, 'fail': 0, 'blocked': 0}

        print(f"Loaded {len(self.proxies)} proxies from Webshare")
        countries = list(set(p['country'] for p in self.proxies))
        print(f"Countries: {', '.join(countries)}")
        return len(self.proxies)

    def get_next_proxy(self):
        """Get next available proxy (round-robin, skip blocked)"""
        if not self.proxies:
            return None

        attempts = 0
        while attempts < len(self.proxies):
            proxy = self.proxies[self.current_index]
            self.current_index = (self.current_index + 1) % len(self.proxies)

            # Skip if blocked too many times
            stats = self.proxy_stats.get(proxy['url'], {})
            if stats.get('blocked', 0) >= 3:
                attempts += 1
                continue

            return proxy

        # All proxies blocked, reset and try again
        print("⚠️  All proxies blocked, resetting...")
        for url in self.proxy_stats:
            self.proxy_stats[url]['blocked'] = 0
        return self.proxies[0] if self.proxies else None

    def get_random_proxy(self):
        """Get a random healthy proxy"""
        healthy = [p for p in self.proxies
                   if self.proxy_stats.get(p['url'], {}).get('blocked', 0) < 3]
        if healthy:
            return random.choice(healthy)
        return random.choice(self.proxies) if self.proxies else None

    def mark_success(self, proxy_url):
        """Mark proxy as successful"""
        if proxy_url in self.proxy_stats:
            self.proxy_stats[proxy_url]['success'] += 1

    def mark_blocked(self, proxy_url):
        """Mark proxy as blocked"""
        if proxy_url in self.proxy_stats:
            self.proxy_stats[proxy_url]['blocked'] += 1
            print(f"  ⚠️  Proxy blocked: {proxy_url.split('@')[1]}")

    def mark_failed(self, proxy_url):
        """Mark proxy as failed (not blocked, just error)"""
        if proxy_url in self.proxy_stats:
            self.proxy_stats[proxy_url]['fail'] += 1

    def get_stats(self):
        """Get proxy statistics"""
        total = len(self.proxies)
        healthy = sum(1 for url, s in self.proxy_stats.items() if s['blocked'] < 3)
        return {'total': total, 'healthy': healthy, 'blocked': total - healthy}


async def run_fast_test(total_count=100, concurrency=10, use_proxy=False):
    """Run high-speed scraping test with smart proxy rotation"""
    rotator = None

    if use_proxy:
        rotator = ProxyRotator()
        await rotator.load_proxies()
        if not rotator.proxies:
            print("No proxies available, running without")
            rotator = None

    print(f"\n{'='*70}")
    print(f"FAST RoboKiller Scraper Test (HTTP-only, no browser)")
    print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Total requests: {total_count}, Concurrency: {concurrency}")
    print(f"Proxy rotation: {'Yes (' + str(len(rotator.proxies)) + ' proxies)' if rotator else 'No'}")
    print(f"{'='*70}\n")

    phone_numbers = generate_test_numbers(total_count)

    # Stats tracking
    results = []
    successful = 0
    blocked = 0
    failed = 0
    consecutive_blocks = 0

    start_time = time.time()

    # Process in batches for progress updates
    batch_size = concurrency * 2

    connector = aiohttp.TCPConnector(limit=concurrency, limit_per_host=5)
    timeout = aiohttp.ClientTimeout(total=15)

    async with aiohttp.ClientSession(connector=connector, timeout=timeout) as session:
        for i in range(0, len(phone_numbers), batch_size):
            batch = phone_numbers[i:i + batch_size]
            batch_start = time.time()

            # Assign different proxies to each request in batch
            tasks = []
            proxy_assignments = []  # Track which proxy each task uses
            for phone in batch:
                if rotator:
                    proxy = rotator.get_random_proxy()  # Random for better distribution
                    proxy_url = proxy['url'] if proxy else None
                    proxy_assignments.append(proxy_url)
                else:
                    proxy_url = None
                    proxy_assignments.append(None)
                tasks.append(scrape_single(session, phone, proxy_url))

            batch_results = await asyncio.gather(*tasks, return_exceptions=True)

            batch_time = time.time() - batch_start
            rate = len(batch) / batch_time if batch_time > 0 else 0

            # Process results and update proxy stats
            batch_success = 0
            batch_blocked = 0
            batch_failed = 0

            for j, result in enumerate(batch_results):
                proxy_url = proxy_assignments[j]

                if isinstance(result, Exception):
                    batch_failed += 1
                    failed += 1
                    if rotator and proxy_url:
                        rotator.mark_failed(proxy_url)
                    results.append({"success": False, "error": str(result), "is_blocked": False})
                else:
                    results.append(result)
                    if result.get("is_blocked"):
                        batch_blocked += 1
                        blocked += 1
                        consecutive_blocks += 1
                        if rotator and proxy_url:
                            rotator.mark_blocked(proxy_url)
                    elif result.get("success"):
                        batch_success += 1
                        successful += 1
                        consecutive_blocks = 0
                        if rotator and proxy_url:
                            rotator.mark_success(proxy_url)
                    else:
                        batch_failed += 1
                        failed += 1
                        if rotator and proxy_url:
                            rotator.mark_failed(proxy_url)

            elapsed = time.time() - start_time
            total_done = i + len(batch)
            overall_rate = total_done / elapsed if elapsed > 0 else 0

            # Show proxy health if using proxies
            proxy_status = ""
            if rotator:
                stats = rotator.get_stats()
                proxy_status = f" | Proxies: {stats['healthy']}/{stats['total']}"

            print(f"[{total_done:4d}/{total_count}] "
                  f"OK:{batch_success} BLK:{batch_blocked} FAIL:{batch_failed} | "
                  f"Rate: {overall_rate:.1f}/s{proxy_status}")

            # Stop if all proxies blocked OR 20 consecutive blocks
            if rotator:
                stats = rotator.get_stats()
                if stats['healthy'] == 0:
                    print(f"\n⚠️  Stopping: All proxies blocked!")
                    break
            if consecutive_blocks >= 20:
                print(f"\n⚠️  Stopping: 20 consecutive blocks detected!")
                break

    total_time = time.time() - start_time
    total_processed = len(results)

    print(f"\n{'='*70}")
    print("RESULTS SUMMARY")
    print(f"{'='*70}")
    print(f"Total processed:    {total_processed}")
    print(f"Successful:         {successful} ({successful/total_processed*100:.1f}%)")
    print(f"Blocked:            {blocked} ({blocked/total_processed*100:.1f}%)")
    print(f"Failed:             {failed} ({failed/total_processed*100:.1f}%)")
    print(f"Total time:         {total_time:.2f}s")
    print(f"Average rate:       {total_processed/total_time:.1f} requests/sec")

    # Block reasons
    block_reasons = {}
    for r in results:
        if r.get("is_blocked"):
            reason = r.get("error", "Unknown")
            block_reasons[reason] = block_reasons.get(reason, 0) + 1

    if block_reasons:
        print(f"\nBlock reasons:")
        for reason, count in sorted(block_reasons.items(), key=lambda x: -x[1]):
            print(f"  {reason}: {count}")

    # Find first block
    first_block = next((i for i, r in enumerate(results) if r.get("is_blocked")), None)
    if first_block is not None:
        print(f"\nFirst block at request #{first_block + 1}")
    else:
        print(f"\nNo blocks detected!")

    print(f"{'='*70}\n")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Fast RoboKiller scraper test")
    parser.add_argument("-n", "--count", type=int, default=100,
                        help="Number of requests (default: 100)")
    parser.add_argument("-c", "--concurrency", type=int, default=10,
                        help="Concurrent requests (default: 10)")
    parser.add_argument("-p", "--proxy", action="store_true",
                        help="Use Webshare proxy")
    args = parser.parse_args()

    asyncio.run(run_fast_test(args.count, args.concurrency, args.proxy))
