#!/usr/bin/env python3
"""
AI-Powered Web Scraper with Cloudflare Bypass

A simple command-line tool to scrape websites protected by Cloudflare
using visual AI to solve challenges.

Usage:
    python ai_scrape.py https://example.com
    python ai_scrape.py https://example.com --output result.html
    python ai_scrape.py https://example.com --selector "div.content" --json
"""

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from ai_crawler import AICrawler


async def scrape(
    url: str,
    output: str = None,
    selector: str = None,
    as_json: bool = False,
    headless: bool = True,
    timeout: int = 30000,
    max_attempts: int = 10
) -> dict:
    """
    Scrape a URL with automatic Cloudflare bypass.

    Args:
        url: Target URL
        output: Output file path (optional)
        selector: CSS selector to extract (optional)
        as_json: Output as JSON
        headless: Run browser headless
        timeout: Page timeout in ms
        max_attempts: Max challenge solving attempts

    Returns:
        Dict with scrape results
    """
    result_data = {
        "url": url,
        "success": False,
        "html": "",
        "extracted": None,
        "challenge_solved": False,
        "error": None
    }

    async with AICrawler(
        headless=headless,
        page_timeout=timeout,
        max_challenge_attempts=max_attempts
    ) as crawler:
        result = await crawler.fetch(url)

        result_data["success"] = result.success
        result_data["html"] = result.html
        result_data["challenge_solved"] = result.challenge_solved
        result_data["error"] = result.error

        # Extract specific content if selector provided
        if selector and result.success:
            from playwright.async_api import async_playwright

            async with async_playwright() as p:
                browser = await p.chromium.launch(headless=True)
                page = await browser.new_page()
                await page.set_content(result.html)

                try:
                    elements = await page.query_selector_all(selector)
                    extracted = []
                    for el in elements:
                        text = await el.inner_text()
                        extracted.append(text.strip())
                    result_data["extracted"] = extracted
                except Exception as e:
                    result_data["extracted"] = f"Error extracting: {e}"

                await browser.close()

    # Output handling
    if output:
        with open(output, 'w', encoding='utf-8') as f:
            if as_json:
                json.dump(result_data, f, indent=2)
            else:
                f.write(result_data["html"])
        print(f"Output saved to: {output}")
    elif as_json:
        print(json.dumps(result_data, indent=2))
    else:
        # Print summary
        print(f"\nScrape Results:")
        print(f"  URL: {url}")
        print(f"  Success: {result_data['success']}")
        print(f"  Challenge Solved: {result_data['challenge_solved']}")
        print(f"  HTML Length: {len(result_data['html'])} bytes")
        if result_data["error"]:
            print(f"  Error: {result_data['error']}")
        if result_data["extracted"]:
            print(f"  Extracted ({len(result_data['extracted'])} items):")
            for item in result_data["extracted"][:5]:
                print(f"    - {item[:80]}...")

    return result_data


def main():
    parser = argparse.ArgumentParser(
        description="AI-powered web scraper with Cloudflare bypass",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python ai_scrape.py https://example.com
  python ai_scrape.py https://example.com -o result.html
  python ai_scrape.py https://example.com -s "h1" --json
  python ai_scrape.py https://example.com --no-headless  # Show browser
        """
    )

    parser.add_argument("url", help="URL to scrape")
    parser.add_argument("-o", "--output", help="Output file path")
    parser.add_argument("-s", "--selector", help="CSS selector to extract")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    parser.add_argument("--no-headless", action="store_true", help="Show browser window")
    parser.add_argument("--timeout", type=int, default=30000, help="Page timeout in ms")
    parser.add_argument("--max-attempts", type=int, default=10, help="Max challenge attempts")

    args = parser.parse_args()

    result = asyncio.run(scrape(
        url=args.url,
        output=args.output,
        selector=args.selector,
        as_json=args.json,
        headless=not args.no_headless,
        timeout=args.timeout,
        max_attempts=args.max_attempts
    ))

    sys.exit(0 if result["success"] else 1)


if __name__ == "__main__":
    main()
