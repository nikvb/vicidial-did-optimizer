#!/usr/bin/env python3
"""
Test script to determine how many phone numbers can be scraped
before getting rate-limited or blocked by RoboKiller.
"""

import asyncio
import sys
import time
import random
from datetime import datetime

# Add the scripts directory to path
sys.path.insert(0, '/home/na/didapi/scripts')

from enhanced_openrouter_scraper import scrape_with_single_browser, extract_with_enhanced_logic

# Generate random US phone numbers for testing
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

async def test_single_scrape(phone_number, attempt_num, proxy_url=None):
    """Test a single scrape and return result"""
    url = f"https://lookup.robokiller.com/search?q={phone_number}"
    start_time = time.time()

    result = await scrape_with_single_browser(url, phone_number, proxy_url=proxy_url)

    duration = time.time() - start_time

    # Check for blocking indicators
    is_blocked = False
    block_reason = None

    if not result["success"]:
        is_blocked = True
        block_reason = result.get("error", "Unknown error")
    elif result["html"]:
        html_lower = result["html"].lower()
        # Check for common blocking indicators
        if "captcha" in html_lower or "recaptcha" in html_lower:
            is_blocked = True
            block_reason = "CAPTCHA detected"
        elif "rate limit" in html_lower or "too many requests" in html_lower:
            is_blocked = True
            block_reason = "Rate limit detected"
        elif "access denied" in html_lower or "forbidden" in html_lower:
            is_blocked = True
            block_reason = "Access denied"
        elif "please verify" in html_lower and "human" in html_lower:
            is_blocked = True
            block_reason = "Human verification required"
        elif len(result["html"]) < 1000:
            # Suspiciously short response
            is_blocked = True
            block_reason = f"Suspicious short response ({len(result['html'])} bytes)"

    return {
        "attempt": attempt_num,
        "phone": phone_number,
        "success": result["success"],
        "is_blocked": is_blocked,
        "block_reason": block_reason,
        "duration": duration,
        "html_size": len(result["html"]) if result["html"] else 0,
        "screenshot": result.get("screenshot")
    }

async def get_webshare_proxy():
    """Get a proxy from Webshare API"""
    import aiohttp
    api_key = 'qcv48genia4yzeayykuh4qzvqusywmbgko6k2ppv'

    async with aiohttp.ClientSession() as session:
        async with session.get(
            'https://proxy.webshare.io/api/v2/proxy/list/',
            headers={'Authorization': f'Token {api_key}'},
            params={'mode': 'direct', 'page_size': 10}
        ) as resp:
            data = await resp.json()
            if data.get('results'):
                p = data['results'][0]
                proxy_url = f"http://{p['username']}:{p['password']}@{p['proxy_address']}:{p['port']}"
                return {
                    'url': proxy_url,
                    'host': p['proxy_address'],
                    'port': p['port'],
                    'country': p['country_code'],
                    'city': p.get('city_name', 'Unknown')
                }
    return None


async def run_limit_test(max_attempts=50, delay_between=2.0, use_proxy=False):
    """Run the limit test"""
    proxy_info = None
    if use_proxy:
        print("Fetching proxy from Webshare...")
        proxy_info = await get_webshare_proxy()
        if proxy_info:
            print(f"Using proxy: {proxy_info['country']}/{proxy_info['city']} - {proxy_info['host']}:{proxy_info['port']}")
        else:
            print("Failed to get proxy, running without proxy")

    print(f"\n{'='*70}")
    print(f"RoboKiller Scraper Limit Test")
    print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Max attempts: {max_attempts}, Delay between: {delay_between}s")
    print(f"Using proxy: {'Yes - ' + proxy_info['country'] if proxy_info else 'No'}")
    print(f"{'='*70}\n")

    phone_numbers = generate_test_numbers(max_attempts)

    results = []
    consecutive_failures = 0
    consecutive_blocks = 0

    proxy_url = proxy_info['url'] if proxy_info else None

    for i, phone in enumerate(phone_numbers, 1):
        print(f"[{i:3d}/{max_attempts}] Scraping {phone}...", end=" ", flush=True)

        try:
            result = await test_single_scrape(phone, i, proxy_url=proxy_url)
            results.append(result)

            if result["is_blocked"]:
                consecutive_blocks += 1
                consecutive_failures = 0
                print(f"BLOCKED - {result['block_reason']} ({result['duration']:.1f}s)")
            elif not result["success"]:
                consecutive_failures += 1
                consecutive_blocks = 0
                print(f"FAILED - {result.get('block_reason', 'Unknown')} ({result['duration']:.1f}s)")
            else:
                consecutive_failures = 0
                consecutive_blocks = 0
                print(f"OK - {result['html_size']} bytes ({result['duration']:.1f}s)")

            # Stop if we hit 5 consecutive blocks or failures
            if consecutive_blocks >= 5:
                print(f"\n⚠️  Stopping: 5 consecutive blocks detected!")
                break
            if consecutive_failures >= 5:
                print(f"\n⚠️  Stopping: 5 consecutive failures detected!")
                break

        except Exception as e:
            print(f"ERROR - {e}")
            consecutive_failures += 1
            if consecutive_failures >= 5:
                print(f"\n⚠️  Stopping: 5 consecutive errors!")
                break

        # Delay between requests
        if i < max_attempts:
            await asyncio.sleep(delay_between)

    # Print summary
    print(f"\n{'='*70}")
    print("RESULTS SUMMARY")
    print(f"{'='*70}")

    total = len(results)
    successful = sum(1 for r in results if r["success"] and not r["is_blocked"])
    blocked = sum(1 for r in results if r["is_blocked"])
    failed = sum(1 for r in results if not r["success"] and not r["is_blocked"])

    print(f"Total attempts:     {total}")
    print(f"Successful:         {successful} ({successful/total*100:.1f}%)")
    print(f"Blocked:            {blocked} ({blocked/total*100:.1f}%)")
    print(f"Failed:             {failed} ({failed/total*100:.1f}%)")

    if results:
        avg_duration = sum(r["duration"] for r in results) / len(results)
        print(f"Average duration:   {avg_duration:.2f}s")

    # Find when first block occurred
    first_block = next((r for r in results if r["is_blocked"]), None)
    if first_block:
        print(f"\nFirst block at attempt #{first_block['attempt']}: {first_block['block_reason']}")
    else:
        print(f"\nNo blocks detected in {total} attempts!")

    # Block reasons breakdown
    block_reasons = {}
    for r in results:
        if r["is_blocked"]:
            reason = r["block_reason"]
            block_reasons[reason] = block_reasons.get(reason, 0) + 1

    if block_reasons:
        print("\nBlock reasons:")
        for reason, count in sorted(block_reasons.items(), key=lambda x: -x[1]):
            print(f"  {reason}: {count}")

    print(f"\n{'='*70}")
    print(f"Test completed: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*70}\n")

    return results

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Test RoboKiller scraper limits")
    parser.add_argument("-n", "--max-attempts", type=int, default=50,
                        help="Maximum number of attempts (default: 50)")
    parser.add_argument("-d", "--delay", type=float, default=2.0,
                        help="Delay between requests in seconds (default: 2.0)")
    parser.add_argument("-p", "--proxy", action="store_true",
                        help="Use a single Webshare proxy for all requests")
    args = parser.parse_args()

    asyncio.run(run_limit_test(args.max_attempts, args.delay, args.proxy))
