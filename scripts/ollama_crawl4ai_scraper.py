#!/usr/bin/env python3
import asyncio
import json
import sys
import re
import ollama
import logging
import os
from crawl4ai import AsyncWebCrawler
from crawl4ai.extraction_strategy import LLMExtractionStrategy, LLMConfig
from crawl4ai.chunking_strategy import RegexChunking

# Suppress Crawl4AI logs completely to avoid stdout pollution
logging.getLogger('crawl4ai').setLevel(logging.CRITICAL)
logging.getLogger().setLevel(logging.CRITICAL)
os.environ['CRAWL4AI_VERBOSE'] = 'false'

async def scrape_robokiller_data(phone_number, proxy_url=None):
    """Scrape RoboKiller reputation data for a phone number using local Ollama LLM"""
    clean_number = re.sub(r'\D', '', phone_number)
    url = f"https://lookup.robokiller.com/search?q={clean_number}"

    # Configure crawler with proxy if provided
    crawler_config = {
        "verbose": False,  # Disable verbose to avoid stdout pollution
        "headless": True
    }

    if proxy_url:
        print(f"🌐 Using proxy: {proxy_url}", file=sys.stderr)
        crawler_config["proxy"] = proxy_url

    async with AsyncWebCrawler(**crawler_config) as crawler:
        try:
            # Define extraction strategy using local Ollama LLM
            from crawl4ai import LLMConfig

            llm_config = LLMConfig(
                provider="ollama/llama3.2:3b",
                base_url="http://localhost:11434"
            )

            extraction_strategy = LLMExtractionStrategy(
                llm_config=llm_config,
                schema={
                    "type": "object",
                    "properties": {
                        "userReports": {"type": "number", "description": "Number of user reports"},
                        "reputationStatus": {"type": "string", "description": "Reputation status: Positive, Negative, Neutral, or Unknown"},
                        "totalCalls": {"type": "number", "description": "Total number of calls"},
                        "lastCallDate": {"type": "string", "description": "Date of last call"},
                        "robokillerStatus": {"type": "string", "description": "RoboKiller status: Allowed, Blocked, or Unknown"},
                        "spamScore": {"type": "number", "description": "Spam score percentage"},
                        "callerName": {"type": "string", "description": "Caller name if available"},
                        "location": {"type": "string", "description": "Location information"},
                        "carrier": {"type": "string", "description": "Phone carrier information"}
                    }
                },
                extraction_type="schema",
                instruction="""Extract phone number reputation data from the RoboKiller lookup page.

IMPORTANT ANALYSIS RULES:
1. Look for POSITIVE indicators first: 'safe', 'legitimate', 'verified', 'trusted', 'clean', 'good'
2. Only mark as NEGATIVE if you find: 'spam', 'scam', 'fraud', 'robocall', 'telemarketer', 'unwanted'
3. If page says 'neutral' or meta description contains 'neutral', set reputationStatus to 'Neutral'
4. If no clear indicators, set to 'Unknown'
5. Extract any numerical values for reports, calls, or scores
6. Look for blocked/allowed status

Return valid JSON only."""
            )

            # Crawl the page
            result = await crawler.arun(
                url=url,
                extraction_strategy=extraction_strategy,
                bypass_cache=True,
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            )

            if result.success:
                # Try to extract using LLM first
                if result.extracted_content:
                    try:
                        extracted_data = json.loads(result.extracted_content)
                        return {
                            "success": True,
                            "data": extracted_data,
                            "method": "ollama_llm_extraction"
                        }
                    except json.JSONDecodeError as e:
                        # If LLM output is not valid JSON, fall back to enhanced regex
                        print(f"LLM JSON parse error: {e}", file=sys.stderr)
                        print(f"LLM output: {result.extracted_content}", file=sys.stderr)

                # Enhanced fallback with better reputation detection
                html_content = result.html.lower()
                data = extract_with_enhanced_logic(html_content)
                return {
                    "success": True,
                    "data": data,
                    "method": "enhanced_regex_extraction"
                }
            else:
                return {
                    "success": False,
                    "error": f"Failed to crawl {url}: {result.error_message}",
                    "method": "crawl_failed"
                }

        except Exception as e:
            # If Crawl4AI completely fails, return error
            return {
                "success": False,
                "error": f"Crawl4AI failed: {str(e)}",
                "method": "crawl4ai_failed"
            }


def extract_with_enhanced_logic(html_content):
    """Enhanced regex extraction with improved reputation detection logic"""
    data = {
        "userReports": 0,
        "reputationStatus": "Unknown",
        "totalCalls": 0,
        "lastCallDate": None,
        "robokillerStatus": "Unknown",
        "spamScore": None,
        "callerName": None,
        "location": None,
        "carrier": None
    }

    # Enhanced reputation analysis with priority order

    # 1. Check meta description for explicit "neutral"
    if 'og:description" content="neutral"' in html_content:
        data["reputationStatus"] = "Neutral"
        data["spamScore"] = 50

    # 2. Look for POSITIVE indicators first (higher priority)
    elif any(indicator in html_content for indicator in ['safe', 'legitimate', 'verified', 'trusted', 'clean', 'good reputation']):
        data["reputationStatus"] = "Positive"
        data["spamScore"] = 25

    # 3. Look for NEGATIVE indicators (but only if no positive found)
    elif any(indicator in html_content for indicator in ['spam', 'scam', 'fraud', 'robocall', 'telemarketer', 'unwanted']):
        data["reputationStatus"] = "Negative"
        data["spamScore"] = 75

    # 4. Look for unknown/no data indicators
    elif any(indicator in html_content for indicator in ['unknown', 'no data', 'not found', 'no information', 'no reports']):
        data["reputationStatus"] = "Unknown"
        data["spamScore"] = 50

    # Extract RoboKiller status
    if 'blocked' in html_content or 'blocked by robokiller' in html_content:
        data["robokillerStatus"] = "Blocked"
    elif 'allowed' in html_content or 'not blocked' in html_content:
        data["robokillerStatus"] = "Allowed"

    # Extract numerical data
    reports_patterns = [
        r'(\d+)\s*reports?',
        r'reports?[\'"]?\s*[:\-]\s*[\'"]?(\d+)',
        r'user[\\s\\-]?reports?[\'"]?\s*[:\-]\s*[\'"]?(\d+)'
    ]

    for pattern in reports_patterns:
        match = re.search(pattern, html_content, re.IGNORECASE)
        if match:
            data["userReports"] = int(match.group(1))
            break

    # Extract total calls
    calls_patterns = [
        r'(\d+)\s*calls?',
        r'total[\\s\\-]?calls?[\'"]?\s*[:\-]\s*[\'"]?(\d+)'
    ]

    for pattern in calls_patterns:
        match = re.search(pattern, html_content, re.IGNORECASE)
        if match:
            data["totalCalls"] = int(match.group(1))
            break

    return data

async def main():
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "Phone number required"}))
        return

    phone_number = sys.argv[1]
    proxy_url = None

    # Check for proxy parameter
    for arg in sys.argv[2:]:
        if arg.startswith('--proxy='):
            proxy_url = arg.split('=', 1)[1]
            break

    result = await scrape_robokiller_data(phone_number, proxy_url)
    print(json.dumps(result))

if __name__ == "__main__":
    asyncio.run(main())