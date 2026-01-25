#!/usr/bin/env python3
"""
Test youmail scraping with Webshare rotating proxies and AI captcha solver
"""

import asyncio
import aiohttp
import sys
import os
import base64
import random
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from playwright.async_api import async_playwright
import httpx

# Webshare API key from bulk_update_reputation.py
WEBSHARE_API_KEY = os.getenv('WEBSHARE_API_KEY', 'qcv48genia4yzeayykuh4qzvqusywmbgko6k2ppv')


class WebshareProxyRotator:
    """Proxy rotator using Webshare API"""

    def __init__(self):
        self.proxies = []
        self.proxy_stats = {}

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
                                'port': p['port'],
                                'username': p['username'],
                                'password': p['password'],
                                'country': p.get('country_code', 'US')
                            })
                            self.proxy_stats[proxy_url] = {'success': 0, 'blocked': 0}

        print(f"✓ Loaded {len(self.proxies)} Webshare proxies")
        # Show country distribution
        countries = {}
        for p in self.proxies:
            c = p['country']
            countries[c] = countries.get(c, 0) + 1
        print(f"  Countries: {dict(sorted(countries.items(), key=lambda x: -x[1])[:5])}")
        return len(self.proxies)

    def get_random_proxy(self):
        """Get a random healthy proxy"""
        # Prefer US proxies for US sites
        us_proxies = [p for p in self.proxies
                      if p['country'] == 'US'
                      and self.proxy_stats.get(p['url'], {}).get('blocked', 0) < 3]
        if us_proxies:
            return random.choice(us_proxies)

        healthy = [p for p in self.proxies
                   if self.proxy_stats.get(p['url'], {}).get('blocked', 0) < 3]
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


async def analyze_with_ai(screenshot_bytes: bytes, viewport_width: int, viewport_height: int) -> dict:
    """Send screenshot to AI model for analysis"""
    base64_image = base64.b64encode(screenshot_bytes).decode('utf-8')

    prompt = f"""Analyze this webpage screenshot for Cloudflare challenges.
Image dimensions: {viewport_width}x{viewport_height} pixels.

Look for:
1. Turnstile checkbox widget (small checkbox, usually in a white/gray box)
2. "Verify you are human" or similar text
3. Any CAPTCHA or interactive challenge
4. Block messages ("You have been blocked", "Access denied")

Respond in JSON format ONLY:
{{
    "page_type": "blocked|challenge|normal",
    "challenge_type": "turnstile|captcha|interactive|none",
    "description": "what you see",
    "has_clickable_element": true/false,
    "click_x": <number or null>,
    "click_y": <number or null>,
    "confidence": 0.0-1.0
}}"""

    async with httpx.AsyncClient(timeout=60) as client:
        try:
            response = await client.post(
                'http://199.68.217.31:47101/v1/chat/completions',
                json={
                    'model': 'captcha-solver',
                    'messages': [{
                        'role': 'user',
                        'content': [
                            {'type': 'image_url', 'image_url': {'url': f'data:image/png;base64,{base64_image}'}},
                            {'type': 'text', 'text': prompt}
                        ]
                    }],
                    'max_tokens': 512,
                    'temperature': 0.1
                }
            )
            response.raise_for_status()
            content = response.json()['choices'][0]['message']['content']

            # Parse JSON from response
            import json
            import re
            json_match = re.search(r'\{.*\}', content, re.DOTALL)
            if json_match:
                return json.loads(json_match.group(0))
        except Exception as e:
            print(f"  AI error: {e}")

    return {"page_type": "unknown", "error": str(e) if 'e' in dir() else "parse error"}


