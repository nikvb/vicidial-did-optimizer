#!/usr/bin/env python3
import asyncio
import json
import sys
import re
import os
import logging
import requests
from crawl4ai import AsyncWebCrawler
from playwright.async_api import async_playwright

# Suppress Crawl4AI logs completely to avoid stdout pollution
logging.getLogger('crawl4ai').setLevel(logging.CRITICAL)
logging.getLogger().setLevel(logging.CRITICAL)
os.environ['CRAWL4AI_VERBOSE'] = 'false'

def save_screenshot(crawl_result, phone_number):
    """Save screenshot from crawl result and return filename"""
    try:
        # Create screenshots directory if it doesn't exist
        screenshot_dir = '/home/na/didapi/public/screenshots'
        os.makedirs(screenshot_dir, exist_ok=True)

        # Generate filename with timestamp
        from datetime import datetime
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f'robokiller_{phone_number}_{timestamp}.png'
        filepath = os.path.join(screenshot_dir, filename)

        # Try different ways to access screenshot
        screenshot_data = None

        # Handle CrawlResultContainer (crawl4ai 0.7.x)
        if hasattr(crawl_result, '_results') and len(crawl_result._results) > 0:
            actual_result = crawl_result._results[0]
            print(f"DEBUG: actual_result type: {type(actual_result)}", file=sys.stderr)
            print(f"DEBUG: actual_result attributes: {[attr for attr in dir(actual_result) if not attr.startswith('_')]}", file=sys.stderr)

            screenshot_value = getattr(actual_result, 'screenshot', None)
            print(f"DEBUG: screenshot value: {screenshot_value is not None}, type: {type(screenshot_value) if screenshot_value else 'None'}", file=sys.stderr)

            if screenshot_value and isinstance(screenshot_value, bytes):
                screenshot_data = screenshot_value
                print(f"✅ Found screenshot bytes in _results[0]", file=sys.stderr)
            elif screenshot_value and isinstance(screenshot_value, str):
                # Might be base64 encoded
                try:
                    import base64
                    screenshot_data = base64.b64decode(screenshot_value)
                    print(f"✅ Decoded screenshot from base64 string", file=sys.stderr)
                except:
                    print(f"⚠️  Screenshot is string but not base64", file=sys.stderr)
        # Try direct access (older crawl4ai versions)
        elif hasattr(crawl_result, 'screenshot') and crawl_result.screenshot:
            screenshot_data = crawl_result.screenshot
            print(f"✅ Found screenshot via direct attribute", file=sys.stderr)
        elif hasattr(crawl_result, 'screenshot_base64') and crawl_result.screenshot_base64:
            import base64
            screenshot_data = base64.b64decode(crawl_result.screenshot_base64)
            print(f"✅ Found screenshot_base64 via direct attribute", file=sys.stderr)

        if screenshot_data:
            with open(filepath, 'wb') as f:
                f.write(screenshot_data)
            print(f"✅ Screenshot saved: {filename}", file=sys.stderr)
            return filename
        else:
            print(f"⚠️  No screenshot data found in crawl result", file=sys.stderr)
            return None

    except Exception as e:
        print(f"❌ Error saving screenshot: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return None

async def capture_screenshot_playwright(url, clean_number, proxy_url=None):
    """Capture screenshot using Playwright with robust error handling"""
    browser = None
    try:
        async with async_playwright() as p:
            browser_args = {"headless": True}
            if proxy_url:
                # Parse proxy URL
                # Format: http://user:pass@host:port
                print(f"🌐 Using proxy for screenshot: {proxy_url}", file=sys.stderr)
                browser_args["proxy"] = {"server": proxy_url}

            browser = await p.chromium.launch(**browser_args)
            page = await browser.new_page()

            try:
                await page.goto(url, wait_until="networkidle", timeout=30000)
            except Exception as nav_error:
                print(f"⚠️ Navigation error (retrying with domcontentloaded): {nav_error}", file=sys.stderr)
                try:
                    await page.goto(url, wait_until="domcontentloaded", timeout=20000)
                except Exception as retry_error:
                    print(f"❌ Navigation retry failed: {retry_error}", file=sys.stderr)
                    if browser:
                        await browser.close()
                    return None

            # Try to click "Accept All" or similar cookie consent buttons
            try:
                # Common selectors for cookie consent buttons
                consent_selectors = [
                    'button:has-text("Accept All")',
                    'button:has-text("Accept all")',
                    'button:has-text("accept all")',
                    'button:has-text("ACCEPT ALL")',
                    '[aria-label*="Accept"]',
                    '.accept-all',
                    '#accept-all',
                    'button[class*="accept"]',
                    'button[id*="accept"]',
                ]

                for selector in consent_selectors:
                    try:
                        button = await page.wait_for_selector(selector, timeout=2000)
                        if button:
                            await button.click()
                            print(f"✅ Clicked cookie consent: {selector}", file=sys.stderr)
                            await page.wait_for_timeout(1000)  # Wait for dialog to close
                            break
                    except:
                        continue
            except Exception as e:
                # No cookie consent found or timeout - that's okay
                pass

            # Take screenshot
            screenshot_dir = '/home/na/didapi/public/screenshots'
            os.makedirs(screenshot_dir, exist_ok=True)
            from datetime import datetime
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            filename = f'robokiller_{clean_number}_{timestamp}.png'
            filepath = os.path.join(screenshot_dir, filename)

            await page.screenshot(path=filepath, full_page=True)
            await browser.close()
            browser = None  # Mark as closed

            print(f"✅ Screenshot saved: {filename}", file=sys.stderr)
            return filename
    except BrokenPipeError as e:
        print(f"❌ BrokenPipeError in screenshot capture: {e}", file=sys.stderr)
        return None
    except ConnectionResetError as e:
        print(f"❌ ConnectionResetError in screenshot capture: {e}", file=sys.stderr)
        return None
    except Exception as e:
        error_msg = str(e).lower()
        if 'epipe' in error_msg or 'broken pipe' in error_msg or 'connection reset' in error_msg:
            print(f"❌ Pipe error in screenshot capture: {e}", file=sys.stderr)
        else:
            print(f"❌ Screenshot capture failed: {e}", file=sys.stderr)
        return None
    finally:
        # Ensure browser is always closed
        if browser:
            try:
                await browser.close()
            except:
                pass  # Ignore errors during cleanup

async def scrape_with_single_browser(url, clean_number, proxy_url=None):
    """Use a single Playwright browser for both screenshot and HTML extraction"""
    browser = None
    try:
        async with async_playwright() as p:
            browser_args = {"headless": True}
            if proxy_url:
                print(f"🌐 Using proxy: {proxy_url}", file=sys.stderr)
                browser_args["proxy"] = {"server": proxy_url}

            browser = await p.chromium.launch(**browser_args)
            page = await browser.new_page(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            )

            # Navigate to page
            try:
                await page.goto(url, wait_until="networkidle", timeout=30000)
            except Exception as nav_error:
                print(f"⚠️ Navigation error (retrying): {nav_error}", file=sys.stderr)
                try:
                    await page.goto(url, wait_until="domcontentloaded", timeout=20000)
                except Exception as retry_error:
                    raise Exception(f"Navigation failed: {retry_error}")

            # Handle cookie consent
            try:
                consent_selectors = [
                    'button:has-text("Accept All")',
                    'button:has-text("Accept all")',
                    '[aria-label*="Accept"]',
                    '.accept-all',
                    '#accept-all',
                ]
                for selector in consent_selectors:
                    try:
                        button = await page.wait_for_selector(selector, timeout=1500)
                        if button:
                            await button.click()
                            await page.wait_for_timeout(500)
                            break
                    except:
                        continue
            except:
                pass

            # Get HTML content
            html_content = await page.content()

            # Take screenshot
            screenshot_filename = None
            try:
                screenshot_dir = '/home/na/didapi/public/screenshots'
                os.makedirs(screenshot_dir, exist_ok=True)
                from datetime import datetime
                timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
                screenshot_filename = f'robokiller_{clean_number}_{timestamp}.png'
                filepath = os.path.join(screenshot_dir, screenshot_filename)
                await page.screenshot(path=filepath, full_page=True)
                print(f"✅ Screenshot saved: {screenshot_filename}", file=sys.stderr)
            except Exception as ss_error:
                print(f"⚠️ Screenshot failed: {ss_error}", file=sys.stderr)
                screenshot_filename = None

            await browser.close()
            browser = None

            return {
                "success": True,
                "html": html_content,
                "screenshot": screenshot_filename
            }

    except BrokenPipeError as e:
        return {"success": False, "error": f"BrokenPipeError: {e}", "html": None, "screenshot": None}
    except ConnectionResetError as e:
        return {"success": False, "error": f"ConnectionResetError: {e}", "html": None, "screenshot": None}
    except Exception as e:
        error_msg = str(e).lower()
        if 'epipe' in error_msg or 'broken pipe' in error_msg:
            return {"success": False, "error": f"Pipe error: {e}", "html": None, "screenshot": None}
        return {"success": False, "error": str(e), "html": None, "screenshot": None}
    finally:
        if browser:
            try:
                await browser.close()
            except:
                pass


async def scrape_robokiller_data(phone_number, proxy_url=None):
    """Scrape RoboKiller reputation data using a single browser instance"""
    clean_number = re.sub(r'\D', '', phone_number)
    url = f"https://lookup.robokiller.com/search?q={clean_number}"

    # Use single browser for both screenshot and HTML extraction
    browser_result = await scrape_with_single_browser(url, clean_number, proxy_url)

    if not browser_result["success"]:
        return {
            "success": False,
            "error": browser_result.get("error", "Browser scraping failed"),
            "method": "browser_failed"
        }

    html_content = browser_result["html"]
    screenshot_filename = browser_result["screenshot"]

    if not html_content:
        return {
            "success": False,
            "error": "No HTML content retrieved",
            "method": "no_content"
        }

    try:
        # Extract visible text content
        html_cleaned = re.sub(r'<script[^>]*>.*?</script>', '', html_content, flags=re.DOTALL | re.IGNORECASE)
        html_cleaned = re.sub(r'<style[^>]*>.*?</style>', '', html_cleaned, flags=re.DOTALL | re.IGNORECASE)
        text_content = re.sub(r'<[^>]+>', ' ', html_cleaned)
        text_content = re.sub(r'\s+', ' ', text_content).strip()

        # Use enhanced vLLM extraction with visible text
        if text_content:
            try:
                llm_result = extract_with_enhanced_openrouter_text(text_content, clean_number)
                if llm_result:
                    return {
                        "success": True,
                        "data": llm_result,
                        "method": "vllm_extraction",
                        "screenshot": screenshot_filename
                    }
            except Exception as e:
                print(f"vLLM extraction error: {e}", file=sys.stderr)
                # Fall back to regex if vLLM fails
                pass

        # Fallback to regex extraction
        html_lower = html_content.lower()
        data = extract_with_enhanced_logic(html_lower)
        return {
            "success": True,
            "data": data,
            "method": "enhanced_regex_extraction",
            "screenshot": screenshot_filename
        }

    except Exception as e:
        return {
            "success": False,
            "error": f"Extraction failed: {str(e)}",
            "method": "extraction_failed"
        }


def parse_reasoning_content(reasoning_text):
    """Parse structured data from reasoning model output"""
    try:
        # Extract values from reasoning text using patterns
        data = {
            "userReports": None,
            "reputationStatus": "Unknown",
            "totalCalls": None,
            "lastCallDate": None,
            "robokillerStatus": "Unknown",
            "spamScore": None,
            "callerName": None,
            "location": None,
            "carrier": None,
            "commentsCount": None
        }

        # Extract reputation status
        rep_match = re.search(r'reputationStatus[:\s]+["\']?(Positive|Negative|Neutral|Unknown)["\']?', reasoning_text, re.IGNORECASE)
        if rep_match:
            data["reputationStatus"] = rep_match.group(1).capitalize()

        # Extract robokiller status
        rk_match = re.search(r'robokillerStatus[:\s]+["\']?(Allowed|Blocked|Unknown)["\']?', reasoning_text, re.IGNORECASE)
        if rk_match:
            data["robokillerStatus"] = rk_match.group(1).capitalize()

        # Extract total calls
        calls_match = re.search(r'totalCalls[:\s]+(\d+)', reasoning_text)
        if calls_match:
            data["totalCalls"] = int(calls_match.group(1))

        # Extract user reports
        reports_match = re.search(r'userReports[:\s]+(\d+)', reasoning_text)
        if reports_match:
            data["userReports"] = int(reports_match.group(1))

        # Extract last call date
        date_match = re.search(r'lastCallDate[:\s]+["\']([^"\']+)["\']', reasoning_text)
        if date_match:
            data["lastCallDate"] = date_match.group(1)
        else:
            # Try to find date format directly
            date_match2 = re.search(r'(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d+,?\s+\d{4}', reasoning_text, re.IGNORECASE)
            if date_match2:
                data["lastCallDate"] = date_match2.group(0)

        # Extract comments count
        comments_match = re.search(r'commentsCount[:\s]+(\d+)', reasoning_text)
        if comments_match:
            data["commentsCount"] = int(comments_match.group(1))

        return data
    except Exception as e:
        print(f"Error parsing reasoning content: {e}", file=sys.stderr)
        return None


def extract_with_enhanced_openrouter_text(text_content, phone_number):
    """Use vLLM OpenAI-compatible API to extract all reputation data from visible text content"""
    try:
        # Get API credentials from environment - vLLM configuration
        api_base = os.getenv('OPENAI_COMPATIBLE_URL', 'http://71.241.245.11:41924/v1')
        model = os.getenv('OPENAI_COMPATIBLE_MODEL', 'openai/gpt-oss-20b')
        api_key = os.getenv('OPENAI_COMPATIBLE_KEY', 'not-needed')

        print(f"🔧 Using vLLM endpoint: {api_base}", file=sys.stderr)
        print(f"🔧 Using model: {model}", file=sys.stderr)

        # Use visible text content directly (like the working test script)
        max_content_length = 10000
        content_to_analyze = text_content
        if len(content_to_analyze) > max_content_length:
            content_to_analyze = content_to_analyze[:max_content_length] + "..."

        # Enhanced prompt focused on visible text - concise for reasoning models
        prompt = f"""Extract reputation data from RoboKiller page text for {phone_number}.

TEXT:
{content_to_analyze}

Return ONLY this JSON (no other text):
{{
    "userReports": <number or null>,
    "reputationStatus": "Positive|Negative|Neutral|Unknown",
    "totalCalls": <number or null>,
    "lastCallDate": "date or null",
    "robokillerStatus": "Allowed|Blocked|Unknown",
    "spamScore": <0-100 or null>,
    "callerName": "string or null",
    "location": "string or null",
    "carrier": "string or null",
    "commentsCount": <number or null>
}}

Find: User reputation (Positive/Negative/Neutral), Robokiller status (Allowed/Blocked), Total calls, User reports, Last call date."""

        # Prepare headers for vLLM OpenAI-compatible API
        headers = {
            "Authorization": f"Bearer {api_key}",
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

        # Make request to vLLM OpenAI-compatible endpoint
        api_url = f"{api_base}/chat/completions"
        print(f"📡 Making request to: {api_url}", file=sys.stderr)

        response = requests.post(
            api_url,
            headers=headers,
            json=payload,
            timeout=45
        )

        if response.status_code == 200:
            response_data = response.json()

            if 'choices' in response_data and len(response_data['choices']) > 0:
                message = response_data['choices'][0].get('message', {})
                content = message.get('content')
                reasoning_content = message.get('reasoning_content')

                # Handle reasoning models (o1-style) that put output in reasoning_content
                if content is None and reasoning_content:
                    print(f"🧠 Using reasoning_content from o1-style model", file=sys.stderr)
                    content = reasoning_content
                elif content is None:
                    print(f"⚠️ vLLM returned null content and no reasoning", file=sys.stderr)
                    return None

                content = content.strip()

                # Try to extract JSON from the response (handle markdown code blocks)
                try:
                    # Handle markdown code blocks - look for JSON inside ```json blocks
                    if '```json' in content:
                        json_match = re.search(r'```json\s*(\{.*?\})\s*```', content, re.DOTALL)
                        if json_match:
                            parsed_result = json.loads(json_match.group(1))
                            print(f"✅ vLLM extraction successful (markdown) for {phone_number}", file=sys.stderr)
                            return parsed_result

                    # Look for JSON pattern in the response
                    json_match = re.search(r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}', content, re.DOTALL)
                    if json_match:
                        parsed_result = json.loads(json_match.group(0))
                        print(f"✅ vLLM extraction successful (pattern) for {phone_number}", file=sys.stderr)
                        return parsed_result
                    else:
                        # Try parsing the whole content as JSON
                        parsed_result = json.loads(content)
                        print(f"✅ vLLM extraction successful (direct) for {phone_number}", file=sys.stderr)
                        return parsed_result
                except json.JSONDecodeError as e:
                    # If reasoning model, try to parse extracted data from reasoning text
                    if reasoning_content:
                        print(f"💭 Attempting to parse reasoning content", file=sys.stderr)
                        parsed_data = parse_reasoning_content(content)
                        if parsed_data:
                            print(f"✅ vLLM extraction from reasoning for {phone_number}", file=sys.stderr)
                            return parsed_data

                    print(f"❌ vLLM response not valid JSON", file=sys.stderr)
                    return None
        else:
            print(f"Enhanced OpenRouter API error: {response.status_code} - {response.text}", file=sys.stderr)
            return None

    except Exception as e:
        print(f"Enhanced OpenRouter extraction error: {e}", file=sys.stderr)
        return None


def extract_with_enhanced_openrouter(html_content, phone_number):
    """Use enhanced OpenRouter API prompt to extract all reputation data from HTML content"""
    try:
        # Get API credentials from environment
        api_key = os.getenv('OPENROUTER_API_KEY')
        model = os.getenv('OPENROUTER_MODEL', 'mistralai/mistral-7b-instruct:free')

        if not api_key:
            print("OpenRouter API key not found", file=sys.stderr)
            return None

        # Truncate HTML content to avoid token limits but keep more content
        max_content_length = 12000
        if len(html_content) > max_content_length:
            html_content = html_content[:max_content_length] + "..."

        # Enhanced prompt with specific instructions for RoboKiller data extraction
        prompt = f"""You are analyzing a RoboKiller phone number lookup page for the number {phone_number}.

Extract ALL available information from this RoboKiller page HTML content and return it in the specified JSON format.

HTML Content:
{html_content}

CRITICAL: Look for these specific data points in the page:

1. **User Reputation**: Look for text like "Positive", "Negative", "Neutral", or "Unknown" near reputation indicators
2. **RoboKiller Status**: Look for "Allowed", "Blocked", or "Unknown" status
3. **Last Call Date**: Find dates like "August 26, 2025" or similar date formats
4. **Total Calls**: Look for numbers near "Total calls" or "calls"
5. **User Reports**: Find numbers near "User reports" or "reports"
6. **Comments**: Count of comments on the number
7. **Caller Name**: Any business name or caller identification
8. **Location**: Geographic location data
9. **Carrier**: Phone carrier information

Pay special attention to:
- The visible text content, not just meta tags
- Numbers and statistics displayed prominently on the page
- Structured data sections showing call analytics
- Any reputation indicators or status badges

Return ONLY valid JSON with this exact structure:
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

EXAMPLE: If you see text like:
"Positive" under "User reputation"
"Allowed" under "Robokiller status"
"August 26, 2025" under "Last call"
"2" under "Total calls"
"0" under "User reports"

Then extract these exact values into the JSON structure.

Return ONLY the JSON, no other text or markdown formatting."""

        # Prepare the request to OpenRouter
        headers = {
            "Authorization": f"Bearer {api_key}",
            "HTTP-Referer": "https://api3.amdy.io",
            "X-Title": "DID Optimizer - Enhanced Phone Reputation Scanner",
            "Content-Type": "application/json"
        }

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

        # Make request to OpenRouter
        response = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers=headers,
            json=payload,
            timeout=45
        )

        if response.status_code == 200:
            response_data = response.json()
            if 'choices' in response_data and len(response_data['choices']) > 0:
                content = response_data['choices'][0]['message']['content'].strip()

                # Try to extract JSON from the response
                try:
                    # Handle markdown code blocks - look for JSON inside ```json blocks or standalone
                    if '```json' in content:
                        # Extract JSON from markdown code block
                        json_match = re.search(r'```json\s*(\{.*?\})\s*```', content, re.DOTALL)
                        if json_match:
                            parsed_result = json.loads(json_match.group(1))
                            print(f"✅ Enhanced OpenRouter extraction successful (markdown) for {phone_number}", file=sys.stderr)
                            return parsed_result

                    # Look for JSON pattern in the response
                    json_match = re.search(r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}', content, re.DOTALL)
                    if json_match:
                        parsed_result = json.loads(json_match.group(0))
                        print(f"✅ Enhanced OpenRouter extraction successful (pattern) for {phone_number}", file=sys.stderr)
                        return parsed_result
                    else:
                        # Try parsing the whole content as JSON
                        parsed_result = json.loads(content)
                        print(f"✅ Enhanced OpenRouter extraction successful (direct) for {phone_number}", file=sys.stderr)
                        return parsed_result
                except json.JSONDecodeError as e:
                    print(f"Enhanced OpenRouter response not valid JSON: {content}", file=sys.stderr)
                    return None
        else:
            print(f"Enhanced OpenRouter API error: {response.status_code} - {response.text}", file=sys.stderr)
            return None

    except Exception as e:
        print(f"Enhanced OpenRouter extraction error: {e}", file=sys.stderr)
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
        "carrier": None,
        "commentsCount": 0
    }

    # Enhanced reputation analysis with priority order and better patterns

    # 1. Look for explicit reputation status text
    reputation_patterns = [
        r'user\s+reputation[^>]*>\s*([^<]+)',
        r'reputation[^>]*>\s*(positive|negative|neutral|unknown)',
        r'<[^>]*>\s*(positive|negative|neutral)\s*<',
        r'(positive|negative|neutral|unknown)\s*user\s*reputation',
    ]

    for pattern in reputation_patterns:
        match = re.search(pattern, html_content, re.IGNORECASE)
        if match:
            status = match.group(1).strip().lower()
            if status in ['positive', 'negative', 'neutral', 'unknown']:
                data["reputationStatus"] = status.capitalize()
                break

    # 2. If no explicit pattern found, check meta description for "neutral"
    if data["reputationStatus"] == "Unknown" and 'og:description" content="neutral"' in html_content:
        data["reputationStatus"] = "Neutral"
        data["spamScore"] = 50

    # 3. Look for positive indicators
    elif data["reputationStatus"] == "Unknown" and any(indicator in html_content for indicator in ['safe', 'legitimate', 'verified', 'trusted', 'clean', 'good reputation']):
        data["reputationStatus"] = "Positive"
        data["spamScore"] = 25

    # 4. Look for negative indicators
    elif data["reputationStatus"] == "Unknown" and any(indicator in html_content for indicator in ['spam', 'scam', 'fraud', 'robocall', 'telemarketer', 'unwanted']):
        data["reputationStatus"] = "Negative"
        data["spamScore"] = 75

    # Extract RoboKiller status with better patterns
    robokiller_patterns = [
        r'robokiller\s+status[^>]*>\s*([^<]+)',
        r'status[^>]*>\s*(allowed|blocked)',
        r'(allowed|blocked)\s*robokiller\s*status',
    ]

    for pattern in robokiller_patterns:
        match = re.search(pattern, html_content, re.IGNORECASE)
        if match:
            status = match.group(1).strip().lower()
            if status in ['allowed', 'blocked']:
                data["robokillerStatus"] = status.capitalize()
                break

    # Extract numerical data with improved patterns
    reports_patterns = [
        r'user\s+reports[^>]*>\s*(\d+)',
        r'(\d+)\s*user\s*reports?',
        r'reports?[\'"]?\s*[:\-]\s*[\'"]?(\d+)',
    ]

    for pattern in reports_patterns:
        match = re.search(pattern, html_content, re.IGNORECASE)
        if match:
            data["userReports"] = int(match.group(1))
            break

    # Extract total calls with improved patterns
    calls_patterns = [
        r'total\s+calls[^>]*>\s*(\d+)',
        r'(\d+)\s*total\s*calls?',
        r'calls?[\'"]?\s*[:\-]\s*[\'"]?(\d+)',
    ]

    for pattern in calls_patterns:
        match = re.search(pattern, html_content, re.IGNORECASE)
        if match:
            data["totalCalls"] = int(match.group(1))
            break

    # Extract last call date with improved patterns
    date_patterns = [
        r'last\s+call[^>]*>\s*([^<]+)',
        r'((?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d+,?\s+\d{4})',
        r'(\d{1,2}/\d{1,2}/\d{2,4})',
        r'(\d{4}-\d{2}-\d{2})',
    ]

    for pattern in date_patterns:
        match = re.search(pattern, html_content, re.IGNORECASE)
        if match:
            data["lastCallDate"] = match.group(1).strip()
            break

    # Extract comments count
    comments_patterns = [
        r'comments?\s+(\d+)',
        r'(\d+)\s*comments?',
    ]

    for pattern in comments_patterns:
        match = re.search(pattern, html_content, re.IGNORECASE)
        if match:
            data["commentsCount"] = int(match.group(1))
            break

    return data

