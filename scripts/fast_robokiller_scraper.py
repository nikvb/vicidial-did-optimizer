#!/usr/bin/env python3
"""
Fast RoboKiller scraper using aiohttp (no browser, no screenshots)
Target: 10+ requests per second
"""

import asyncio
import aiohttp
import json
import sys
import re
import os
import random

# Browser fingerprint profiles - realistic combinations
BROWSER_PROFILES = [
    # Chrome on Windows
    {
        "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "sec_ch_ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        "sec_ch_ua_platform": '"Windows"',
        "sec_ch_ua_mobile": "?0",
    },
    {
        "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "sec_ch_ua": '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
        "sec_ch_ua_platform": '"Windows"',
        "sec_ch_ua_mobile": "?0",
    },
    # Chrome on Mac
    {
        "user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "sec_ch_ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        "sec_ch_ua_platform": '"macOS"',
        "sec_ch_ua_mobile": "?0",
    },
    # Firefox on Windows
    {
        "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
        "sec_ch_ua": None,  # Firefox doesn't send these
        "sec_ch_ua_platform": None,
        "sec_ch_ua_mobile": None,
    },
    # Firefox on Mac
    {
        "user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0",
        "sec_ch_ua": None,
        "sec_ch_ua_platform": None,
        "sec_ch_ua_mobile": None,
    },
    # Safari on Mac
    {
        "user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
        "sec_ch_ua": None,
        "sec_ch_ua_platform": None,
        "sec_ch_ua_mobile": None,
    },
    # Edge on Windows
    {
        "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
        "sec_ch_ua": '"Not_A Brand";v="8", "Chromium";v="120", "Microsoft Edge";v="120"',
        "sec_ch_ua_platform": '"Windows"',
        "sec_ch_ua_mobile": "?0",
    },
    # Chrome on Linux
    {
        "user_agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "sec_ch_ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        "sec_ch_ua_platform": '"Linux"',
        "sec_ch_ua_mobile": "?0",
    },
]

# Accept-Language variations
ACCEPT_LANGUAGES = [
    "en-US,en;q=0.9",
    "en-US,en;q=0.9,es;q=0.8",
    "en-GB,en;q=0.9,en-US;q=0.8",
    "en-US,en;q=0.9,fr;q=0.8",
    "en,en-US;q=0.9",
]

def get_random_headers():
    """Generate randomized but realistic browser headers"""
    profile = random.choice(BROWSER_PROFILES)

    headers = {
        "User-Agent": profile["user_agent"],
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": random.choice(ACCEPT_LANGUAGES),
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Cache-Control": random.choice(["max-age=0", "no-cache"]),
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
    }

    # Add Chrome-specific headers if present
    if profile.get("sec_ch_ua"):
        headers["Sec-CH-UA"] = profile["sec_ch_ua"]
        headers["Sec-CH-UA-Mobile"] = profile["sec_ch_ua_mobile"]
        headers["Sec-CH-UA-Platform"] = profile["sec_ch_ua_platform"]

    return headers


def extract_reputation_data(html_content):
    """Extract reputation data using regex patterns from RoboKiller HTML"""

    data = {
        "userReports": 0,
        "reputationStatus": "Unknown",
        "totalCalls": 0,
        "lastCallDate": None,
        "robokillerStatus": "Unknown",
        "spamScore": None,
        "callerName": None,
        "location": None,
        "carrier": None,
        "commentsCount": 0
    }

    # 1. Extract User Reputation from id="userReputation"
    # <div class="status" id="userReputation"><h3 class="green"> Positive </h3>
    user_rep = re.search(r'id="userReputation"[^>]*>.*?<h3[^>]*>\s*(Positive|Negative|Neutral|Unknown)\s*</h3>', html_content, re.IGNORECASE | re.DOTALL)
    if user_rep:
        data["reputationStatus"] = user_rep.group(1).strip().capitalize()

    # 2. Extract RoboKiller Status from id="roboStatus"
    # <div class="status" id="roboStatus"><h3 class="green"> Allowed </h3>
    robo_status = re.search(r'id="roboStatus"[^>]*>.*?<h3[^>]*>\s*(Allowed|Blocked|Unknown)\s*</h3>', html_content, re.IGNORECASE | re.DOTALL)
    if robo_status:
        data["robokillerStatus"] = robo_status.group(1).strip().capitalize()

    # 3. Extract Last Call Date from id="lastCall"
    # <div class="analytics-box" id="lastCall">...<h3>November 13, 2025</h3>
    last_call = re.search(r'id="lastCall"[^>]*>.*?<h3>([^<]+)</h3>', html_content, re.IGNORECASE | re.DOTALL)
    if last_call:
        data["lastCallDate"] = last_call.group(1).strip()

    # 4. Extract Total Calls from id="totalCall"
    # <div class="analytics-box" id="totalCall">...<h3>42</h3>
    total_calls = re.search(r'id="totalCall"[^>]*>.*?<h3>(\d+)</h3>', html_content, re.IGNORECASE | re.DOTALL)
    if total_calls:
        data["totalCalls"] = int(total_calls.group(1))

    # 5. Extract User Reports from id="userReports"
    # <div class="analytics-box" id="userReports">...<h3>2</h3>
    user_reports = re.search(r'id="userReports"[^>]*>.*?<h3>(\d+)</h3>', html_content, re.IGNORECASE | re.DOTALL)
    if user_reports:
        data["userReports"] = int(user_reports.group(1))

    # 6. Extract Comments Count from <h4>Comments <span> 1</span></h4>
    comments = re.search(r'<h4>Comments\s*<span>\s*(\d+)\s*</span>', html_content, re.IGNORECASE)
    if comments:
        data["commentsCount"] = int(comments.group(1))

    # 7. Extract Category/Caller Name from <p class="type">Pharmacy</p>
    caller_type = re.search(r'<p class="type">([^<]+)</p>', html_content)
    if caller_type:
        data["callerName"] = caller_type.group(1).strip()

    # FALLBACK: If main extraction failed, try og:description
    if data["reputationStatus"] == "Unknown":
        og_match = re.search(r'<meta[^>]*property="og:description"[^>]*content="([^"]+)"', html_content, re.IGNORECASE)
        if not og_match:
            og_match = re.search(r'<meta[^>]*content="([^"]+)"[^>]*property="og:description"', html_content, re.IGNORECASE)
        if og_match:
            og_content = og_match.group(1).strip()
            parts = og_content.split(';')
            if parts:
                status = parts[0].strip().lower()
                if status in ['positive', 'negative', 'neutral']:
                    data["reputationStatus"] = status.capitalize()
            if len(parts) > 1 and not data["callerName"]:
                data["callerName"] = parts[1].strip()

    return data


