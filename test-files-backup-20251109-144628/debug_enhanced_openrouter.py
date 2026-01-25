#!/usr/bin/env python3
"""
Debug the enhanced OpenRouter extraction to see what's going wrong
"""
import asyncio
import json
import sys
import re
import os
import requests
from crawl4ai import AsyncWebCrawler

async def debug_enhanced_extraction(phone_number):
    """Debug enhanced OpenRouter extraction with visible text focus"""
    clean_number = re.sub(r'\D', '', phone_number)
    url = f"https://lookup.robokiller.com/search?q={clean_number}"

    print(f"🔍 Testing Enhanced OpenRouter for: {phone_number}")
    print(f"🌐 URL: {url}")
    print("=" * 80)

    async with AsyncWebCrawler(verbose=False, headless=True) as crawler:
        result = await crawler.arun(
            url=url,
            bypass_cache=True,
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )

        if result.success:
            print(f"✅ Crawl successful - HTML length: {len(result.html)} chars")

            # Let's extract the visible text more carefully
            # Remove scripts, styles, and extract clean visible text
            html_cleaned = re.sub(r'<script[^>]*>.*?</script>', '', result.html, flags=re.DOTALL | re.IGNORECASE)
            html_cleaned = re.sub(r'<style[^>]*>.*?</style>', '', html_cleaned, flags=re.DOTALL | re.IGNORECASE)

            # Extract text content
            text_content = re.sub(r'<[^>]+>', ' ', html_cleaned)
            text_content = re.sub(r'\s+', ' ', text_content).strip()

            print("📄 Visible Text Content Preview:")
            print("-" * 40)
            print(text_content[:2000])
            print("\n" + "=" * 80)

            # Let's use this cleaned visible text for OpenRouter
            api_key = os.getenv('OPENROUTER_API_KEY', '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')
            model = os.getenv('OPENROUTER_MODEL', 'mistralai/mistral-7b-instruct:free')

            # Use visible text instead of raw HTML for better extraction
            max_content_length = 10000
            content_to_analyze = text_content
            if len(content_to_analyze) > max_content_length:
                content_to_analyze = content_to_analyze[:max_content_length] + "..."

            # Enhanced prompt focused on visible text
            prompt = f"""You are analyzing visible text content from a RoboKiller phone number lookup page for {phone_number}.

VISIBLE TEXT CONTENT:
{content_to_analyze}

Extract ALL phone reputation data from this text. I can see these specific sections in the content:

Look for:
1. User reputation status (look for words like "Positive", "Negative", "Neutral")
2. RoboKiller status (look for "Allowed" or "Blocked")
3. Analytics section with dates and numbers
4. Call statistics
5. User reports count
6. Comments count

From the visible text, extract and return JSON:

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

CRITICAL: Focus on the visible text content, not HTML meta tags.
If you see "Positive" in the text near "User reputation", use "Positive".
If you see "Allowed" near "Robokiller status", use "Allowed".
Extract any dates, numbers, and statistics you find.

Return ONLY the JSON."""

            print("🤖 ENHANCED PROMPT:")
            print("-" * 40)
            print(prompt[:1500] + "..." if len(prompt) > 1500 else prompt)
            print("\n" + "=" * 80)

            # Make request to OpenRouter
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

            print(f"🚀 Making Enhanced Request to OpenRouter with model: {model}")

            response = requests.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers=headers,
                json=payload,
                timeout=45
            )

            print(f"📊 Response Status: {response.status_code}")

            if response.status_code == 200:
                response_data = response.json()
                print("✅ ENHANCED OPENROUTER RESPONSE:")
                print("-" * 40)
                print(json.dumps(response_data, indent=2))
                print("\n" + "=" * 80)

                if 'choices' in response_data and len(response_data['choices']) > 0:
                    content = response_data['choices'][0]['message']['content'].strip()
                    print("🎯 ENHANCED EXTRACTED CONTENT:")
                    print("-" * 40)
                    print(content)
                    print("\n" + "=" * 80)

                    # Try to parse as JSON
                    try:
                        json_match = re.search(r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}', content, re.DOTALL)
                        if json_match:
                            parsed_json = json.loads(json_match.group(0))
                            print("✅ ENHANCED FINAL PARSED JSON:")
                            print("-" * 40)
                            print(json.dumps(parsed_json, indent=2))
                            return parsed_json
                        else:
                            try:
                                parsed_json = json.loads(content)
                                print("✅ ENHANCED FINAL PARSED JSON (direct):")
                                print("-" * 40)
                                print(json.dumps(parsed_json, indent=2))
                                return parsed_json
                            except:
                                print("❌ Could not parse enhanced response as JSON")
                                return None
                    except json.JSONDecodeError as e:
                        print(f"❌ Enhanced JSON Parse Error: {e}")
                        return None
            else:
                print(f"❌ Enhanced OpenRouter API error: {response.status_code}")
                print(response.text)
                return None
        else:
            print(f"❌ Crawl failed: {result.error_message}")
            return None

async def main():
    phone_number = "2255777553"
    result = await debug_enhanced_extraction(phone_number)

    if result:
        print("\n" + "=" * 80)
        print("🎉 ENHANCED SUCCESS - Final extracted data:")
        print(json.dumps(result, indent=2))
    else:
        print("\n" + "=" * 80)
        print("❌ ENHANCED FAILED - No data extracted")

if __name__ == "__main__":
    asyncio.run(main())