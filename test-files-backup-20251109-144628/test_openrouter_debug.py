#!/usr/bin/env python3
"""
Debug script to show exact OpenRouter prompt and response
"""
import asyncio
import json
import sys
import re
import os
import requests
from crawl4ai import AsyncWebCrawler

async def debug_openrouter_extraction(phone_number):
    """Debug OpenRouter extraction with full details"""
    clean_number = re.sub(r'\D', '', phone_number)
    url = f"https://lookup.robokiller.com/search?q={clean_number}"

    print(f"🔍 Testing URL: {url}")
    print("=" * 80)

    async with AsyncWebCrawler(verbose=False, headless=True) as crawler:
        result = await crawler.arun(
            url=url,
            bypass_cache=True,
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )

        if result.success:
            print(f"✅ Crawl successful - HTML length: {len(result.html)} chars")
            print("=" * 80)

            # Show first 2000 chars of HTML to understand content
            print("📄 HTML Content Preview:")
            print(result.html[:2000])
            print("\n" + "=" * 80)

            # Try OpenRouter extraction with debug
            api_key = os.getenv('OPENROUTER_API_KEY', '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')
            model = os.getenv('OPENROUTER_MODEL', 'mistralai/mistral-7b-instruct:free')

            # Truncate HTML content to avoid token limits
            max_content_length = 8000
            html_content = result.html
            if len(html_content) > max_content_length:
                html_content = html_content[:max_content_length] + "..."

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

            print("🤖 PROMPT SENT TO OPENROUTER:")
            print("-" * 40)
            print(prompt[:1000] + "..." if len(prompt) > 1000 else prompt)
            print("\n" + "=" * 80)

            # Prepare the request to OpenRouter
            headers = {
                "Authorization": f"Bearer {api_key}",
                "HTTP-Referer": "https://api3.amdy.io",
                "X-Title": "DID Optimizer - Phone Reputation Scanner",
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
                "max_tokens": 500
            }

            print(f"🚀 Making request to OpenRouter API with model: {model}")

            # Make request to OpenRouter
            response = requests.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers=headers,
                json=payload,
                timeout=30
            )

            print(f"📊 Response Status: {response.status_code}")

            if response.status_code == 200:
                response_data = response.json()
                print("✅ OPENROUTER RESPONSE:")
                print("-" * 40)
                print(json.dumps(response_data, indent=2))
                print("\n" + "=" * 80)

                if 'choices' in response_data and len(response_data['choices']) > 0:
                    content = response_data['choices'][0]['message']['content'].strip()
                    print("🎯 EXTRACTED CONTENT:")
                    print("-" * 40)
                    print(content)
                    print("\n" + "=" * 80)

                    # Try to parse as JSON
                    try:
                        json_match = re.search(r'\{.*\}', content, re.DOTALL)
                        if json_match:
                            parsed_json = json.loads(json_match.group(0))
                            print("✅ FINAL PARSED JSON:")
                            print("-" * 40)
                            print(json.dumps(parsed_json, indent=2))
                            return parsed_json
                        else:
                            try:
                                parsed_json = json.loads(content)
                                print("✅ FINAL PARSED JSON (direct):")
                                print("-" * 40)
                                print(json.dumps(parsed_json, indent=2))
                                return parsed_json
                            except:
                                print("❌ Could not parse response as JSON")
                                return None
                    except json.JSONDecodeError as e:
                        print(f"❌ JSON Parse Error: {e}")
                        return None
            else:
                print(f"❌ OpenRouter API error: {response.status_code}")
                print(response.text)
                return None
        else:
            print(f"❌ Crawl failed: {result.error_message}")
            return None

async def main():
    phone_number = "2255777553"
    print(f"🔍 DEBUGGING OPENROUTER EXTRACTION FOR: {phone_number}")
    print("=" * 80)

    result = await debug_openrouter_extraction(phone_number)

    if result:
        print("\n" + "=" * 80)
        print("🎉 SUCCESS - Final extracted data:")
        print(json.dumps(result, indent=2))
    else:
        print("\n" + "=" * 80)
        print("❌ FAILED - No data extracted")

if __name__ == "__main__":
    asyncio.run(main())