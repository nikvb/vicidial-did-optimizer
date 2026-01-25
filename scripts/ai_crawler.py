"""
AI-Enhanced Web Crawler with Cloudflare Bypass

Complete integration of crawl4ai with visual AI model for automatic
captcha/challenge solving.

Usage:
    from ai_crawler import AICrawler

    async with AICrawler() as crawler:
        result = await crawler.fetch("https://example.com")
        print(result.html)
"""

import asyncio
import random
from typing import Optional, Dict, Any, List
from dataclasses import dataclass, field
from datetime import datetime

try:
    from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig
    from crawl4ai.extraction_strategy import JsonCssExtractionStrategy
    CRAWL4AI_AVAILABLE = True
except ImportError:
    CRAWL4AI_AVAILABLE = False
    print("Warning: crawl4ai not installed. Install with: pip install crawl4ai")

from playwright.async_api import async_playwright, Page, Browser
from captcha_solver import CaptchaSolver, CloudflareBypasser, ChallengeAction


@dataclass
class CrawlResult:
    """Result of a crawl operation"""
    url: str
    html: str
    success: bool
    status_code: Optional[int] = None
    challenge_solved: bool = False
    attempts: int = 0
    error: Optional[str] = None
    screenshots: List[bytes] = field(default_factory=list)
    timestamp: datetime = field(default_factory=datetime.now)


class StealthBrowser:
    """
    Stealth browser configuration to minimize detection.

    Implements various anti-detection techniques including:
    - Realistic viewport sizes
    - Human-like user agents
    - WebGL/Canvas fingerprint masking
    - Timezone spoofing
    """

    # Realistic viewport sizes (common resolutions)
    VIEWPORTS = [
        {"width": 1920, "height": 1080},
        {"width": 1366, "height": 768},
        {"width": 1536, "height": 864},
        {"width": 1440, "height": 900},
        {"width": 1280, "height": 720},
    ]

    # Recent Chrome user agents
    USER_AGENTS = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    ]

    @classmethod
    def get_random_config(cls) -> Dict[str, Any]:
        """Get randomized browser configuration"""
        viewport = random.choice(cls.VIEWPORTS)
        user_agent = random.choice(cls.USER_AGENTS)

        return {
            "viewport": viewport,
            "user_agent": user_agent,
            "locale": "en-US",
            "timezone_id": "America/New_York",
        }

    @classmethod
    def get_stealth_args(cls) -> List[str]:
        """Get Chrome arguments for stealth mode"""
        return [
            "--disable-blink-features=AutomationControlled",
            "--disable-dev-shm-usage",
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
            "--no-sandbox",
            "--disable-setuid-sandbox",
        ]


