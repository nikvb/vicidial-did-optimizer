#!/usr/bin/env python3
"""
Fast Bulk Reputation Updater

Updates DID reputation scores in MongoDB using fast HTTP scraping.
Performance: ~60 requests/second with proxy rotation.

Usage:
  python3 bulk_update_reputation.py                    # Update DIDs not checked in 48 hours
  python3 bulk_update_reputation.py --force            # Force update ALL active DIDs
  python3 bulk_update_reputation.py --limit 1000       # Limit to 1000 DIDs
  python3 bulk_update_reputation.py --concurrency 30   # Set concurrency level
"""

import asyncio
import aiohttp
import argparse
import os
import sys
import re
import random
from datetime import datetime, timedelta
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

# Add scripts directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fast_robokiller_scraper import scrape_single, get_random_headers, BROWSER_PROFILES

# Load environment variables
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

# MongoDB connection
MONGODB_URI = os.getenv('MONGODB_URI', 'mongodb://127.0.0.1:27017/did_optimizer')

# Webshare API
WEBSHARE_API_KEY = os.getenv('WEBSHARE_API_KEY', 'qcv48genia4yzeayykuh4qzvqusywmbgko6k2ppv')


class ProxyRotator:
    """Smart proxy rotation with health tracking"""

    def __init__(self):
        self.proxies = []
        self.proxy_stats = {}
        self.current_index = 0

    async def load_proxies(self):
        """Load proxies from Webshare"""
        async with aiohttp.ClientSession() as session:
            async with session.get(
                'https://proxy.webshare.io/api/v2/proxy/list/',
                headers={'Authorization': f'Token {WEBSHARE_API_KEY}'},
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
                                'country': p['country_code']
                            })
                            self.proxy_stats[proxy_url] = {'success': 0, 'blocked': 0}

        print(f"Loaded {len(self.proxies)} proxies")
        return len(self.proxies)

    def get_random_proxy(self):
        """Get a random healthy proxy"""
        healthy = [p for p in self.proxies if self.proxy_stats.get(p['url'], {}).get('blocked', 0) < 3]
        if healthy:
            return random.choice(healthy)
        # Reset if all blocked
        for url in self.proxy_stats:
            self.proxy_stats[url]['blocked'] = 0
        return random.choice(self.proxies) if self.proxies else None

    def mark_success(self, proxy_url):
        if proxy_url in self.proxy_stats:
            self.proxy_stats[proxy_url]['success'] += 1

    def mark_blocked(self, proxy_url):
        if proxy_url in self.proxy_stats:
            self.proxy_stats[proxy_url]['blocked'] += 1

    def get_healthy_count(self):
        return sum(1 for s in self.proxy_stats.values() if s['blocked'] < 3)


def calculate_score(data):
    """Calculate reputation score from scraped data"""
    score = 50  # Base score

    # Reputation status
    status = data.get('reputationStatus', 'Unknown')
    if status == 'Positive':
        score += 30
    elif status == 'Negative':
        score -= 30
    elif status == 'Neutral':
        score += 0

    # RoboKiller status
    rk_status = data.get('robokillerStatus', 'Unknown')
    if rk_status == 'Allowed':
        score += 20
    elif rk_status == 'Blocked':
        score -= 20

    # User reports (negative indicator)
    reports = data.get('userReports', 0) or 0
    if reports > 0:
        score -= min(reports * 5, 25)

    # Total calls (positive indicator if > 5)
    calls = data.get('totalCalls', 0) or 0
    if calls > 5:
        score += min((calls - 5) * 2, 15)

    return max(0, min(100, score))


async def update_single_did(session, db, did, proxy_rotator):
    """Scrape and update a single DID"""
    phone = did.get('phoneNumber', '')
    clean_number = re.sub(r'\D', '', phone)

    if len(clean_number) < 10:
        return {'success': False, 'phone': phone, 'error': 'Invalid phone number'}

    # Get proxy
    proxy = proxy_rotator.get_random_proxy() if proxy_rotator else None
    proxy_url = proxy['url'] if proxy else None

    # Scrape
    result = await scrape_single(session, clean_number, proxy_url)

    if result.get('success') and result.get('data'):
        data = result['data']
        score = calculate_score(data)

        # Update MongoDB
        update_data = {
            'reputation.score': score,
            'reputation.status': data.get('reputationStatus', 'Unknown'),
            'reputation.lastChecked': datetime.utcnow(),
            'reputation.robokillerData': {
                'userReports': data.get('userReports', 0),
                'reputationStatus': data.get('reputationStatus', 'Unknown'),
                'totalCalls': data.get('totalCalls', 0),
                'lastCallDate': data.get('lastCallDate'),
                'robokillerStatus': data.get('robokillerStatus', 'Unknown'),
                'spamScore': data.get('spamScore'),
                'callerName': data.get('callerName'),
                'commentsCount': data.get('commentsCount', 0)
            },
            'updatedAt': datetime.utcnow()
        }

        await db.dids.update_one(
            {'_id': did['_id']},
            {'$set': update_data}
        )

        if proxy_url:
            proxy_rotator.mark_success(proxy_url)

        return {
            'success': True,
            'phone': phone,
            'status': data.get('reputationStatus'),
            'score': score
        }
    else:
        if proxy_url and result.get('is_blocked'):
            proxy_rotator.mark_blocked(proxy_url)

        return {
            'success': False,
            'phone': phone,
            'error': result.get('error', 'Unknown error')
        }


