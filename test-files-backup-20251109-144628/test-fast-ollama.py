#!/usr/bin/env python3
"""
Test the faster 1B model with Crawl4AI
"""

import asyncio
import time

def log_step(step, message):
    timestamp = time.strftime("%H:%M:%S")
    print(f"[{timestamp}] {step}: {message}")

async def test_fast_ollama():
    """Test with the smaller, faster model"""

    log_step("START", "Testing llama3.2:1b (faster model)...")

    try:
        from crawl4ai import AsyncWebCrawler, LLMConfig
        from crawl4ai.extraction_strategy import LLMExtractionStrategy

        # Use the smaller, faster model
        llm_config = LLMConfig(
            provider="ollama/llama3.2:1b",
            base_url="http://localhost:11434"
        )

        extraction_strategy = LLMExtractionStrategy(
            llm_config=llm_config,
            schema={
                "type": "object",
                "properties": {
                    "reputation": {"type": "string", "description": "Phone reputation: Positive, Negative, Neutral, or Unknown"},
                    "score": {"type": "number", "description": "Spam score 0-100"}
                }
            },
            extraction_type="schema",
            instruction="Analyze this content for phone reputation. Return JSON with reputation status and score.",
            verbose=True
        )

        log_step("CONFIG", "Using llama3.2:1b model for faster responses")

        async with AsyncWebCrawler(verbose=True, headless=True) as crawler:

            # Test with actual RoboKiller page
            phone_number = "7193000078"
            url = f"https://lookup.robokiller.com/search?q={phone_number}"

            log_step("TEST", f"Testing with RoboKiller URL: {url}")

            start_time = time.time()
            result = await crawler.arun(
                url=url,
                extraction_strategy=extraction_strategy,
                bypass_cache=True
            )
            end_time = time.time()
            duration = end_time - start_time

            log_step("RESULT", f"Duration: {duration:.2f}s")
            log_step("RESULT", f"Success: {result.success}")
            log_step("RESULT", f"HTML length: {len(result.html) if result.html else 0}")

            if result.success and result.extracted_content:
                log_step("SUCCESS", f"✅ LLM Extraction: {result.extracted_content}")
                return True
            else:
                log_step("FAILED", f"❌ No LLM extraction result")
                return False

    except Exception as e:
        log_step("ERROR", f"Error: {e}")
        import traceback
        log_step("TRACE", traceback.format_exc())
        return False

async def main():
    log_step("START", "🚀 FAST OLLAMA MODEL TEST")
    log_step("START", "=" * 60)

    start_time = time.time()
    success = await test_fast_ollama()
    end_time = time.time()

    duration = end_time - start_time
    log_step("END", "=" * 60)
    log_step("END", f"⏱️ Total Duration: {duration:.2f}s")
    log_step("END", f"🎯 Result: {'SUCCESS - LLM WORKING!' if success else 'FAILED - Using fallback'}")

if __name__ == "__main__":
    asyncio.run(main())