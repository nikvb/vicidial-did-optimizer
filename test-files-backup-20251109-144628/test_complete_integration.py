#!/usr/bin/env python3
"""
Complete integration test for Crawl4AI + Proxies + OpenRouter
Debug why OpenRouter is failing
"""
import asyncio
import json
import sys
import re
import os
import logging
import requests
import time
from crawl4ai import AsyncWebCrawler

# Suppress Crawl4AI logs completely to avoid stdout pollution
logging.getLogger('crawl4ai').setLevel(logging.CRITICAL)
logging.getLogger().setLevel(logging.CRITICAL)
os.environ['CRAWL4AI_VERBOSE'] = 'false'

def log_step(step, message):
    timestamp = time.strftime("%H:%M:%S")
    print(f"[{timestamp}] {step}: {message}")

async def test_complete_integration(phone_number, use_proxy=False):
    """Test complete integration with detailed logging"""
    clean_number = re.sub(r'\D', '', phone_number)
    url = f"https://lookup.robokiller.com/search?q={clean_number}"

    log_step("START", f"Testing complete integration for {phone_number}")
    log_step("CONFIG", f"URL: {url}")
    log_step("CONFIG", f"Use Proxy: {use_proxy}")

    # Check environment variables
    api_key = os.getenv('OPENROUTER_API_KEY')
    model = os.getenv('OPENROUTER_MODEL', 'mistralai/mistral-7b-instruct:free')

    log_step("ENV", f"OpenRouter API Key: {'SET' if api_key else 'NOT SET'}")
    log_step("ENV", f"OpenRouter Model: {model}")

    if not api_key:
        log_step("ERROR", "OpenRouter API key not found in environment!")
        return None

    # Configure crawler
    crawler_config = {
        "verbose": False,
        "headless": True
    }

    # Add proxy if requested (using a test proxy)
    if use_proxy:
        # Use a simple test proxy for debugging
        test_proxy = "http://test:test@proxy.example.com:8080"
        log_step("PROXY", f"Using test proxy: {test_proxy}")
        crawler_config["proxy"] = test_proxy

    log_step("CRAWL", "Starting Crawl4AI...")

    async with AsyncWebCrawler(**crawler_config) as crawler:
        try:
            # Crawl the page
            start_time = time.time()
            result = await crawler.arun(
                url=url,
                bypass_cache=True,
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            )
            crawl_time = time.time() - start_time

            log_step("CRAWL", f"Crawl completed in {crawl_time:.2f}s - Success: {result.success}")

            if not result.success:
                log_step("ERROR", f"Crawl failed: {result.error_message}")
                return None

            log_step("CRAWL", f"HTML length: {len(result.html)} chars")

            # Extract visible text
            log_step("EXTRACT", "Extracting visible text...")
            html_cleaned = re.sub(r'<script[^>]*>.*?</script>', '', result.html, flags=re.DOTALL | re.IGNORECASE)
            html_cleaned = re.sub(r'<style[^>]*>.*?</style>', '', html_cleaned, flags=re.DOTALL | re.IGNORECASE)
            text_content = re.sub(r'<[^>]+>', ' ', html_cleaned)
            text_content = re.sub(r'\s+', ' ', text_content).strip()

            log_step("EXTRACT", f"Visible text length: {len(text_content)} chars")
            log_step("EXTRACT", f"Text preview: {text_content[:200]}...")

            # Check if we can find key data in the text
            has_positive = "positive" in text_content.lower()
            has_reputation = "reputation" in text_content.lower()
            has_allowed = "allowed" in text_content.lower()
            has_calls = "calls" in text_content.lower()

            log_step("ANALYZE", f"Text contains: Positive={has_positive}, Reputation={has_reputation}, Allowed={has_allowed}, Calls={has_calls}")

            # Prepare content for OpenRouter
            max_content_length = 10000
            if len(text_content) > max_content_length:
                text_content = text_content[:max_content_length] + "..."

            log_step("OPENROUTER", "Preparing OpenRouter request...")

            # Create the prompt
            prompt = f"""Analyze visible text from a RoboKiller phone lookup page for {phone_number} and extract reputation data.

VISIBLE TEXT CONTENT:
{text_content}

Extract phone reputation information and return JSON:

{{
    "userReports": <number or null>,
    "reputationStatus": "<Positive|Negative|Neutral|Unknown>",
    "totalCalls": <number or null>,
    "lastCallDate": "<date string or null>",
    "robokillerStatus": "<Allowed|Blocked|Unknown>",
    "spamScore": <number 0-100 or null>,
    "callerName": "<string or null>",
    "location": "<string or null>",
    "carrier": "<string or null>",
    "commentsCount": <number or null>
}}

CRITICAL: Focus on visible text content.
Look for "Positive", "Negative", "Neutral" near "User reputation"
Look for "Allowed", "Blocked" near "Robokiller status"
Extract dates, call counts, and statistics.

Return ONLY the JSON."""

            log_step("OPENROUTER", f"Prompt length: {len(prompt)} chars")

            # Prepare headers
            headers = {
                "Authorization": f"Bearer {api_key}",
                "HTTP-Referer": "https://api3.amdy.io",
                "X-Title": "DID Optimizer - Complete Integration Test",
                "Content-Type": "application/json"
            }

            # Prepare payload
            payload = {
                "model": model,
                "messages": [
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                "temperature": 0.1,
                "max_tokens": 600
            }

            log_step("OPENROUTER", f"Making request to model: {model}")
            log_step("OPENROUTER", f"Payload size: {len(json.dumps(payload))} chars")

            # Make the request
            try:
                start_time = time.time()
                response = requests.post(
                    "https://openrouter.ai/api/v1/chat/completions",
                    headers=headers,
                    json=payload,
                    timeout=60  # Increase timeout
                )
                api_time = time.time() - start_time

                log_step("OPENROUTER", f"API call completed in {api_time:.2f}s")
                log_step("OPENROUTER", f"Response status: {response.status_code}")
                log_step("OPENROUTER", f"Response headers: {dict(response.headers)}")

                if response.status_code != 200:
                    log_step("ERROR", f"OpenRouter API error: {response.status_code}")
                    log_step("ERROR", f"Response text: {response.text}")
                    return None

                # Parse response
                try:
                    response_data = response.json()
                    log_step("OPENROUTER", "Response parsed successfully")

                    # Log full response for debugging
                    log_step("DEBUG", f"Full response: {json.dumps(response_data, indent=2)}")

                    if 'choices' not in response_data:
                        log_step("ERROR", "No 'choices' in response")
                        return None

                    if len(response_data['choices']) == 0:
                        log_step("ERROR", "Empty choices array")
                        return None

                    choice = response_data['choices'][0]
                    if 'message' not in choice:
                        log_step("ERROR", "No 'message' in choice")
                        return None

                    content = choice['message']['content'].strip()
                    log_step("OPENROUTER", f"Content length: {len(content)} chars")
                    log_step("OPENROUTER", f"Content: {content}")

                    if not content:
                        log_step("ERROR", "Empty content from OpenRouter")
                        return None

                    # Try to extract JSON
                    try:
                        # Look for JSON in the response (handle markdown code blocks)
                        json_match = re.search(r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}', content, re.DOTALL)
                        if json_match:
                            extracted_json = json.loads(json_match.group(0))
                            log_step("SUCCESS", f"OpenRouter extraction successful!")
                            log_step("SUCCESS", f"Extracted data: {json.dumps(extracted_json, indent=2)}")
                            return {
                                "success": True,
                                "data": extracted_json,
                                "method": "openrouter_extraction",
                                "crawl_time": crawl_time,
                                "api_time": api_time
                            }
                        else:
                            # Try parsing the whole content as JSON
                            extracted_json = json.loads(content)
                            log_step("SUCCESS", f"OpenRouter extraction successful (direct parse)!")
                            log_step("SUCCESS", f"Extracted data: {json.dumps(extracted_json, indent=2)}")
                            return {
                                "success": True,
                                "data": extracted_json,
                                "method": "openrouter_extraction_direct",
                                "crawl_time": crawl_time,
                                "api_time": api_time
                            }
                    except json.JSONDecodeError as e:
                        log_step("ERROR", f"JSON parse error: {e}")
                        log_step("ERROR", f"Content was: {content}")
                        return None

                except json.JSONDecodeError as e:
                    log_step("ERROR", f"Failed to parse response JSON: {e}")
                    log_step("ERROR", f"Response text: {response.text}")
                    return None

            except requests.exceptions.Timeout:
                log_step("ERROR", "OpenRouter API timeout")
                return None
            except requests.exceptions.RequestException as e:
                log_step("ERROR", f"OpenRouter API request error: {e}")
                return None

        except Exception as e:
            log_step("ERROR", f"Crawl4AI error: {e}")
            import traceback
            log_step("TRACE", traceback.format_exc())
            return None

async def main():
    log_step("START", "🚀 COMPLETE INTEGRATION TEST")
    log_step("START", "=" * 80)

    # Set environment variables
    os.environ['OPENROUTER_API_KEY'] = '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'
    os.environ['OPENROUTER_MODEL'] = 'mistralai/mistral-7b-instruct:free'

    phone_number = "2255777553"

    # Test without proxy first
    log_step("TEST", "Testing WITHOUT proxy...")
    result1 = await test_complete_integration(phone_number, use_proxy=False)

    if result1:
        log_step("RESULT", f"✅ No-proxy test: {result1['method']}")
    else:
        log_step("RESULT", "❌ No-proxy test: FAILED")

    log_step("END", "=" * 80)
    log_step("END", "🏁 Test completed")

    if result1:
        print("\n" + "=" * 80)
        print("🎉 FINAL RESULT:")
        print(json.dumps(result1, indent=2))
    else:
        print("\n" + "=" * 80)
        print("❌ TEST FAILED - Check logs above")

if __name__ == "__main__":
    asyncio.run(main())