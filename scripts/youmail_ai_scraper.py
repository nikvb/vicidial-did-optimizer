#!/usr/bin/env python3
"""
YouMail AI-Powered Reputation Scraper

Uses AI vision model for both:
1. Cloudflare challenge solving
2. Intelligent data extraction from page content

Extracts all reputation-relevant fields automatically.
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
from dataclasses import dataclass, asdict, field
from datetime import datetime

from playwright.async_api import async_playwright, Page, BrowserContext
from motor.motor_asyncio import AsyncIOMotorClient
import httpx

# Configuration
WEBSHARE_API_KEY = os.getenv('WEBSHARE_API_KEY', 'qcv48genia4yzeayykuh4qzvqusywmbgko6k2ppv')
AI_MODEL_URL = os.getenv('AI_MODEL_URL', 'http://199.68.217.31:47101/v1')
AI_MODEL_NAME = os.getenv('AI_MODEL_NAME', 'captcha-solver')
MONGODB_URI = os.getenv('MONGODB_URI', 'mongodb://127.0.0.1:27017/did-optimizer')


@dataclass
class YouMailReputation:
    """Complete reputation data from YouMail"""
    phone_number: str
    formatted_number: str = ""

    # Owner info
    owner_name: str = ""
    owner_type: str = ""  # person, business, unknown
    location: str = ""
    city: str = ""
    state: str = ""
    carrier: str = ""
    line_type: str = ""  # mobile, landline, voip

    # Reputation
    spam_score: int = 0  # 0-100
    spam_status: str = "unknown"  # spam, safe, suspicious, unknown
    call_type: str = ""  # robocall, telemarketer, scam, legitimate, unknown
    complaint_count: int = 0
    report_count: int = 0

    # Activity
    typical_message: str = ""
    call_volume: str = ""  # high, medium, low
    last_reported: str = ""

    # Meta
    success: bool = False
    error: Optional[str] = None
    scraped_at: str = ""
    raw_data: Dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        d = asdict(self)
        del d['raw_data']  # Don't include raw in output
        return d


class WebshareProxies:
    """Webshare proxy management"""

    def __init__(self):
        self.proxies: List[Dict] = []
        self.blocked: set = set()

    async def load(self) -> int:
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
                print(f"Proxy load error: {e}", file=sys.stderr)
        return len(self.proxies)

    def get_proxy(self, prefer_country: str = 'US') -> Optional[Dict]:
        available = [p for p in self.proxies if p['host'] not in self.blocked]
        if not available:
            self.blocked.clear()
            available = self.proxies
        preferred = [p for p in available if p['country'] == prefer_country]
        return random.choice(preferred if preferred else available) if available else None

    def mark_blocked(self, host: str):
        self.blocked.add(host)


class AIAnalyzer:
    """AI-powered page analysis and data extraction"""

    def __init__(self, model_url: str = AI_MODEL_URL, model_name: str = AI_MODEL_NAME):
        self.model_url = model_url
        self.model_name = model_name

    async def analyze_challenge(self, screenshot: bytes, width: int, height: int) -> Dict:
        """Analyze screenshot for Cloudflare challenges"""
        base64_img = base64.b64encode(screenshot).decode('utf-8')

        prompt = f"""Analyze this {width}x{height} screenshot for Cloudflare protection.

JSON response only:
{{"page_type": "blocked|challenge|content", "click_x": <int or null>, "click_y": <int or null>}}

- blocked: "You have been blocked" or access denied
- challenge: Turnstile checkbox visible (provide click coords)
- content: Normal page content"""

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    f'{self.model_url}/chat/completions',
                    json={
                        'model': self.model_name,
                        'messages': [{'role': 'user', 'content': [
                            {'type': 'image_url', 'image_url': {'url': f'data:image/png;base64,{base64_img}'}},
                            {'type': 'text', 'text': prompt}
                        ]}],
                        'max_tokens': 128,
                        'temperature': 0.1
                    }
                )
                content = resp.json()['choices'][0]['message']['content']
                match = re.search(r'\{.*\}', content, re.DOTALL)
                if match:
                    return json.loads(match.group(0))
        except:
            pass
        return {"page_type": "unknown"}

    async def extract_reputation(self, html: str, phone: str) -> Dict:
        """Use AI to extract all reputation data from HTML"""

        # Clean HTML - remove scripts, styles, and excessive whitespace
        # Keep under 32K tokens (~20K chars to be safe)
        clean_html = re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.DOTALL | re.IGNORECASE)
        clean_html = re.sub(r'<style[^>]*>.*?</style>', '', clean_html, flags=re.DOTALL | re.IGNORECASE)
        clean_html = re.sub(r'<svg[^>]*>.*?</svg>', '', clean_html, flags=re.DOTALL | re.IGNORECASE)
        clean_html = re.sub(r'<!--.*?-->', '', clean_html, flags=re.DOTALL)
        clean_html = re.sub(r'\s+', ' ', clean_html)

        # Truncate to ~20K chars (safe for 32K context with prompt overhead)
        relevant_html = clean_html[:20000]

        prompt = f"""Analyze this YouMail phone lookup page for {phone} and extract ALL reputation information.

