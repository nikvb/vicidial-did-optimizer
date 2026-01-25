#!/usr/bin/env python3
"""
AI-Enhanced Web Crawler with Proxy Support and Cloudflare Bypass

Extended version that supports:
- Residential/rotating proxy integration
- Better fingerprint randomization
- Session persistence
- Multiple retry strategies

Usage:
    from ai_crawler_proxy import ProxyCrawler

    # With proxy
    async with ProxyCrawler(proxy="http://user:pass@proxy.com:8080") as crawler:
        result = await crawler.fetch("https://example.com")

    # With proxy rotation (list of proxies)
    async with ProxyCrawler(proxies=["http://proxy1.com", "http://proxy2.com"]) as crawler:
        result = await crawler.fetch("https://example.com")
"""

import asyncio
import random
import json
from typing import Optional, Dict, Any, List
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from playwright.async_api import async_playwright, Page, Browser, BrowserContext
import httpx

# Import our captcha solver
import sys
sys.path.insert(0, str(Path(__file__).parent))
from captcha_solver import CaptchaSolver, CloudflareBypasser


@dataclass
class CrawlResult:
    """Result of a crawl operation"""
    url: str
    html: str
    success: bool
    status_code: Optional[int] = None
    challenge_solved: bool = False
    blocked: bool = False
    proxy_used: Optional[str] = None
    attempts: int = 0
    error: Optional[str] = None
    cookies: Dict[str, str] = field(default_factory=dict)
    timestamp: datetime = field(default_factory=datetime.now)


class BrowserFingerprint:
    """
    Generate realistic browser fingerprints.

    Each fingerprint includes consistent viewport, user agent,
    WebGL info, and other identifying characteristics.
    """

    FINGERPRINTS = [
        {
            "viewport": {"width": 1920, "height": 1080},
            "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "platform": "Win32",
            "vendor": "Google Inc.",
            "webgl_vendor": "Google Inc. (NVIDIA)",
            "webgl_renderer": "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)",
            "timezone": "America/New_York",
            "locale": "en-US",
            "color_depth": 24,
            "device_memory": 8,
            "hardware_concurrency": 8,
        },
        {
            "viewport": {"width": 1536, "height": 864},
            "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
            "platform": "Win32",
            "vendor": "Google Inc.",
            "webgl_vendor": "Google Inc. (Intel)",
            "webgl_renderer": "ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)",
            "timezone": "America/Los_Angeles",
            "locale": "en-US",
            "color_depth": 24,
            "device_memory": 16,
            "hardware_concurrency": 12,
        },
        {
            "viewport": {"width": 1440, "height": 900},
            "user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "platform": "MacIntel",
            "vendor": "Google Inc.",
            "webgl_vendor": "Google Inc. (Apple)",
            "webgl_renderer": "ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)",
            "timezone": "America/Chicago",
            "locale": "en-US",
            "color_depth": 30,
            "device_memory": 8,
            "hardware_concurrency": 10,
        },
        {
            "viewport": {"width": 2560, "height": 1440},
            "user_agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "platform": "Linux x86_64",
            "vendor": "Google Inc.",
            "webgl_vendor": "Google Inc. (AMD)",
            "webgl_renderer": "ANGLE (AMD, AMD Radeon RX 6800 XT, OpenGL 4.6)",
            "timezone": "Europe/London",
            "locale": "en-GB",
            "color_depth": 24,
            "device_memory": 32,
            "hardware_concurrency": 16,
        },
    ]

    @classmethod
    def get_random(cls) -> Dict[str, Any]:
        """Get a random but consistent fingerprint"""
        return random.choice(cls.FINGERPRINTS).copy()

    @classmethod
    def get_stealth_script(cls, fp: Dict[str, Any]) -> str:
        """Generate stealth JavaScript for the fingerprint"""
        return f"""
            // Override webdriver
            Object.defineProperty(navigator, 'webdriver', {{
                get: () => undefined
            }});

            // Override platform
            Object.defineProperty(navigator, 'platform', {{
                get: () => '{fp["platform"]}'
            }});

            // Override vendor
            Object.defineProperty(navigator, 'vendor', {{
                get: () => '{fp["vendor"]}'
            }});

            // Override plugins
            Object.defineProperty(navigator, 'plugins', {{
                get: () => [
                    {{name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer'}},
                    {{name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai'}},
                    {{name: 'Native Client', filename: 'internal-nacl-plugin'}}
                ]
            }});

            // Override languages
            Object.defineProperty(navigator, 'languages', {{
                get: () => ['{fp["locale"]}', '{fp["locale"].split("-")[0]}']
            }});

            // Override deviceMemory
            Object.defineProperty(navigator, 'deviceMemory', {{
                get: () => {fp["device_memory"]}
            }});

            // Override hardwareConcurrency
            Object.defineProperty(navigator, 'hardwareConcurrency', {{
                get: () => {fp["hardware_concurrency"]}
            }});

            // Override colorDepth
            Object.defineProperty(screen, 'colorDepth', {{
                get: () => {fp["color_depth"]}
            }});

            // Override WebGL
            const getParameter = WebGLRenderingContext.prototype.getParameter;
            WebGLRenderingContext.prototype.getParameter = function(parameter) {{
                if (parameter === 37445) {{ // UNMASKED_VENDOR_WEBGL
                    return '{fp["webgl_vendor"]}';
                }}
                if (parameter === 37446) {{ // UNMASKED_RENDERER_WEBGL
                    return '{fp["webgl_renderer"]}';
                }}
                return getParameter.call(this, parameter);
            }};

            // Chrome runtime
            window.chrome = {{
                runtime: {{}},
                loadTimes: function() {{}},
                csi: function() {{}},
                app: {{}}
            }};

            // Permissions
            const originalQuery = window.navigator.permissions.query;
            window.navigator.permissions.query = (parameters) => (
                parameters.name === 'notifications' ?
                    Promise.resolve({{ state: Notification.permission }}) :
                    originalQuery(parameters)
            );

            // Remove automation indicators
            delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
            delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
            delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
        """