async def bulk_update(force=False, limit=None, concurrency=50):
    """Main bulk update function"""
    print(f"\n{'='*70}")
    print("FAST BULK REPUTATION UPDATER")
    print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*70}\n")

    # Connect to MongoDB
    print("Connecting to MongoDB...")
    client = AsyncIOMotorClient(MONGODB_URI)
    db = client.get_default_database()

    # Load proxies
    print("Loading proxies...")
    proxy_rotator = ProxyRotator()
    await proxy_rotator.load_proxies()

    if not proxy_rotator.proxies:
        print("WARNING: No proxies available, running without proxies")
        proxy_rotator = None

    # Build query
    query = {'isActive': True}
    if not force:
        cutoff = datetime.utcnow() - timedelta(hours=48)
        query['$or'] = [
            {'reputation.lastChecked': {'$exists': False}},
            {'reputation.lastChecked': {'$lt': cutoff}}
        ]

    # Get DIDs to update
    cursor = db.dids.find(query)
    if limit:
        cursor = cursor.limit(limit)

    dids = await cursor.to_list(length=limit or 100000)
    total_dids = len(dids)

    print(f"Found {total_dids} DIDs to update")
    if total_dids == 0:
        print("All DIDs are up to date!")
        client.close()
        return

    # Stats
    successful = 0
    failed = 0
    start_time = datetime.now()

    # Process in batches
    batch_size = concurrency * 2
    connector = aiohttp.TCPConnector(limit=concurrency, limit_per_host=10)
    timeout = aiohttp.ClientTimeout(total=30)

    async with aiohttp.ClientSession(connector=connector, timeout=timeout) as session:
        for i in range(0, total_dids, batch_size):
            batch = dids[i:i + batch_size]

            # Process batch
            tasks = [update_single_did(session, db, did, proxy_rotator) for did in batch]
            results = await asyncio.gather(*tasks, return_exceptions=True)

            # Count results
            batch_success = 0
            batch_fail = 0
            for r in results:
                if isinstance(r, Exception):
                    batch_fail += 1
                    failed += 1
                elif r.get('success'):
                    batch_success += 1
                    successful += 1
                else:
                    batch_fail += 1
                    failed += 1

            # Progress
            done = i + len(batch)
            elapsed = (datetime.now() - start_time).total_seconds()
            rate = done / elapsed if elapsed > 0 else 0
            proxy_health = f" | Proxies: {proxy_rotator.get_healthy_count()}/{len(proxy_rotator.proxies)}" if proxy_rotator else ""

            print(f"[{done:5d}/{total_dids}] OK:{batch_success:3d} FAIL:{batch_fail:3d} | "
                  f"Total: {successful}/{done} | Rate: {rate:.1f}/s{proxy_health}")

    # Final stats
    total_time = (datetime.now() - start_time).total_seconds()

    print(f"\n{'='*70}")
    print("COMPLETED")
    print(f"{'='*70}")
    print(f"Total DIDs:      {total_dids}")
    print(f"Successful:      {successful} ({successful/total_dids*100:.1f}%)")
    print(f"Failed:          {failed} ({failed/total_dids*100:.1f}%)")
    print(f"Total time:      {total_time:.1f}s ({total_time/60:.1f} min)")
    print(f"Average rate:    {total_dids/total_time:.1f} DIDs/sec")
    print(f"{'='*70}\n")

    # Get final reputation stats
    pipeline = [
        {'$match': {'isActive': True}},
        {'$group': {'_id': '$reputation.status', 'count': {'$sum': 1}}},
        {'$sort': {'_id': 1}}
    ]
    stats = await db.dids.aggregate(pipeline).to_list(length=10)

    print("REPUTATION DISTRIBUTION:")
    for stat in stats:
        print(f"  {stat['_id'] or 'Unknown'}: {stat['count']}")

    client.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Fast bulk reputation updater')
    parser.add_argument('--force', '-f', action='store_true',
                        help='Force update all DIDs regardless of last check time')
    parser.add_argument('--limit', '-l', type=int, default=None,
                        help='Limit number of DIDs to update')
    parser.add_argument('--concurrency', '-c', type=int, default=50,
                        help='Number of concurrent requests (default: 50)')
    args = parser.parse_args()

    asyncio.run(bulk_update(args.force, args.limit, args.concurrency))