class AICrawler:
    """
    AI-enhanced web crawler with automatic Cloudflare bypass.

    Combines stealth browsing techniques with visual AI analysis
    to automatically solve captchas and challenges.
    """

    def __init__(
        self,
        model_url: str = "http://199.68.217.31:47101/v1",
        model_name: str = "captcha-solver",
        headless: bool = True,
        max_challenge_attempts: int = 10,
        page_timeout: int = 30000,
        save_screenshots: bool = False
    ):
        self.model_url = model_url
        self.model_name = model_name
        self.headless = headless
        self.max_challenge_attempts = max_challenge_attempts
        self.page_timeout = page_timeout
        self.save_screenshots = save_screenshots

        self.solver: Optional[CaptchaSolver] = None
        self.bypasser: Optional[CloudflareBypasser] = None
        self.playwright = None
        self.browser: Optional[Browser] = None

    async def __aenter__(self):
        await self.start()
        return self

    async def __aexit__(self, *args):
        await self.close()

    async def start(self):
        """Initialize the crawler components"""
        self.solver = CaptchaSolver(
            model_url=self.model_url,
            model_name=self.model_name
        )
        self.bypasser = CloudflareBypasser(
            solver=self.solver,
            max_attempts=self.max_challenge_attempts
        )

        # Start Playwright
        self.playwright = await async_playwright().start()

        # Launch browser with stealth configuration
        self.browser = await self.playwright.chromium.launch(
            headless=self.headless,
            args=StealthBrowser.get_stealth_args()
        )

    async def close(self):
        """Clean up resources"""
        if self.browser:
            await self.browser.close()
        if self.playwright:
            await self.playwright.stop()
        if self.solver:
            await self.solver.close()

    async def _create_stealth_context(self):
        """Create a new browser context with stealth settings"""
        config = StealthBrowser.get_random_config()

        context = await self.browser.new_context(
            viewport=config["viewport"],
            user_agent=config["user_agent"],
            locale=config["locale"],
            timezone_id=config["timezone_id"],
            # Permissions
            permissions=["geolocation"],
            # Extra headers to appear more legitimate
            extra_http_headers={
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
                "Accept-Encoding": "gzip, deflate, br",
                "DNT": "1",
                "Upgrade-Insecure-Requests": "1",
                "Sec-Fetch-Dest": "document",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Site": "none",
                "Sec-Fetch-User": "?1",
            }
        )

        # Inject stealth scripts
        await context.add_init_script("""
            // Override the navigator.webdriver property
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined
            });

            // Override chrome runtime
            window.chrome = {
                runtime: {}
            };

            // Override permissions
            const originalQuery = window.navigator.permissions.query;
            window.navigator.permissions.query = (parameters) => (
                parameters.name === 'notifications' ?
                    Promise.resolve({ state: Notification.permission }) :
                    originalQuery(parameters)
            );

            // Override plugins
            Object.defineProperty(navigator, 'plugins', {
                get: () => [1, 2, 3, 4, 5]
            });

            // Override languages
            Object.defineProperty(navigator, 'languages', {
                get: () => ['en-US', 'en']
            });

            // Mask WebGL vendor/renderer
            const getParameter = WebGLRenderingContext.prototype.getParameter;
            WebGLRenderingContext.prototype.getParameter = function(parameter) {
                if (parameter === 37445) {
                    return 'Intel Inc.';
                }
                if (parameter === 37446) {
                    return 'Intel Iris OpenGL Engine';
                }
                return getParameter.apply(this, arguments);
            };
        """)

        return context

    async def fetch(
        self,
        url: str,
        wait_for: Optional[str] = None,
        wait_timeout: int = 10000
    ) -> CrawlResult:
        """
        Fetch a URL with automatic Cloudflare bypass.

        Args:
            url: URL to fetch
            wait_for: Optional selector to wait for after page load
            wait_timeout: Timeout for wait_for selector

        Returns:
            CrawlResult with HTML and metadata
        """
        context = await self._create_stealth_context()
        page = await context.new_page()

        result = CrawlResult(url=url, html="", success=False)

        try:
            # Set page timeout
            page.set_default_timeout(self.page_timeout)

            # Navigate to URL
            response = await page.goto(url, wait_until="domcontentloaded")
            result.status_code = response.status if response else None

            # Check for Cloudflare challenge
            html = await page.content()

            if self.bypasser.is_cloudflare_challenge(html):
                print(f"Cloudflare challenge detected on {url}")

                # Take initial screenshot
                if self.save_screenshots:
                    result.screenshots.append(await page.screenshot(type='png'))

                # Attempt to solve
                success = await self.bypasser.solve_challenge(page)
                result.challenge_solved = success
                result.attempts = len(self.bypasser.solver._actions if hasattr(self.bypasser.solver, '_actions') else [])

                if not success:
                    result.error = "Failed to solve Cloudflare challenge"
                    return result

            # Wait for additional content if specified
            if wait_for:
                try:
                    await page.wait_for_selector(wait_for, timeout=wait_timeout)
                except Exception as e:
                    print(f"Warning: wait_for selector not found: {e}")

            # Add small delay for dynamic content
            await asyncio.sleep(0.5)

            # Get final HTML
            result.html = await page.content()
            result.success = True

            # Final screenshot
            if self.save_screenshots:
                result.screenshots.append(await page.screenshot(type='png'))

        except Exception as e:
            result.error = str(e)
            print(f"Error fetching {url}: {e}")

        finally:
            await page.close()
            await context.close()

        return result

    async def fetch_multiple(
        self,
        urls: List[str],
        concurrency: int = 3,
        delay_between: float = 1.0
    ) -> List[CrawlResult]:
        """
        Fetch multiple URLs with rate limiting.

        Args:
            urls: List of URLs to fetch
            concurrency: Max concurrent requests
            delay_between: Delay between requests in seconds

        Returns:
            List of CrawlResults
        """
        semaphore = asyncio.Semaphore(concurrency)
        results = []

        async def fetch_with_limit(url: str, index: int) -> CrawlResult:
            async with semaphore:
                if index > 0:
                    await asyncio.sleep(delay_between)
                return await self.fetch(url)

        tasks = [
            fetch_with_limit(url, i)
            for i, url in enumerate(urls)
        ]

        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Convert exceptions to CrawlResults
        final_results = []
        for url, result in zip(urls, results):
            if isinstance(result, Exception):
                final_results.append(CrawlResult(
                    url=url,
                    html="",
                    success=False,
                    error=str(result)
                ))
            else:
                final_results.append(result)

        return final_results


