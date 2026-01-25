"""
AI-Powered Cloudflare Captcha Solver for Crawl4AI

This module integrates with a visual AI model (Qwen2-VL) to automatically
detect and solve Cloudflare challenges during web scraping.

Usage:
    from captcha_solver import CaptchaSolver, create_ai_browser_config

    solver = CaptchaSolver()
    config = create_ai_browser_config(solver)

    async with AsyncWebCrawler(config=config) as crawler:
        result = await crawler.arun(url="https://example.com")
"""

import asyncio
import base64
import json
import re
import httpx
from typing import Optional, Dict, Any, Tuple
from dataclasses import dataclass
from enum import Enum


class ChallengeType(Enum):
    """Types of Cloudflare challenges"""
    TURNSTILE = "turnstile"           # Interactive checkbox
    MANAGED = "managed"               # "Checking your browser" page
    INTERACTIVE = "interactive"       # Click-based challenge
    CAPTCHA = "captcha"               # Image-based captcha
    NONE = "none"                     # No challenge detected


@dataclass
class ChallengeAction:
    """Action to perform to solve a challenge"""
    action_type: str  # "click", "wait", "scroll", "type", "solved", "failed"
    x: Optional[int] = None
    y: Optional[int] = None
    wait_ms: Optional[int] = None
    text: Optional[str] = None
    selector: Optional[str] = None
    confidence: float = 0.0
    reasoning: str = ""


