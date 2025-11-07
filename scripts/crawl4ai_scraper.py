#!/usr/bin/env python3
import asyncio
import json
import sys
import re
from crawl4ai import AsyncWebCrawler
from crawl4ai.extraction_strategy import LLMExtractionStrategy
from crawl4ai.chunking_strategy import RegexChunking

async def scrape_robokiller_data(phone_number):
    """Scrape RoboKiller reputation data for a phone number"""
    clean_number = re.sub(r'\D', '', phone_number)
    url = f"https://lookup.robokiller.com/search?q={clean_number}"

    async with AsyncWebCrawler(verbose=False, headless=True) as crawler:
        try:
            # Define extraction strategy for reputation data
            extraction_strategy = LLMExtractionStrategy(
                provider="ollama/llama2",  # Fallback to basic extraction if no LLM
                api_token="",
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
                instruction="Extract phone number reputation data from the RoboKiller lookup page"
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
                            "method": "llm_extraction"
                        }
                    except:
                        pass

                # Fallback to regex extraction from HTML
                html_content = result.html
                data = extract_with_regex(html_content)
                return {
                    "success": True,
                    "data": data,
                    "method": "regex_extraction"
                }
            else:
                return {
                    "success": False,
                    "error": f"Failed to crawl {url}: {result.error_message}",
                    "method": "crawl_failed"
                }

        except Exception as e:
            return {
                "success": False,
                "error": str(e),
                "method": "exception"
            }

def extract_with_regex(html_content):
    """Extract reputation data using regex patterns"""
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

    # Extract reputation status
    reputation_patterns = [
        r'reputation["']?\s*[:-]\s*["']?(positive|negative|neutral)',
        r'class=["']reputation["'][^>]*>\s*(positive|negative|neutral)',
        r'reputation-value["'][^>]*>\s*(positive|negative|neutral)'
    ]

    for pattern in reputation_patterns:
        match = re.search(pattern, html_content, re.IGNORECASE)
        if match:
            status = match.group(1).lower()
            data["reputationStatus"] = status.capitalize()
            break

    # Extract RoboKiller status
    status_patterns = [
        r'robokiller["']?\s*[:-]\s*["']?(allowed|blocked)',
        r'status["']?\s*[:-]\s*["']?(allowed|blocked)',
        r'class=["']status["'][^>]*>\s*(allowed|blocked)'
    ]

    for pattern in status_patterns:
        match = re.search(pattern, html_content, re.IGNORECASE)
        if match:
            status = match.group(1).lower()
            data["robokillerStatus"] = status.capitalize()
            break

    # Extract user reports
    reports_patterns = [
        r'user[\s\-]?reports?["']?\s*[:-]\s*["']?(\d+)',
        r'reports?["']?\s*[:-]\s*["']?(\d+)',
        r'(\d+)\s*reports?'
    ]

    for pattern in reports_patterns:
        match = re.search(pattern, html_content, re.IGNORECASE)
        if match:
            data["userReports"] = int(match.group(1))
            break

    # Extract total calls
    calls_patterns = [
        r'total[\s\-]?calls?["']?\s*[:-]\s*["']?(\d+)',
        r'calls?["']?\s*[:-]\s*["']?(\d+)',
        r'(\d+)\s*calls?'
    ]

    for pattern in calls_patterns:
        match = re.search(pattern, html_content, re.IGNORECASE)
        if match:
            data["totalCalls"] = int(match.group(1))
            break

    # Extract last call date
    date_patterns = [
        r'last[\s\-]?call["']?\s*[:-]\s*["']?([^<>"\n]+)',
        r'(\w+\s+\d+,\s+\d{4})',
        r'(\d{1,2}/\d{1,2}/\d{2,4})'
    ]

    for pattern in date_patterns:
        match = re.search(pattern, html_content, re.IGNORECASE)
        if match:
            data["lastCallDate"] = match.group(1).strip()
            break

    # Extract spam score
    spam_patterns = [
        r'spam[\s\-]?score["']?\s*[:-]\s*["']?(\d+)',
        r'(\d+)%?\s*spam'
    ]

    for pattern in spam_patterns:
        match = re.search(pattern, html_content, re.IGNORECASE)
        if match:
            data["spamScore"] = int(match.group(1))
            break

    return data

async def main():
    if len(sys.argv) != 2:
        print(json.dumps({"success": False, "error": "Phone number required"}))
        return

    phone_number = sys.argv[1]
    result = await scrape_robokiller_data(phone_number)
    print(json.dumps(result))

if __name__ == "__main__":
    asyncio.run(main())