# Crawl4AI integration (if available)
if CRAWL4AI_AVAILABLE:
    class AICrawl4AIWrapper:
        """
        Wrapper to integrate AI captcha solving with crawl4ai.

        This provides a drop-in replacement for AsyncWebCrawler
        with automatic Cloudflare bypass.
        """

        def __init__(
            self,
            model_url: str = "http://199.68.217.31:47101/v1",
            model_name: str = "captcha-solver",
            **crawler_kwargs
        ):
            self.model_url = model_url
            self.model_name = model_name
            self.crawler_kwargs = crawler_kwargs

            self.solver: Optional[CaptchaSolver] = None
            self.bypasser: Optional[CloudflareBypasser] = None
            self.crawler: Optional[AsyncWebCrawler] = None

        async def __aenter__(self):
            await self.start()
            return self

        async def __aexit__(self, *args):
            await self.close()

        async def start(self):
            """Initialize components"""
            self.solver = CaptchaSolver(
                model_url=self.model_url,
                model_name=self.model_name
            )
            self.bypasser = CloudflareBypasser(solver=self.solver)

            # Configure browser with stealth settings
            browser_config = BrowserConfig(
                headless=True,
                browser_type="chromium",
                extra_args=StealthBrowser.get_stealth_args(),
                user_agent=random.choice(StealthBrowser.USER_AGENTS),
                viewport_width=1920,
                viewport_height=1080,
            )

            self.crawler = AsyncWebCrawler(config=browser_config)
            await self.crawler.start()

        async def close(self):
            """Clean up"""
            if self.crawler:
                await self.crawler.close()
            if self.solver:
                await self.solver.close()

        async def arun(self, url: str, **kwargs) -> Any:
            """
            Run crawler with automatic challenge handling.

            Wraps crawl4ai's arun method with Cloudflare bypass.
            """
            # First attempt with crawl4ai
            result = await self.crawler.arun(url=url, **kwargs)

            # Check if we hit a Cloudflare challenge
            if result.html and self.bypasser.is_cloudflare_challenge(result.html):
                print(f"Cloudflare challenge detected, switching to AI solver...")

                # Use direct Playwright approach for challenge solving
                page = self.crawler.crawler_strategy.page

                if page:
                    success = await self.bypasser.solve_challenge(page)
                    if success:
                        # Get updated content
                        result.html = await page.content()

            return result


async def example_usage():
    """Example of using the AI crawler"""

    # Method 1: Direct AICrawler
    print("=== Using AICrawler ===")
    async with AICrawler(headless=True) as crawler:
        result = await crawler.fetch("https://nowsecure.nl")
        print(f"Success: {result.success}")
        print(f"Challenge solved: {result.challenge_solved}")
        print(f"HTML length: {len(result.html)}")

    # Method 2: With crawl4ai (if available)
    if CRAWL4AI_AVAILABLE:
        print("\n=== Using AICrawl4AIWrapper ===")
        async with AICrawl4AIWrapper() as crawler:
            result = await crawler.arun("https://nowsecure.nl")
            print(f"HTML length: {len(result.html) if result.html else 0}")


if __name__ == "__main__":
    asyncio.run(example_usage())