async def main():
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "Phone number required"}))
        sys.stdout.flush()
        return

    phone_number = sys.argv[1]
    proxy_url = None

    # Check for proxy parameter
    for arg in sys.argv[2:]:
        if arg.startswith('--proxy='):
            proxy_url = arg.split('=', 1)[1]
            break

    try:
        result = await scrape_robokiller_data(phone_number, proxy_url)
        print(json.dumps(result))
        sys.stdout.flush()
    except BrokenPipeError:
        # Handle EPIPE gracefully - output was already sent or pipe closed
        print(json.dumps({"success": False, "error": "BrokenPipeError in main", "method": "pipe_error"}), file=sys.stderr)
        sys.stderr.flush()
    except Exception as e:
        error_result = {
            "success": False,
            "error": f"Unhandled exception: {str(e)}",
            "method": "unhandled_exception"
        }
        print(json.dumps(error_result))
        sys.stdout.flush()

if __name__ == "__main__":
    # Handle broken pipe errors at the top level
    import signal
    signal.signal(signal.SIGPIPE, signal.SIG_DFL)

    try:
        asyncio.run(main())
    except BrokenPipeError:
        # Silently exit on broken pipe
        sys.exit(0)
    except KeyboardInterrupt:
        sys.exit(0)
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Fatal error: {str(e)}", "method": "fatal_error"}))
        sys.exit(1)