class CaptchaSolver:
    """
    AI-powered captcha solver using Qwen2-VL vision model.

    Analyzes screenshots of Cloudflare challenge pages and provides
    step-by-step instructions to solve them.
    """

    def __init__(
        self,
        model_url: str = "http://199.68.217.31:47101/v1",
        model_name: str = "captcha-solver",
        timeout: float = 30.0,
        max_retries: int = 3
    ):
        self.model_url = model_url.rstrip('/')
        self.model_name = model_name
        self.timeout = timeout
        self.max_retries = max_retries
        self.client = httpx.AsyncClient(timeout=timeout)

    async def close(self):
        """Close the HTTP client"""
        await self.client.aclose()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        await self.close()

    def _encode_image(self, image_data: bytes) -> str:
        """Encode image bytes to base64 string"""
        return base64.b64encode(image_data).decode('utf-8')

    def _build_analysis_prompt(self) -> str:
        """Build the prompt for analyzing a webpage screenshot"""
        return """Analyze this webpage screenshot to detect if there's a Cloudflare challenge or captcha.

IMPORTANT: Respond ONLY with valid JSON, no other text.

If you see a Cloudflare challenge page (like "Checking your browser", "Verify you are human", turnstile checkbox, or any captcha), respond with:
{
    "challenge_detected": true,
    "challenge_type": "turnstile|managed|interactive|captcha",
    "description": "Brief description of what you see",
    "action": {
        "type": "click|wait|scroll|type",
        "x": <x_coordinate_if_click>,
        "y": <y_coordinate_if_click>,
        "wait_ms": <milliseconds_if_wait>,
        "selector_hint": "description of element to interact with",
        "confidence": <0.0-1.0>
    },
    "reasoning": "Why this action will help solve the challenge"
}

If there's NO challenge and the page looks like normal content, respond with:
{
    "challenge_detected": false,
    "challenge_type": "none",
    "description": "Page appears to be normal content",
    "action": {
        "type": "solved",
        "confidence": 1.0
    },
    "reasoning": "No Cloudflare challenge elements detected"
}

Key visual indicators to look for:
1. Cloudflare logo or branding
2. "Checking your browser" or "Just a moment" text
3. Turnstile checkbox widget (usually has a checkbox and Cloudflare branding)
4. "Verify you are human" text
5. Loading spinner with ray ID
6. Interactive challenges asking to click specific images
7. CAPTCHA grids with images

For turnstile/checkbox challenges:
- Look for the checkbox widget, usually on left side of a verification box
- The checkbox is typically around 20x20 pixels
- Provide click coordinates for the CENTER of the checkbox

Be precise with coordinates - they should be relative to the full screenshot dimensions."""

    async def analyze_screenshot(
        self,
        screenshot_bytes: bytes,
        previous_actions: Optional[list] = None
    ) -> ChallengeAction:
        """
        Analyze a screenshot and return the recommended action.

        Args:
            screenshot_bytes: PNG screenshot of the page
            previous_actions: List of actions already attempted (for context)

        Returns:
            ChallengeAction with the recommended next step
        """
        base64_image = self._encode_image(screenshot_bytes)

        # Build context from previous actions
        context = ""
        if previous_actions:
            context = "\n\nPrevious actions attempted:\n"
            for i, action in enumerate(previous_actions, 1):
                context += f"{i}. {action.action_type}"
                if action.x and action.y:
                    context += f" at ({action.x}, {action.y})"
                context += f" - {action.reasoning}\n"
            context += "\nConsider what else might work based on these attempts."

        prompt = self._build_analysis_prompt() + context

        # Build the request for OpenAI-compatible API
        payload = {
            "model": self.model_name,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/png;base64,{base64_image}"
                            }
                        },
                        {
                            "type": "text",
                            "text": prompt
                        }
                    ]
                }
            ],
            "max_tokens": 1024,
            "temperature": 0.1  # Low temperature for consistent responses
        }

        for attempt in range(self.max_retries):
            try:
                response = await self.client.post(
                    f"{self.model_url}/chat/completions",
                    json=payload,
                    headers={"Content-Type": "application/json"}
                )
                response.raise_for_status()

                result = response.json()
                content = result["choices"][0]["message"]["content"]

                # Parse the JSON response
                return self._parse_model_response(content)

            except httpx.HTTPStatusError as e:
                print(f"HTTP error on attempt {attempt + 1}: {e}")
                if attempt == self.max_retries - 1:
                    raise
            except json.JSONDecodeError as e:
                print(f"JSON parse error on attempt {attempt + 1}: {e}")
                if attempt == self.max_retries - 1:
                    return ChallengeAction(
                        action_type="failed",
                        reasoning=f"Could not parse model response: {str(e)}"
                    )
            except Exception as e:
                print(f"Error on attempt {attempt + 1}: {e}")
                if attempt == self.max_retries - 1:
                    raise

            await asyncio.sleep(1)  # Brief delay between retries

        return ChallengeAction(action_type="failed", reasoning="Max retries exceeded")

    def _parse_model_response(self, content: str) -> ChallengeAction:
        """Parse the model's JSON response into a ChallengeAction"""
        try:
            # Try to extract JSON from the response
            # Sometimes models wrap JSON in markdown code blocks
            json_match = re.search(r'```json\s*(.*?)\s*```', content, re.DOTALL)
            if json_match:
                content = json_match.group(1)
            else:
                # Try to find JSON object directly
                json_match = re.search(r'\{.*\}', content, re.DOTALL)
                if json_match:
                    content = json_match.group(0)

            data = json.loads(content)

            action_data = data.get("action", {})
            action_type = action_data.get("type", "wait")

            # If no challenge detected, mark as solved
            if not data.get("challenge_detected", True):
                action_type = "solved"

            return ChallengeAction(
                action_type=action_type,
                x=action_data.get("x"),
                y=action_data.get("y"),
                wait_ms=action_data.get("wait_ms", 2000),
                selector=action_data.get("selector_hint"),
                confidence=action_data.get("confidence", 0.5),
                reasoning=data.get("reasoning", "")
            )

        except json.JSONDecodeError as e:
            print(f"Failed to parse JSON: {content[:200]}...")
            return ChallengeAction(
                action_type="wait",
                wait_ms=3000,
                confidence=0.3,
                reasoning=f"Could not parse response, waiting: {str(e)}"
            )