def is_blocked(html_content, status_code):
    """Check if the response indicates blocking"""
    if status_code == 429:
        return True, "Rate limit (429)"
    if status_code == 403:
        return True, "Forbidden (403)"
    if status_code >= 500:
        return True, f"Server error ({status_code})"

    html_lower = html_content.lower()

    if "captcha" in html_lower or "recaptcha" in html_lower:
        return True, "CAPTCHA detected"
    if "rate limit" in html_lower or "too many requests" in html_lower:
        return True, "Rate limit in content"
    if "access denied" in html_lower:
        return True, "Access denied"
    if "please verify" in html_lower and "human" in html_lower:
        return True, "Human verification"
    if len(html_content) < 500:
        return True, f"Suspicious short response ({len(html_content)} bytes)"

    return False, None


async def scrape_single(session, phone_number, proxy=None):
    """Scrape a single phone number with randomized browser fingerprint"""
    clean_number = re.sub(r'\D', '', phone_number)
    url = f"https://lookup.robokiller.com/search?q={clean_number}"

    # Get randomized realistic browser headers
    headers = get_random_headers()

    try:
        async with session.get(url, headers=headers, proxy=proxy, timeout=10) as response:
            html = await response.text()
            status = response.status

            blocked, block_reason = is_blocked(html, status)

            if blocked:
                return {
                    "success": False,
                    "phone": clean_number,
                    "error": block_reason,
                    "is_blocked": True,
                    "status_code": status
                }

            data = extract_reputation_data(html)
            return {
                "success": True,
                "phone": clean_number,
                "data": data,
                "method": "fast_http",
                "html_size": len(html),
                "status_code": status
            }

    except asyncio.TimeoutError:
        return {"success": False, "phone": clean_number, "error": "Timeout", "is_blocked": False}
    except aiohttp.ClientError as e:
        return {"success": False, "phone": clean_number, "error": str(e), "is_blocked": False}
    except Exception as e:
        return {"success": False, "phone": clean_number, "error": str(e), "is_blocked": False}


async def scrape_batch(phone_numbers, proxy=None, concurrency=10):
    """Scrape multiple phone numbers concurrently"""
    connector = aiohttp.TCPConnector(limit=concurrency, limit_per_host=concurrency)
    timeout = aiohttp.ClientTimeout(total=15)

    async with aiohttp.ClientSession(connector=connector, timeout=timeout) as session:
        tasks = [scrape_single(session, phone, proxy) for phone in phone_numbers]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Convert exceptions to error results
        processed = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                processed.append({
                    "success": False,
                    "phone": phone_numbers[i],
                    "error": str(result),
                    "is_blocked": False
                })
            else:
                processed.append(result)

        return processed


async def main():
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "Phone number required"}))
        return

    phone_number = sys.argv[1]
    proxy_url = None

    for arg in sys.argv[2:]:
        if arg.startswith('--proxy='):
            proxy_url = arg.split('=', 1)[1]
            break

    connector = aiohttp.TCPConnector(limit=1)
    timeout = aiohttp.ClientTimeout(total=15)

    async with aiohttp.ClientSession(connector=connector, timeout=timeout) as session:
        result = await scrape_single(session, phone_number, proxy_url)
        print(json.dumps(result))


if __name__ == "__main__":
    asyncio.run(main())
