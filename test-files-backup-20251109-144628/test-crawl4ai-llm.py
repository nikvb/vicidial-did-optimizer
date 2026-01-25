#!/usr/bin/env python3
"""
Test Crawl4AI with LLM extraction strategy step by step
"""

import asyncio
import sys
import time
import json

def log_with_time(message):
    timestamp = time.strftime("%H:%M:%S")
    print(f"[{timestamp}] {message}")

async def test_crawl4ai_with_llm():
    log_with_time("🔧 Starting Crawl4AI + LLM test...")

    try:
        log_with_time("📦 Step 1: Importing required modules...")
        from crawl4ai import AsyncWebCrawler, LLMConfig
        from crawl4ai.extraction_strategy import LLMExtractionStrategy
        log_with_time("✅ Step 1: Imports successful")

        log_with_time("🤖 Step 2: Creating LLM extraction strategy...")
        llm_config = LLMConfig(
            provider="ollama/llama3.2:3b",
            base_url="http://localhost:11434"
        )

        extraction_strategy = LLMExtractionStrategy(
            llm_config=llm_config,
            schema={
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Page title"},
                    "status": {"type": "string", "description": "Test status"}
                }
            },
            extraction_type="schema",
            instruction="Extract the title and set status to 'working'"
        )
        log_with_time("✅ Step 2: LLM strategy created")

        log_with_time("🕷️ Step 3: Creating crawler with LLM...")
        async with AsyncWebCrawler(verbose=True, headless=True) as crawler:
            log_with_time("✅ Step 3: Crawler ready")

            log_with_time("🌐 Step 4: Testing simple page with LLM extraction...")
            result = await crawler.arun(
                url="https://httpbin.org/json",
                extraction_strategy=extraction_strategy,
                bypass_cache=True
            )
            log_with_time("✅ Step 4: Request completed")

            log_with_time(f"📊 Result success: {result.success}")
            if result.success:
                log_with_time(f"📄 HTML length: {len(result.html)} chars")
                if result.extracted_content:
                    log_with_time(f"🤖 LLM extraction: {result.extracted_content}")
                    try:
                        parsed = json.loads(result.extracted_content)
                        log_with_time(f"✅ Valid JSON extracted: {parsed}")
                    except:
                        log_with_time("⚠️ LLM output is not valid JSON")
                else:
                    log_with_time("⚠️ No LLM extraction result")
            else:
                log_with_time(f"❌ Error: {result.error_message}")

        log_with_time("🏁 LLM test completed!")
        return True

    except Exception as e:
        log_with_time(f"❌ Error during LLM test: {e}")
        log_with_time(f"❌ Error type: {type(e).__name__}")
        import traceback
        log_with_time(f"❌ Traceback: {traceback.format_exc()}")
        return False

async def test_robokiller_page():
    log_with_time("🎯 Testing RoboKiller page...")

    try:
        from crawl4ai import AsyncWebCrawler

        phone_number = "7193000078"
        url = f"https://lookup.robokiller.com/search?q={phone_number}"

        log_with_time(f"🌐 Testing URL: {url}")

        async with AsyncWebCrawler(verbose=True, headless=True) as crawler:
            result = await crawler.arun(
                url=url,
                bypass_cache=True,
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            )

            log_with_time(f"📊 RoboKiller result success: {result.success}")
            if result.success:
                log_with_time(f"📄 HTML length: {len(result.html)} chars")

                # Check for key patterns
                html_lower = result.html.lower()
                patterns = {
                    "neutral_meta": 'og:description" content="neutral"' in html_lower,
                    "spam": "spam" in html_lower,
                    "scam": "scam" in html_lower,
                    "safe": "safe" in html_lower
                }

                log_with_time(f"🔍 Pattern analysis: {patterns}")
            else:
                log_with_time(f"❌ RoboKiller error: {result.error_message}")

        return True

    except Exception as e:
        log_with_time(f"❌ RoboKiller test error: {e}")
        return False

def main():
    log_with_time("🧪 CRAWL4AI + LLM DETAILED TEST")
    log_with_time("=" * 60)

    start_time = time.time()

    try:
        # Test 1: Basic LLM functionality
        log_with_time("🔬 TEST 1: Basic LLM Extraction")
        result1 = asyncio.run(test_crawl4ai_with_llm())

        log_with_time("\n" + "=" * 60)

        # Test 2: RoboKiller page
        log_with_time("🔬 TEST 2: RoboKiller Page")
        result2 = asyncio.run(test_robokiller_page())

        end_time = time.time()
        duration = end_time - start_time

        log_with_time("=" * 60)
        log_with_time(f"⏱️ Total duration: {duration:.2f} seconds")
        log_with_time(f"🎯 LLM Test: {'SUCCESS' if result1 else 'FAILED'}")
        log_with_time(f"🎯 RoboKiller Test: {'SUCCESS' if result2 else 'FAILED'}")

        sys.exit(0 if (result1 and result2) else 1)

    except KeyboardInterrupt:
        log_with_time("⏹️ Test interrupted by user")
        sys.exit(1)
    except Exception as e:
        log_with_time(f"💥 Fatal error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()