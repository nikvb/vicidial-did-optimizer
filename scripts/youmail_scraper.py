#!/usr/bin/env python3
"""
YouMail Phone Reputation Scraper with Session Persistence

After solving Cloudflare challenge once, reuses the same session
for multiple lookups until blocked.

Usage:
    from youmail_scraper import YouMailScraper

    async with YouMailScraper() as scraper:
        # First lookup solves challenge, subsequent ones reuse session
        data1 = await scraper.lookup("305-988-6649")
        data2 = await scraper.lookup("212-555-1234")  # Same session
        data3 = await scraper.lookup("415-555-6789")  # Same session

CLI:
    python youmail_scraper.py 3059886649
    python youmail_scraper.py 305-988-6649 --json
    python youmail_scraper.py --bulk numbers.txt  # One number per line
"""

import asyncio
import aiohttp
import sys
import os
import re
import json
import base64
import random
from typing import Optional, Dict, Any, List
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path

from playwright.async_api import async_playwright, Page, BrowserContext
import httpx

# Configuration
WEBSHARE_API_KEY = os.getenv('WEBSHARE_API_KEY', 'qcv48genia4yzeayykuh4qzvqusywmbgko6k2ppv')
AI_MODEL_URL = os.getenv('AI_MODEL_URL', 'http://199.68.217.31:47101/v1')
AI_MODEL_NAME = os.getenv('AI_MODEL_NAME', 'captcha-solver')


@dataclass
class YouMailData:
    """Structured YouMail lookup result"""
    phone_number: str
    formatted_number: str = ""
    name: str = ""
    location: str = ""
    spam_status: str = "unknown"
    typical_message: str = ""
    report_count: int = 0
    success: bool = False
    error: Optional[str] = None
    scraped_at: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


class WebshareProxies:
    """Webshare proxy management"""

    def __init__(self):
        self.proxies: List[Dict] = []
        self.blocked: set = set()

    async def load(self) -> int:
        """Load proxies from Webshare API"""
        async with aiohttp.ClientSession() as session:
            try:
                async with session.get(
                    'https://proxy.webshare.io/api/v2/proxy/list/',
                    headers={'Authorization': f'Token {WEBSHARE_API_KEY}'},
                    params={'mode': 'direct', 'page_size': 100}
                ) as resp:
                    data = await resp.json()
                    for p in data.get('results', []):
                        if p.get('valid', True):
                            self.proxies.append({
                                'host': p['proxy_address'],
                                'port': p['port'],
                                'username': p['username'],
                                'password': p['password'],
                                'country': p.get('country_code', 'US')
                            })
            except Exception as e:
                print(f"Error loading proxies: {e}", file=sys.stderr)

        return len(self.proxies)

    def get_proxy(self, prefer_country: str = 'US') -> Optional[Dict]:
        """Get a random non-blocked proxy"""
        available = [p for p in self.proxies if p['host'] not in self.blocked]
        if not available:
            self.blocked.clear()
            available = self.proxies

        preferred = [p for p in available if p['country'] == prefer_country]
        if preferred:
            return random.choice(preferred)
        return random.choice(available) if available else None

    def mark_blocked(self, host: str):
        self.blocked.add(host)


class AIChallengeSolver:
    """AI-powered Cloudflare challenge solver"""

    def __init__(self, model_url: str = AI_MODEL_URL, model_name: str = AI_MODEL_NAME):
        self.model_url = model_url
        self.model_name = model_name

    async def analyze(self, screenshot: bytes, width: int, height: int) -> Dict:
        """Analyze screenshot for challenges"""
        base64_img = base64.b64encode(screenshot).decode('utf-8')

        prompt = f"""Analyze this {width}x{height} screenshot for Cloudflare protection.

Respond with JSON only:
{{
    "page_type": "blocked|challenge|content",
    "has_turnstile": true/false,
    "click_x": <number or null>,
    "click_y": <number or null>
}}

- "blocked": Shows "You have been blocked" or access denied
- "challenge": Shows turnstile checkbox or verification
- "content": Normal page content (not a challenge)

If turnstile checkbox found, provide click coordinates for its center."""

        try:
            async with httpx.AsyncClient(timeout=45) as client:
                resp = await client.post(
                    f'{self.model_url}/chat/completions',
                    json={
                        'model': self.model_name,
                        'messages': [{
                            'role': 'user',
                            'content': [
                                {'type': 'image_url', 'image_url': {'url': f'data:image/png;base64,{base64_img}'}},
                                {'type': 'text', 'text': prompt}
                            ]
                        }],
                        'max_tokens': 256,
                        'temperature': 0.1
                    }
                )
                content = resp.json()['choices'][0]['message']['content']
                match = re.search(r'\{.*\}', content, re.DOTALL)
                if match:
                    return json.loads(match.group(0))
        except Exception as e:
            print(f"AI error: {e}", file=sys.stderr)

        return {"page_type": "unknown"}


