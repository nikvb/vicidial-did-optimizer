#!/usr/bin/env python3
"""
Test script for AI-powered Cloudflare captcha solver.

Tests the integration with the Qwen2-VL vision model.
"""

import asyncio
import sys
import base64
import httpx
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent))

from captcha_solver import CaptchaSolver, CloudflareBypasser
from ai_crawler import AICrawler


async def test_model_connection():
    """Test connection to the visual AI model"""
    print("=" * 60)
    print("Test 1: Model Connection")
    print("=" * 60)

    model_url = "http://199.68.217.31:47101/v1"

    async with httpx.AsyncClient(timeout=30) as client:
        try:
            response = await client.get(f"{model_url}/models")
            response.raise_for_status()
            models = response.json()

            print(f"Connected successfully!")
            print(f"Available models:")
            for model in models.get("data", []):
                print(f"  - {model['id']} (root: {model.get('root', 'N/A')})")

            return True
        except Exception as e:
            print(f"Failed to connect: {e}")
            return False


async def test_image_analysis():
    """Test analyzing a sample screenshot"""
    print("\n" + "=" * 60)
    print("Test 2: Image Analysis (Simple Test Image)")
    print("=" * 60)

    # Create a simple test by taking a screenshot of a known page
    from playwright.async_api import async_playwright

    async with CaptchaSolver() as solver:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page()

            # Test with a simple page first
            print("Taking screenshot of httpbin.org...")
            await page.goto("https://httpbin.org/html")
            await asyncio.sleep(1)

            screenshot = await page.screenshot(type='png')
            print(f"Screenshot size: {len(screenshot)} bytes")

            # Analyze with AI
            print("Sending to AI model for analysis...")
            action = await solver.analyze_screenshot(screenshot)

            print(f"\nAI Response:")
            print(f"  Action: {action.action_type}")
            print(f"  Confidence: {action.confidence:.2f}")
            print(f"  Reasoning: {action.reasoning}")

            await browser.close()

            return action.action_type == "solved"


async def test_cloudflare_detection():
    """Test detection of Cloudflare challenge pages"""
    print("\n" + "=" * 60)
    print("Test 3: Cloudflare Challenge Detection")
    print("=" * 60)

    # Sample HTML patterns
    test_cases = [
        {
            "name": "Normal page",
            "html": "<html><body><h1>Hello World</h1></body></html>",
            "expected": False
        },
        {
            "name": "Cloudflare managed challenge",
            "html": """
                <html>
                <head><title>Just a moment...</title></head>
                <body>
                <div id="cf-browser-verification">Checking your browser...</div>
                <div class="ray-id">Ray ID: abc123</div>
                </body>
                </html>
            """,
            "expected": True
        },
        {
            "name": "Cloudflare turnstile",
            "html": """
                <html>
                <body>
                <div class="cf-turnstile" data-sitekey="xxx"></div>
                <script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>
                </body>
                </html>
            """,
            "expected": True
        },
        {
            "name": "Verify human",
            "html": """
                <html>
                <body>
                <h1>Verify you are human</h1>
                <div class="challenge-platform"></div>
                </body>
                </html>
            """,
            "expected": True
        }
    ]

    bypasser = CloudflareBypasser()
    all_passed = True

    for case in test_cases:
        detected = bypasser.is_cloudflare_challenge(case["html"])
        passed = detected == case["expected"]
        status = "PASS" if passed else "FAIL"
        print(f"  [{status}] {case['name']}: detected={detected}, expected={case['expected']}")
        if not passed:
            all_passed = False

    return all_passed


async def test_real_cloudflare_site():
    """Test against a real site that uses Cloudflare"""
    print("\n" + "=" * 60)
    print("Test 4: Real Cloudflare Site (nowsecure.nl)")
    print("=" * 60)

    # nowsecure.nl is a test site specifically for Cloudflare bypass testing
    async with AICrawler(headless=True, max_challenge_attempts=5) as crawler:
        print("Attempting to fetch nowsecure.nl...")
        result = await crawler.fetch("https://nowsecure.nl")

        print(f"\nResults:")
        print(f"  Success: {result.success}")
        print(f"  Status Code: {result.status_code}")
        print(f"  Challenge Solved: {result.challenge_solved}")
        print(f"  HTML Length: {len(result.html)}")
        if result.error:
            print(f"  Error: {result.error}")

        # Check if we got real content
        if result.success and "nowsecure" in result.html.lower():
            print("  Content: Contains expected 'nowsecure' text")
            return True
        else:
            print("  Content: Did not find expected content")
            return False


async def test_visual_model_direct():
    """Test the visual model with a base64 image directly"""
    print("\n" + "=" * 60)
    print("Test 5: Direct Visual Model API Test")
    print("=" * 60)

    # Create a simple test image (1x1 red pixel PNG)
    # In reality, you'd use a real screenshot
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(viewport={"width": 800, "height": 600})

        # Load a Cloudflare test page
        print("Loading a page to screenshot...")
        await page.set_content("""
            <html>
            <body style="background: #f0f0f0; display: flex; justify-content: center; align-items: center; height: 100vh;">
                <div style="background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <input type="checkbox" style="width: 20px; height: 20px;">
                        <span>Verify you are human</span>
                    </div>
                    <div style="margin-top: 20px; color: #666; font-size: 12px;">
                        Protected by Cloudflare
                    </div>
                </div>
            </body>
            </html>
        """)

        screenshot = await page.screenshot(type='png')
        await browser.close()

    # Send to visual model
    base64_image = base64.b64encode(screenshot).decode('utf-8')

    async with httpx.AsyncClient(timeout=60) as client:
        payload = {
            "model": "captcha-solver",
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
                            "text": "What do you see in this image? Is there a checkbox or button to click? If yes, what are the approximate x,y coordinates of its center?"
                        }
                    ]
                }
            ],
            "max_tokens": 512,
            "temperature": 0.1
        }

        try:
            print("Sending image to visual model...")
            response = await client.post(
                "http://199.68.217.31:47101/v1/chat/completions",
                json=payload
            )
            response.raise_for_status()

            result = response.json()
            content = result["choices"][0]["message"]["content"]

            print(f"\nModel Response:")
            print("-" * 40)
            print(content)
            print("-" * 40)

            return True

        except Exception as e:
            print(f"Error: {e}")
            return False


async def run_all_tests():
    """Run all tests"""
    print("\n" + "=" * 60)
    print("AI Captcha Solver Test Suite")
    print("=" * 60)

    results = {}

    # Test 1: Model connection
    results["model_connection"] = await test_model_connection()

    # Test 2: Image analysis
    results["image_analysis"] = await test_image_analysis()

    # Test 3: Cloudflare detection
    results["cloudflare_detection"] = await test_cloudflare_detection()

    # Test 4: Direct visual model test
    results["visual_model_direct"] = await test_visual_model_direct()

    # Test 5: Real Cloudflare site (optional, can be slow)
    # results["real_cloudflare"] = await test_real_cloudflare_site()

    # Summary
    print("\n" + "=" * 60)
    print("Test Summary")
    print("=" * 60)
    for test_name, passed in results.items():
        status = "PASS" if passed else "FAIL"
        print(f"  [{status}] {test_name}")

    all_passed = all(results.values())
    print(f"\nOverall: {'ALL TESTS PASSED' if all_passed else 'SOME TESTS FAILED'}")

    return all_passed


if __name__ == "__main__":
    success = asyncio.run(run_all_tests())
    sys.exit(0 if success else 1)
