#!/usr/bin/env python3
import asyncio
import json
import sys
import re
import os
import logging
import requests
from crawl4ai import AsyncWebCrawler

# Suppress Crawl4AI logs completely to avoid stdout pollution
logging.getLogger('crawl4ai').setLevel(logging.CRITICAL)
logging.getLogger().setLevel(logging.CRITICAL)
os.environ['CRAWL4AI_VERBOSE'] = 'false'

async def scrape_robokiller_data(phone_number, proxy_url=None):
    """Scrape RoboKiller reputation data for a phone number using OpenRouter API"""
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
            # Crawl the page first
            result = await crawler.arun(
                url=url,
                bypass_cache=True,
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            )

            if result.success:
                # Try OpenRouter LLM extraction first
                if result.html:
                    try:
                        llm_result = extract_with_openrouter(result.html)
                        if llm_result:
                            return {
                                "success": True,
                                "data": llm_result,
                                "method": "openrouter_llm_extraction"
                            }
                    except Exception as e:
                        print(f"OpenRouter LLM error: {e}", file=sys.stderr)

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


def extract_with_openrouter(html_content):
    """Use OpenRouter API to extract reputation data from HTML content"""
    try:
        # Get API credentials from environment
        api_key = os.getenv('OPENROUTER_API_KEY')
        model = os.getenv('OPENROUTER_MODEL', 'microsoft/phi-3-mini-4k-instruct:free')

        if not api_key:
            print("OpenRouter API key not found", file=sys.stderr)
            return None

        # Truncate HTML content to avoid token limits
        max_content_length = 8000
        if len(html_content) > max_content_length:
            html_content = html_content[:max_content_length] + "..."

        # Prepare the request to OpenRouter
        headers = {
            "Authorization": f"Bearer {api_key}",
            "HTTP-Referer": "https://api3.amdy.io",
            "X-Title": "DID Optimizer - Phone Reputation Scanner",
            "Content-Type": "application/json"
        }

        prompt = f"""Analyze this RoboKiller phone lookup page HTML and extract reputation information in JSON format.

HTML Content:
{html_content}

Return ONLY valid JSON with this exact structure:
{{
    "userReports": <number>,
    "reputationStatus": "<Positive|Negative|Neutral|Unknown>",
    "totalCalls": <number>,
    "lastCallDate": "<date string or null>",
    "robokillerStatus": "<Allowed|Blocked|Unknown>",
    "spamScore": <number 0-100 or null>,
    "callerName": "<string or null>",
    "location": "<string or null>",
    "carrier": "<string or null>"
}}

IMPORTANT ANALYSIS RULES:
1. Look for POSITIVE indicators first: 'safe', 'legitimate', 'verified', 'trusted', 'clean', 'good'
2. Only mark as NEGATIVE if you find: 'spam', 'scam', 'fraud', 'robocall', 'telemarketer', 'unwanted'
3. If page says 'neutral' or meta description contains 'neutral', set reputationStatus to 'Neutral'
4. If no clear indicators, set to 'Unknown'
5. Extract any numerical values for reports, calls, or scores
6. Look for blocked/allowed status

Return ONLY the JSON, no other text."""

        payload = {
            "model": model,
            "messages": [
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            "temperature": 0.1,
            "max_tokens": 500
        }

        # Make request to OpenRouter
        response = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers=headers,
            json=payload,
            timeout=30
        )

        if response.status_code == 200:
            response_data = response.json()
            if 'choices' in response_data and len(response_data['choices']) > 0:
                content = response_data['choices'][0]['message']['content'].strip()

                # Try to extract JSON from the response
                try:
                    # Look for JSON in the response
                    json_match = re.search(r'\{.*\}', content, re.DOTALL)
                    if json_match:
                        return json.loads(json_match.group(0))
                    else:
                        return json.loads(content)
                except json.JSONDecodeError:
                    print(f"OpenRouter response not valid JSON: {content}", file=sys.stderr)
                    return None
        else:
            print(f"OpenRouter API error: {response.status_code} - {response.text}", file=sys.stderr)
            return None

    except Exception as e:
        print(f"OpenRouter extraction error: {e}", file=sys.stderr)
        return None


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
        r'reports?[\'"]?\s*[:\-]\s*[\'""]?(\d+)',
        r'user[\s\-]?reports?[\'"]?\s*[:\-]\s*[\'"]?(\d+)'
    ]

    for pattern in reports_patterns:
        match = re.search(pattern, html_content, re.IGNORECASE)
        if match:
            data["userReports"] = int(match.group(1))
            break

    # Extract total calls
    calls_patterns = [
        r'(\d+)\s*calls?',
        r'total[\s\-]?calls?[\'"]?\s*[:\-]\s*[\'"]?(\d+)'
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