class YouMailSession:
    """
    Persistent YouMail session that survives multiple lookups.

    Once Cloudflare challenge is solved, the session cookies
    allow subsequent requests without re-solving.
    """

    def __init__(self, context: BrowserContext, page: Page, proxy: Dict):
        self.context = context
        self.page = page
        self.proxy = proxy
        self.lookup_count = 0
        self.created_at = datetime.now()
        self.last_used = datetime.now()
        self.is_valid = True

    async def close(self):
        """Close the session"""
        try:
            await self.page.close()
            await self.context.close()
        except:
            pass
        self.is_valid = False


class YouMailScraper:
    """
    YouMail phone reputation scraper with session persistence.

    Key optimization: After solving Cloudflare challenge once,
    reuses the same browser session for multiple lookups.
    """

    def __init__(
        self,
        headless: bool = True,
        max_challenge_attempts: int = 5,
        timeout: int = 30000,
        session_max_lookups: int = 100,  # Max lookups per session before rotating
    ):
        self.headless = headless
        self.max_challenge_attempts = max_challenge_attempts
        self.timeout = timeout
        self.session_max_lookups = session_max_lookups

        self.proxies = WebshareProxies()
        self.ai = AIChallengeSolver()
        self.playwright = None
        self.browser = None

        # Active session
        self.session: Optional[YouMailSession] = None

    async def __aenter__(self):
        await self.start()
        return self

    async def __aexit__(self, *args):
        await self.close()

    async def start(self):
        """Initialize scraper"""
        count = await self.proxies.load()
        print(f"✓ Loaded {count} proxies", file=sys.stderr)

        self.playwright = await async_playwright().start()
        self.browser = await self.playwright.chromium.launch(
            headless=self.headless,
            args=[
                '--disable-blink-features=AutomationControlled',
                '--no-sandbox',
                '--disable-setuid-sandbox',
            ]
        )

    async def close(self):
        """Cleanup"""
        if self.session:
            await self.session.close()
        if self.browser:
            await self.browser.close()
        if self.playwright:
            await self.playwright.stop()

    def _normalize_phone(self, phone: str) -> str:
        return re.sub(r'\D', '', phone)

    def _format_phone(self, phone: str) -> str:
        digits = self._normalize_phone(phone)
        if len(digits) == 10:
            return f"{digits[:3]}-{digits[3:6]}-{digits[6:]}"
        elif len(digits) == 11 and digits[0] == '1':
            return f"{digits[1:4]}-{digits[4:7]}-{digits[7:]}"
        return digits

    def _parse_html(self, html: str, phone: str) -> YouMailData:
        """Parse YouMail HTML for phone data"""
        data = YouMailData(
            phone_number=self._normalize_phone(phone),
            formatted_number=self._format_phone(phone),
            scraped_at=datetime.now().isoformat()
        )

        if 'you have been blocked' in html.lower():
            data.error = "IP blocked"
            return data

        if 'just a moment' in html.lower() or len(html) < 5000:
            data.error = "Challenge not solved"
            return data

        # Extract name
        name_match = re.search(
            r'ym-phone-summary-info-name[^>]*>.*?<h2[^>]*>([^<]+)</h2>',
            html, re.DOTALL | re.IGNORECASE
        )
        if name_match:
            data.name = name_match.group(1).strip()

        # Extract location
        loc_match = re.search(
            r'Location</span>.*?<h2[^>]*>([^<]+)</h2>',
            html, re.DOTALL | re.IGNORECASE
        )
        if loc_match:
            data.location = loc_match.group(1).strip()

        # Extract typical message
        msg_match = re.search(
            r'typical-message-text[^>]*>([^<]+)',
            html, re.IGNORECASE
        )
        if msg_match:
            data.typical_message = msg_match.group(1).strip()

        # Spam indicators
        html_lower = html.lower()
        if 'spam' in html_lower or 'robocall' in html_lower or 'scam' in html_lower:
            data.spam_status = 'spam'
        elif 'safe' in html_lower or 'legitimate' in html_lower:
            data.spam_status = 'safe'

        reports_match = re.search(r'(\d+)\s*reports?', html, re.IGNORECASE)
        if reports_match:
            data.report_count = int(reports_match.group(1))

        data.success = bool(data.name or data.location or data.typical_message) or len(html) > 10000
        return data

    async def _create_session(self) -> Optional[YouMailSession]:
        """Create a new session with proxy and solve initial challenge"""

        for attempt in range(self.max_challenge_attempts):
            proxy = self.proxies.get_proxy('US')
            if not proxy:
                print("No proxies available!", file=sys.stderr)
                return None

            print(f"Creating session with proxy {proxy['host']} ({proxy['country']})...", file=sys.stderr)

            try:
                context = await self.browser.new_context(
                    viewport={'width': 1280, 'height': 800},
                    user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    proxy={
                        'server': f"http://{proxy['host']}:{proxy['port']}",
                        'username': proxy['username'],
                        'password': proxy['password']
                    }
                )

                await context.add_init_script("""
                    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                    window.chrome = { runtime: {} };
                """)

                page = await context.new_page()
                page.set_default_timeout(self.timeout)

                # Navigate to main directory to trigger and solve challenge
                print("  Navigating to youmail directory...", file=sys.stderr)
                await page.goto('https://directory.youmail.com/', wait_until='domcontentloaded')
                await asyncio.sleep(3)

                # Check for challenge
                for solve_attempt in range(3):
                    screenshot = await page.screenshot(type='png')
                    analysis = await self.ai.analyze(screenshot, 1280, 800)

                    page_type = analysis.get('page_type', 'unknown')
                    print(f"  Page type: {page_type}", file=sys.stderr)

                    if page_type == 'blocked':
                        print(f"  Proxy blocked, trying another...", file=sys.stderr)
                        self.proxies.mark_blocked(proxy['host'])
                        await context.close()
                        break

                    elif page_type == 'challenge':
                        if analysis.get('click_x') and analysis.get('click_y'):
                            x, y = analysis['click_x'], analysis['click_y']
                            print(f"  Solving challenge - clicking at ({x}, {y})...", file=sys.stderr)
                            await page.mouse.click(x, y)
                            await asyncio.sleep(4)
                        else:
                            await asyncio.sleep(2)
                        continue

                    elif page_type == 'content' or page_type == 'unknown':
                        # Check HTML length to verify we passed
                        html = await page.content()
                        if len(html) > 10000 and 'youmail' in html.lower():
                            print(f"  ✓ Session established! (HTML: {len(html)} bytes)", file=sys.stderr)
                            return YouMailSession(context, page, proxy)

                await context.close()

            except Exception as e:
                print(f"  Session creation error: {e}", file=sys.stderr)
                self.proxies.mark_blocked(proxy['host'])

        return None

    async def _ensure_session(self) -> bool:
        """Ensure we have a valid session"""
        # Check if current session is still valid
        if self.session and self.session.is_valid:
            if self.session.lookup_count < self.session_max_lookups:
                return True
            else:
                print(f"Session reached {self.session_max_lookups} lookups, rotating...", file=sys.stderr)
                await self.session.close()
                self.session = None

        # Create new session
        self.session = await self._create_session()
        return self.session is not None

    async def lookup(self, phone: str) -> YouMailData:
        """
        Look up phone number reputation.

        Reuses existing session if available, creates new one if needed.
        """
        formatted = self._format_phone(phone)
        url = f"https://directory.youmail.com/phone/{formatted}"

        for attempt in range(3):
            if not await self._ensure_session():
                return YouMailData(
                    phone_number=self._normalize_phone(phone),
                    formatted_number=formatted,
                    error="Could not establish session"
                )

            try:
                # Navigate to phone page using existing session
                await self.session.page.goto(url, wait_until='domcontentloaded')
                await asyncio.sleep(1.5)

                html = await self.session.page.content()
                self.session.lookup_count += 1
                self.session.last_used = datetime.now()

                # Check if we got blocked
                if 'you have been blocked' in html.lower() or len(html) < 3000:
                    print(f"  Session invalidated (blocked or challenge), creating new...", file=sys.stderr)
                    self.proxies.mark_blocked(self.session.proxy['host'])
                    await self.session.close()
                    self.session = None
                    continue

                data = self._parse_html(html, phone)
                return data

            except Exception as e:
                print(f"  Lookup error: {e}", file=sys.stderr)
                if self.session:
                    await self.session.close()
                    self.session = None

        return YouMailData(
            phone_number=self._normalize_phone(phone),
            formatted_number=formatted,
            error="Failed after retries"
        )

    async def bulk_lookup(
        self,
        phones: List[str],
        delay: float = 0.5
    ) -> List[YouMailData]:
        """
        Look up multiple phone numbers using persistent session.

        Much faster than individual lookups since challenge is
        only solved once per session.
        """
        results = []
        success_count = 0
        fail_count = 0

        print(f"\nStarting bulk lookup of {len(phones)} numbers...", file=sys.stderr)

        for i, phone in enumerate(phones):
            data = await self.lookup(phone)
            results.append(data)

            if data.success:
                success_count += 1
                print(f"  [{i+1}/{len(phones)}] {data.formatted_number}: {data.name or 'N/A'} ({data.location or 'N/A'})", file=sys.stderr)
            else:
                fail_count += 1
                print(f"  [{i+1}/{len(phones)}] {data.formatted_number}: FAILED - {data.error}", file=sys.stderr)

            if i < len(phones) - 1:
                await asyncio.sleep(delay)

        print(f"\nCompleted: {success_count} success, {fail_count} failed", file=sys.stderr)
        return results