async def test_youmail_with_proxies():
    """Test youmail with Webshare proxies"""
    print("=" * 60)
    print("YouMail Scraper with Webshare Proxies + AI Captcha Solver")
    print("=" * 60)

    # Load proxies
    rotator = WebshareProxyRotator()
    count = await rotator.load_proxies()
    if count == 0:
        print("ERROR: No proxies loaded!")
        return

    # Test URL
    url = "https://directory.youmail.com/phone/305-988-6649"
    print(f"\nTarget: {url}")

    async with async_playwright() as p:
        for attempt in range(5):
            proxy_info = rotator.get_random_proxy()
            if not proxy_info:
                print("No proxies available!")
                break

            proxy_url = proxy_info['url']
            print(f"\n--- Attempt {attempt + 1} ---")
            print(f"Proxy: {proxy_info['host']}:{proxy_info['port']} ({proxy_info['country']})")

            try:
                browser = await p.chromium.launch(
                    headless=True,
                    args=[
                        '--disable-blink-features=AutomationControlled',
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                    ]
                )

                context = await browser.new_context(
                    viewport={'width': 1280, 'height': 800},
                    user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    proxy={
                        'server': f"http://{proxy_info['host']}:{proxy_info['port']}",
                        'username': proxy_info['username'],
                        'password': proxy_info['password']
                    }
                )

                # Add stealth
                await context.add_init_script("""
                    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                    window.chrome = { runtime: {} };
                """)

                page = await context.new_page()
                page.set_default_timeout(30000)

                response = await page.goto(url, wait_until='domcontentloaded')
                print(f"Status: {response.status if response else 'N/A'}")

                await asyncio.sleep(3)  # Wait for challenge to load

                # Take screenshot
                screenshot = await page.screenshot(type='png')
                screenshot_path = f'/tmp/youmail_proxy_attempt_{attempt + 1}.png'
                with open(screenshot_path, 'wb') as f:
                    f.write(screenshot)
                print(f"Screenshot: {screenshot_path}")

                # Analyze with AI
                print("Analyzing with AI...")
                analysis = await analyze_with_ai(screenshot, 1280, 800)
                print(f"AI Analysis: {analysis}")

                html = await page.content()
                page_type = analysis.get('page_type', 'unknown')

                if page_type == 'blocked':
                    print("⛔ IP blocked - trying another proxy")
                    rotator.mark_blocked(proxy_url)

                elif page_type == 'challenge':
                    print("🔐 Challenge detected!")
                    if analysis.get('has_clickable_element') and analysis.get('click_x'):
                        x, y = analysis['click_x'], analysis['click_y']
                        print(f"   Clicking at ({x}, {y})...")
                        await page.mouse.click(x, y)
                        await asyncio.sleep(3)

                        # Check result
                        screenshot2 = await page.screenshot(type='png')
                        with open(f'/tmp/youmail_after_click_{attempt + 1}.png', 'wb') as f:
                            f.write(screenshot2)

                        html = await page.content()
                        if 'blocked' not in html.lower() and len(html) > 5000:
                            print("✅ Challenge possibly solved!")
                            rotator.mark_success(proxy_url)
                            with open('/tmp/youmail_success.html', 'w') as f:
                                f.write(html)
                            print(f"HTML saved: /tmp/youmail_success.html ({len(html)} bytes)")
                            await browser.close()
                            return True

                elif page_type == 'normal' or len(html) > 10000:
                    print("✅ Success! Got content")
                    rotator.mark_success(proxy_url)

                    # Extract title
                    import re
                    title = re.search(r'<title>(.*?)</title>', html, re.IGNORECASE | re.DOTALL)
                    if title:
                        print(f"Title: {title.group(1)[:80]}")

                    with open('/tmp/youmail_success.html', 'w') as f:
                        f.write(html)
                    print(f"HTML saved: /tmp/youmail_success.html ({len(html)} bytes)")
                    await browser.close()
                    return True

                await browser.close()

            except Exception as e:
                print(f"Error: {e}")
                rotator.mark_blocked(proxy_url)

            await asyncio.sleep(1)

    print("\n❌ All attempts failed")
    return False


if __name__ == "__main__":
    success = asyncio.run(test_youmail_with_proxies())
    sys.exit(0 if success else 1)