class ProxyCrawler:
    """
    Enhanced crawler with proxy support and advanced fingerprinting.

    Features:
    - Rotating proxy support
    - Consistent fingerprinting per session
    - Cookie persistence
    - Cloudflare bypass with AI
    """

    def __init__(
        self,
        proxy: Optional[str] = None,
        proxies: Optional[List[str]] = None,
        model_url: str = "http://199.68.217.31:47101/v1",
        model_name: str = "captcha-solver",
        headless: bool = True,
        max_challenge_attempts: int = 15,
        page_timeout: int = 60000,
        rotate_fingerprint: bool = False,
    ):
        self.proxy = proxy
        self.proxies = proxies or []
        if proxy and proxy not in self.proxies:
            self.proxies.append(proxy)

        self.model_url = model_url
        self.model_name = model_name
        self.headless = headless
        self.max_challenge_attempts = max_challenge_attempts
        self.page_timeout = page_timeout
        self.rotate_fingerprint = rotate_fingerprint

        self.solver: Optional[CaptchaSolver] = None
        self.bypasser: Optional[CloudflareBypasser] = None
        self.playwright = None
        self.browser: Optional[Browser] = None

        # Session persistence
        self.fingerprint = BrowserFingerprint.get_random()
        self.proxy_index = 0
        self.cookies: Dict[str, Dict] = {}

    async def __aenter__(self):
        await self.start()
        return self

    async def __aexit__(self, *args):
        await self.close()

    def _get_next_proxy(self) -> Optional[str]:
        """Get next proxy in rotation"""
        if not self.proxies:
            return None
        proxy = self.proxies[self.proxy_index % len(self.proxies)]
        self.proxy_index += 1
        return proxy

    async def start(self):
        """Initialize the crawler"""
        self.solver = CaptchaSolver(
            model_url=self.model_url,
            model_name=self.model_name
        )
        self.bypasser = CloudflareBypasser(
            solver=self.solver,
            max_attempts=self.max_challenge_attempts
        )

        self.playwright = await async_playwright().start()

        # Browser args
        args = [
            "--disable-blink-features=AutomationControlled",
            "--disable-dev-shm-usage",
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-infobars",
            "--disable-background-networking",
            "--disable-breakpad",
            "--disable-component-update",
            "--disable-domain-reliability",
            "--disable-features=AudioServiceOutOfProcess,IsolateOrigins,site-per-process",
            "--disable-hang-monitor",
            "--disable-ipc-flooding-protection",
            "--disable-popup-blocking",
            "--disable-prompt-on-repost",
            "--disable-renderer-backgrounding",
            "--disable-sync",
            "--enable-features=NetworkService,NetworkServiceInProcess",
            "--force-color-profile=srgb",
            "--metrics-recording-only",
            "--no-first-run",
            "--password-store=basic",
            "--use-mock-keychain",
        ]

        self.browser = await self.playwright.chromium.launch(
            headless=self.headless,
            args=args
        )

    async def close(self):
        """Clean up resources"""
        if self.browser:
            await self.browser.close()
        if self.playwright:
            await self.playwright.stop()
        if self.solver:
            await self.solver.close()

    async def _create_context(self, proxy: Optional[str] = None) -> BrowserContext:
        """Create a browser context with fingerprinting"""
        if self.rotate_fingerprint:
            self.fingerprint = BrowserFingerprint.get_random()

        fp = self.fingerprint

        proxy_settings = None
        if proxy:
            # Parse proxy URL
            if "@" in proxy:
                # Has auth: http://user:pass@host:port
                from urllib.parse import urlparse
                parsed = urlparse(proxy)
                proxy_settings = {
                    "server": f"{parsed.scheme}://{parsed.hostname}:{parsed.port}",
                    "username": parsed.username,
                    "password": parsed.password
                }
            else:
                proxy_settings = {"server": proxy}

        context = await self.browser.new_context(
            viewport=fp["viewport"],
            user_agent=fp["user_agent"],
            locale=fp["locale"],
            timezone_id=fp["timezone"],
            proxy=proxy_settings,
            extra_http_headers={
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
                "Accept-Language": f"{fp['locale']},{fp['locale'].split('-')[0]};q=0.9",
                "Accept-Encoding": "gzip, deflate, br",
                "DNT": "1",
                "Upgrade-Insecure-Requests": "1",
                "Sec-Ch-Ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
                "Sec-Ch-Ua-Mobile": "?0",
                "Sec-Ch-Ua-Platform": '"Windows"' if "Windows" in fp["user_agent"] else '"macOS"' if "Mac" in fp["user_agent"] else '"Linux"',
                "Sec-Fetch-Dest": "document",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Site": "none",
                "Sec-Fetch-User": "?1",
            }
        )

        # Add stealth scripts
        await context.add_init_script(BrowserFingerprint.get_stealth_script(fp))

        return context

    def _is_blocked(self, html: str) -> bool:
        """Check if page shows a hard block"""
        indicators = [
            "you have been blocked",
            "access denied",
            "403 forbidden",
            "your ip has been blocked",
            "banned",
            "ip address has been blocked",
        ]
        html_lower = html.lower()
        return any(ind in html_lower for ind in indicators)

    def _is_challenge(self, html: str) -> bool:
        """Check if page shows a solvable challenge"""
        indicators = [
            "cf-browser-verification",
            "cf_chl_opt",
            "challenge-platform",
            "cf-turnstile",
            "checking your browser",
            "just a moment",
            "verify you are human",
            "challenge-running",
        ]
        html_lower = html.lower()
        return any(ind in html_lower for ind in indicators)

    async def fetch(
        self,
        url: str,
        use_proxy: bool = True,
        retry_on_block: bool = True,
        max_retries: int = 3,
        wait_for: Optional[str] = None,
    ) -> CrawlResult:
        """
        Fetch a URL with proxy and challenge handling.

        Args:
            url: Target URL
            use_proxy: Whether to use proxy
            retry_on_block: Retry with different proxy if blocked
            max_retries: Max retries on block
            wait_for: Selector to wait for after load

        Returns:
            CrawlResult
        """
        result = CrawlResult(url=url, html="", success=False)

        for attempt in range(max_retries):
            proxy = self._get_next_proxy() if use_proxy else None
            result.proxy_used = proxy
            result.attempts = attempt + 1

            context = await self._create_context(proxy)
            page = await context.new_page()
            page.set_default_timeout(self.page_timeout)

            try:
                response = await page.goto(url, wait_until="domcontentloaded")
                result.status_code = response.status if response else None

                # Wait for any dynamic content
                await asyncio.sleep(2)

                html = await page.content()

                # Check for hard block
                if self._is_blocked(html):
                    result.blocked = True
                    print(f"Attempt {attempt + 1}: Hard blocked" +
                          (f" with proxy {proxy}" if proxy else ""))
                    if retry_on_block and attempt < max_retries - 1:
                        await page.close()
                        await context.close()
                        continue
                    else:
                        result.html = html
                        result.error = "IP blocked by Cloudflare"
                        break

                # Check for solvable challenge
                if self._is_challenge(html):
                    print(f"Challenge detected, attempting to solve...")
                    success = await self.bypasser.solve_challenge(page)
                    result.challenge_solved = success

                    if not success:
                        result.error = "Failed to solve challenge"
                        if retry_on_block and attempt < max_retries - 1:
                            await page.close()
                            await context.close()
                            continue

                # Wait for additional selector if specified
                if wait_for:
                    try:
                        await page.wait_for_selector(wait_for, timeout=10000)
                    except:
                        pass

                # Get final content
                result.html = await page.content()
                result.success = True

                # Save cookies
                cookies = await context.cookies()
                for cookie in cookies:
                    self.cookies[cookie["name"]] = cookie

                break

            except Exception as e:
                result.error = str(e)
                print(f"Attempt {attempt + 1} error: {e}")

            finally:
                await page.close()
                await context.close()

        return result


async def test_with_proxy():
    """Test crawler with proxy"""
    # Example with free proxy (replace with your proxies)
    proxies = [
        # Add your residential proxies here
        # "http://user:pass@proxy1.example.com:8080",
        # "http://user:pass@proxy2.example.com:8080",
    ]

    if proxies:
        async with ProxyCrawler(proxies=proxies, headless=True) as crawler:
            result = await crawler.fetch(
                "https://directory.youmail.com/phone/305-988-6649"
            )
            print(f"Success: {result.success}")
            print(f"Blocked: {result.blocked}")
            print(f"HTML Length: {len(result.html)}")
    else:
        print("No proxies configured. Add residential proxies to test.")
        print("\nTesting without proxy (will likely be blocked):")
        async with ProxyCrawler(headless=True) as crawler:
            result = await crawler.fetch(
                "https://directory.youmail.com/phone/305-988-6649",
                use_proxy=False
            )
            print(f"Success: {result.success}")
            print(f"Blocked: {result.blocked}")


if __name__ == "__main__":
    asyncio.run(test_with_proxy())