async def main():
    """CLI entry point"""
    import argparse

    parser = argparse.ArgumentParser(description="YouMail phone reputation lookup")
    parser.add_argument("phone", nargs='?', help="Phone number to look up")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    parser.add_argument("--no-headless", action="store_true", help="Show browser")
    parser.add_argument("--bulk", metavar="FILE", help="Bulk lookup from file (one number per line)")
    args = parser.parse_args()

    async with YouMailScraper(headless=not args.no_headless) as scraper:
        if args.bulk:
            # Bulk lookup
            with open(args.bulk) as f:
                phones = [line.strip() for line in f if line.strip()]

            results = await scraper.bulk_lookup(phones)

            if args.json:
                print(json.dumps([r.to_dict() for r in results], indent=2))
            else:
                print(f"\n{'='*60}")
                print(f"Bulk Lookup Results: {len([r for r in results if r.success])}/{len(results)} successful")

        elif args.phone:
            # Single lookup
            data = await scraper.lookup(args.phone)

            if args.json:
                print(json.dumps(data.to_dict(), indent=2))
            else:
                print(f"\nYouMail Lookup: {data.formatted_number}")
                print("-" * 40)
                if data.success:
                    print(f"Name: {data.name or 'N/A'}")
                    print(f"Location: {data.location or 'N/A'}")
                    print(f"Spam Status: {data.spam_status}")
                    if data.typical_message:
                        print(f"Message: {data.typical_message[:100]}...")
                    print(f"Reports: {data.report_count}")
                else:
                    print(f"Error: {data.error}")
        else:
            parser.print_help()


if __name__ == "__main__":
    asyncio.run(main())