Return a JSON object with these fields (use null if not found, be thorough):
{{
    "owner_name": "full name of phone owner",
    "owner_type": "person|business|unknown",
    "location": "full location string",
    "city": "city name only",
    "state": "state abbreviation",
    "carrier": "phone carrier/provider",
    "line_type": "mobile|landline|voip|unknown",
    "spam_score": 0-100 integer based on page content,
    "spam_status": "spam|safe|suspicious|unknown",
    "call_type": "robocall|telemarketer|scam|debt_collector|survey|legitimate|unknown",
    "complaint_count": integer number of complaints,
    "report_count": integer number of reports,
    "typical_message": "transcription of voicemail if shown",
    "call_volume": "high|medium|low|unknown",
    "tags": ["list", "of", "relevant", "tags"],
    "summary": "one sentence summary of this number's reputation"
}}

Key things to look for:
- Owner name in ym-phone-summary-info-name sections
- Location near "Location" labels
- Voicemail transcripts in typical-message sections
- Report counts mentioned anywhere
- Spam/scam/robocall indicators
- Business names if it's a business line
- Any caller ID information

Page HTML:
{relevant_html}"""

        try:
            async with httpx.AsyncClient(timeout=90) as client:
                resp = await client.post(
                    f'{self.model_url}/chat/completions',
                    json={
                        'model': self.model_name,
                        'messages': [{'role': 'user', 'content': prompt}],
                        'max_tokens': 1024,
                        'temperature': 0.1
                    }
                )
                data = resp.json()
                if 'choices' in data:
                    content = data['choices'][0]['message']['content']
                    match = re.search(r'\{.*\}', content, re.DOTALL)
                    if match:
                        return json.loads(match.group(0))
                else:
                    print(f"AI response missing choices: {str(data)[:200]}", file=sys.stderr)
        except Exception as e:
            print(f"AI extraction error: {e}", file=sys.stderr)

        return {}


class YouMailSession:
    """Persistent browser session"""

    def __init__(self, context: BrowserContext, page: Page, proxy: Dict):
        self.context = context
        self.page = page
        self.proxy = proxy
        self.lookup_count = 0
        self.is_valid = True

    async def close(self):
        try:
            await self.page.close()
            await self.context.close()
        except:
            pass
        self.is_valid = False


class YouMailAIScraper:
    """
    YouMail scraper with AI-powered extraction.

    Features:
    - Session persistence (solve challenge once, reuse for many lookups)
    - AI vision for challenge detection
    - AI text for intelligent data extraction
    - Proxy rotation with health tracking
    """

    def __init__(
        self,
        headless: bool = True,
        timeout: int = 30000,
        session_max_lookups: int = 50,
    ):
        self.headless = headless
        self.timeout = timeout
        self.session_max_lookups = session_max_lookups

        self.proxies = WebshareProxies()
        self.ai = AIAnalyzer()
        self.playwright = None
        self.browser = None
        self.session: Optional[YouMailSession] = None

        # Stats
        self.total_lookups = 0
        self.successful_lookups = 0
        self.sessions_created = 0

    async def __aenter__(self):
        await self.start()
        return self

    async def __aexit__(self, *args):
        await self.close()

    async def start(self):
        count = await self.proxies.load()
        print(f"✓ Loaded {count} proxies", file=sys.stderr)

        self.playwright = await async_playwright().start()
        self.browser = await self.playwright.chromium.launch(
            headless=self.headless,
            args=['--disable-blink-features=AutomationControlled', '--no-sandbox']
        )

    async def close(self):
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

    async def _create_session(self) -> Optional[YouMailSession]:
        """Create session and solve initial challenge"""
        for _ in range(5):
            proxy = self.proxies.get_proxy('US')
            if not proxy:
                return None

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
                await context.add_init_script("Object.defineProperty(navigator, 'webdriver', { get: () => undefined });")

                page = await context.new_page()
                page.set_default_timeout(self.timeout)

                # Use main directory to trigger any challenge
                await page.goto('https://directory.youmail.com/', wait_until='domcontentloaded')
                await asyncio.sleep(2)

                # Solve challenges
                for _ in range(3):
                    screenshot = await page.screenshot(type='png')
                    analysis = await self.ai.analyze_challenge(screenshot, 1280, 800)

                    if analysis.get('page_type') == 'blocked':
                        self.proxies.mark_blocked(proxy['host'])
                        await context.close()
                        break

                    elif analysis.get('page_type') == 'challenge':
                        if analysis.get('click_x'):
                            await page.mouse.click(analysis['click_x'], analysis['click_y'])
                            await asyncio.sleep(3)
                        continue

                    else:
                        html = await page.content()
                        if len(html) > 10000:
                            self.sessions_created += 1
                            print(f"✓ Session {self.sessions_created} ready (proxy: {proxy['host']})", file=sys.stderr)
                            return YouMailSession(context, page, proxy)

                await context.close()
            except Exception as e:
                self.proxies.mark_blocked(proxy['host'])

        return None

    async def _ensure_session(self) -> bool:
        if self.session and self.session.is_valid and self.session.lookup_count < self.session_max_lookups:
            return True
        if self.session:
            await self.session.close()
        self.session = await self._create_session()
        return self.session is not None

    async def lookup(self, phone: str) -> YouMailReputation:
        """Look up phone with AI-powered extraction"""
        formatted = self._format_phone(phone)
        result = YouMailReputation(
            phone_number=self._normalize_phone(phone),
            formatted_number=formatted,
            scraped_at=datetime.now().isoformat()
        )

        self.total_lookups += 1

        for _ in range(3):
            if not await self._ensure_session():
                result.error = "No session"
                return result

            try:
                # Use path format
                url = f"https://directory.youmail.com/phone/{formatted}"
                await self.session.page.goto(url, wait_until='domcontentloaded')
                await asyncio.sleep(1)

                html = await self.session.page.content()
                self.session.lookup_count += 1

                if 'blocked' in html.lower() or len(html) < 3000:
                    self.proxies.mark_blocked(self.session.proxy['host'])
                    await self.session.close()
                    self.session = None
                    continue

                # AI extraction
                extracted = await self.ai.extract_reputation(html, formatted)

                # Map extracted data to result
                result.owner_name = extracted.get('owner_name') or ""
                result.owner_type = extracted.get('owner_type') or "unknown"
                result.location = extracted.get('location') or ""
                result.city = extracted.get('city') or ""
                result.state = extracted.get('state') or ""
                result.carrier = extracted.get('carrier') or ""
                result.line_type = extracted.get('line_type') or "unknown"
                result.spam_score = extracted.get('spam_score') or 0
                result.spam_status = extracted.get('spam_status') or "unknown"
                result.call_type = extracted.get('call_type') or "unknown"
                result.complaint_count = extracted.get('complaint_count') or 0
                result.report_count = extracted.get('report_count') or 0
                result.typical_message = extracted.get('typical_message') or ""
                result.call_volume = extracted.get('call_volume') or "unknown"
                result.last_reported = extracted.get('last_reported') or ""

                result.success = True
                self.successful_lookups += 1
                return result

            except Exception as e:
                if self.session:
                    await self.session.close()
                    self.session = None

        result.error = "Failed after retries"
        return result


async def test_with_db_numbers(limit: int = 100):
    """Test with real numbers from MongoDB"""

    # Connect to MongoDB
    client = AsyncIOMotorClient(MONGODB_URI)
    db = client.get_database()

    # Get RANDOM DIDs from database using aggregation
    print(f"Fetching {limit} random DIDs from database...", file=sys.stderr)
    pipeline = [
        {'$match': {'status': 'active', 'phoneNumber': {'$exists': True}}},
        {'$sample': {'size': limit}},
        {'$project': {'phoneNumber': 1}}
    ]
    dids = await db.dids.aggregate(pipeline).to_list(length=limit)

    if not dids:
        print("No DIDs found in database!", file=sys.stderr)
        return

    phones = [did['phoneNumber'].replace('+1', '').replace('+', '') for did in dids if did.get('phoneNumber')]
    print(f"Found {len(phones)} DIDs to lookup", file=sys.stderr)

    # Scrape
    async with YouMailAIScraper(headless=True) as scraper:
        results = []

        for i, phone in enumerate(phones):
            result = await scraper.lookup(phone)
            results.append(result)

            status = "✓" if result.success else "✗"
            info = f"{result.owner_name or 'N/A'} | {result.location or 'N/A'} | {result.spam_status}"
            print(f"[{i+1}/{len(phones)}] {status} {result.formatted_number}: {info}", file=sys.stderr)

            await asyncio.sleep(0.3)

        # Summary
        print(f"\n{'='*60}", file=sys.stderr)
        print(f"Total: {scraper.total_lookups}", file=sys.stderr)
        print(f"Success: {scraper.successful_lookups}", file=sys.stderr)
        print(f"Sessions used: {scraper.sessions_created}", file=sys.stderr)

        # Output results as JSON
        print(json.dumps([r.to_dict() for r in results], indent=2))

    client.close()


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("phone", nargs='?', help="Single phone lookup")
    parser.add_argument("--db", type=int, metavar="N", help="Lookup N numbers from database")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    if args.db:
        asyncio.run(test_with_db_numbers(args.db))
    elif args.phone:
        async def single():
            async with YouMailAIScraper() as scraper:
                result = await scraper.lookup(args.phone)
                if args.json:
                    print(json.dumps(result.to_dict(), indent=2))
                else:
                    print(f"\n{result.formatted_number}")
                    print(f"  Owner: {result.owner_name or 'N/A'} ({result.owner_type})")
                    print(f"  Location: {result.location}")
                    print(f"  Spam: {result.spam_status} (score: {result.spam_score})")
                    print(f"  Type: {result.call_type}")
                    print(f"  Reports: {result.report_count}")
        asyncio.run(single())
    else:
        parser.print_help()
