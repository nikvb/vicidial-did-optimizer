#!/usr/bin/env python3
"""
Simple Crawl4AI initialization test to identify issues
"""

import asyncio
import sys
import time

def log_with_time(message):
    timestamp = time.strftime("%H:%M:%S")
    print(f"[{timestamp}] {message}")

async def test_crawl4ai_init():
    log_with_time("🔧 Starting Crawl4AI initialization test...")

    try:
        log_with_time("📦 Step 1: Importing crawl4ai...")
        from crawl4ai import AsyncWebCrawler
        log_with_time("✅ Step 1: Import successful")

        log_with_time("🕷️ Step 2: Creating AsyncWebCrawler instance...")
        crawler = AsyncWebCrawler(verbose=True, headless=True)
        log_with_time("✅ Step 2: Instance created")

        log_with_time("🔗 Step 3: Testing async context manager...")
        async with crawler:
            log_with_time("✅ Step 3: Context manager entered")

            log_with_time("🌐 Step 4: Testing simple web request...")
            result = await crawler.arun(
                url="https://httpbin.org/json",
                bypass_cache=True
            )
            log_with_time("✅ Step 4: Web request completed")

            log_with_time(f"📊 Result success: {result.success}")
            if result.success:
                log_with_time(f"📄 Content length: {len(result.html)} chars")
            else:
                log_with_time(f"❌ Error: {result.error_message}")

        log_with_time("🏁 Test completed successfully!")
        return True

    except ImportError as e:
        log_with_time(f"❌ Import Error: {e}")
        return False
    except Exception as e:
        log_with_time(f"❌ Error during test: {e}")
        log_with_time(f"❌ Error type: {type(e).__name__}")
        import traceback
        log_with_time(f"❌ Traceback: {traceback.format_exc()}")
        return False

def main():
    log_with_time("🧪 CRAWL4AI INITIALIZATION TEST")
    log_with_time("=" * 50)

    start_time = time.time()

    try:
        result = asyncio.run(test_crawl4ai_init())
        end_time = time.time()
        duration = end_time - start_time

        log_with_time("=" * 50)
        log_with_time(f"⏱️ Total duration: {duration:.2f} seconds")
        log_with_time(f"🎯 Result: {'SUCCESS' if result else 'FAILED'}")

        sys.exit(0 if result else 1)

    except KeyboardInterrupt:
        log_with_time("⏹️ Test interrupted by user")
        sys.exit(1)
    except Exception as e:
        log_with_time(f"💥 Fatal error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()