class CloudflareBypasser:
    """
    High-level class to handle Cloudflare bypass with Playwright/crawl4ai.

    Integrates the CaptchaSolver with browser automation to automatically
    detect and solve Cloudflare challenges.
    """

    def __init__(
        self,
        solver: Optional[CaptchaSolver] = None,
        max_attempts: int = 10,
        screenshot_delay_ms: int = 1000
    ):
        self.solver = solver or CaptchaSolver()
        self.max_attempts = max_attempts
        self.screenshot_delay_ms = screenshot_delay_ms
        self._owns_solver = solver is None

    async def close(self):
        if self._owns_solver:
            await self.solver.close()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        await self.close()

    async def solve_challenge(self, page) -> bool:
        """
        Attempt to solve any Cloudflare challenge on the current page.

        Args:
            page: Playwright page object

        Returns:
            True if challenge was solved (or no challenge), False if failed
        """
        actions_taken = []

        for attempt in range(self.max_attempts):
            # Wait a bit for page to settle
            await asyncio.sleep(self.screenshot_delay_ms / 1000)

            # Take screenshot
            screenshot = await page.screenshot(type='png', full_page=False)

            # Analyze with AI
            action = await self.solver.analyze_screenshot(screenshot, actions_taken)
            actions_taken.append(action)

            print(f"Attempt {attempt + 1}: {action.action_type} "
                  f"(confidence: {action.confidence:.2f}) - {action.reasoning}")

            if action.action_type == "solved":
                print("Challenge solved or no challenge detected!")
                return True

            elif action.action_type == "failed":
                print(f"Solver failed: {action.reasoning}")
                return False

            elif action.action_type == "click":
                if action.x is not None and action.y is not None:
                    print(f"Clicking at ({action.x}, {action.y})")
                    await page.mouse.click(action.x, action.y)
                    await asyncio.sleep(0.5)  # Brief delay after click

            elif action.action_type == "wait":
                wait_time = action.wait_ms or 2000
                print(f"Waiting {wait_time}ms")
                await asyncio.sleep(wait_time / 1000)

            elif action.action_type == "scroll":
                await page.evaluate("window.scrollBy(0, 100)")

            elif action.action_type == "type":
                if action.text:
                    await page.keyboard.type(action.text)

        print(f"Failed to solve challenge after {self.max_attempts} attempts")
        return False

    def is_cloudflare_challenge(self, html: str) -> bool:
        """
        Quick check if HTML contains Cloudflare challenge indicators.

        Args:
            html: Page HTML content

        Returns:
            True if Cloudflare challenge indicators found
        """
        indicators = [
            'cf-browser-verification',
            'cf_chl_opt',
            'challenge-platform',
            'cf-turnstile',
            'Checking your browser',
            'Just a moment',
            'Verify you are human',
            'challenge-running',
            'ray ID',
            '_cf_chl_tk'
        ]

        html_lower = html.lower()
        return any(indicator.lower() in html_lower for indicator in indicators)


# Crawl4AI Integration
def create_crawl4ai_hooks(bypasser: CloudflareBypasser) -> Dict[str, Any]:
    """
    Create hooks for crawl4ai to automatically handle Cloudflare challenges.

    Usage with crawl4ai:
        solver = CaptchaSolver()
        bypasser = CloudflareBypasser(solver)

        async with AsyncWebCrawler() as crawler:
            crawler.crawler_strategy.set_hook('on_page_load',
                create_crawl4ai_hooks(bypasser)['on_page_load'])
            result = await crawler.arun(url="https://example.com")
    """

    async def on_page_load(page, context):
        """Hook called after page loads"""
        # Check if this looks like a Cloudflare challenge
        html = await page.content()

        if bypasser.is_cloudflare_challenge(html):
            print("Cloudflare challenge detected, attempting to solve...")
            success = await bypasser.solve_challenge(page)
            if not success:
                print("Warning: Could not solve Cloudflare challenge")
            return success
        return True

    return {
        'on_page_load': on_page_load
    }


# Standalone usage example
async def main():
    """Example usage of the captcha solver"""
    from playwright.async_api import async_playwright

    async with CaptchaSolver() as solver:
        bypasser = CloudflareBypasser(solver)

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page()

            # Navigate to a site that might have Cloudflare
            await page.goto("https://example.com")

            # Attempt to solve any challenges
            success = await bypasser.solve_challenge(page)

            if success:
                print("Page ready!")
                content = await page.content()
                print(f"Content length: {len(content)}")
            else:
                print("Failed to bypass Cloudflare")

            await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
