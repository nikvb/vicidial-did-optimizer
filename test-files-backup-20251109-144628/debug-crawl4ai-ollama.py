#!/usr/bin/env python3
"""
Debug Crawl4AI + Ollama integration step by step
"""

import asyncio
import json
import time

def log_step(step, message):
    timestamp = time.strftime("%H:%M:%S")
    print(f"[{timestamp}] {step}: {message}")

async def debug_crawl4ai_ollama():
    """Debug Crawl4AI with Ollama step by step"""

    log_step("INIT", "Starting Crawl4AI + Ollama debug")

    try:
        # Step 1: Import modules
        log_step("STEP1", "Importing Crawl4AI modules...")
        from crawl4ai import AsyncWebCrawler, LLMConfig
        from crawl4ai.extraction_strategy import LLMExtractionStrategy
        log_step("STEP1", "✅ Imports successful")

        # Step 2: Try different LLM configurations
        log_step("STEP2", "Testing LLM configurations...")

        # Option 1: New LLMConfig approach
        try:
            log_step("STEP2A", "Testing new LLMConfig approach...")
            llm_config = LLMConfig(
                provider="ollama/llama3.2:3b",
                base_url="http://localhost:11434"
            )

            extraction_strategy_new = LLMExtractionStrategy(
                llm_config=llm_config,
                schema={
                    "type": "object",
                    "properties": {
                        "test": {"type": "string", "description": "Test result"}
                    }
                },
                extraction_type="schema",
                instruction="Extract test result. Return JSON: {test: 'working'}",
                verbose=True
            )
            log_step("STEP2A", "✅ New LLMConfig created")

        except Exception as e:
            log_step("STEP2A", f"❌ New LLMConfig failed: {e}")
            extraction_strategy_new = None

        # Option 2: Legacy direct parameters
        try:
            log_step("STEP2B", "Testing legacy direct parameters...")
            extraction_strategy_legacy = LLMExtractionStrategy(
                provider="ollama/llama3.2:3b",
                base_url="http://localhost:11434",
                schema={
                    "type": "object",
                    "properties": {
                        "test": {"type": "string", "description": "Test result"}
                    }
                },
                extraction_type="schema",
                instruction="Extract test result. Return JSON: {test: 'working'}",
                verbose=True
            )
            log_step("STEP2B", "✅ Legacy config created")

        except Exception as e:
            log_step("STEP2B", f"❌ Legacy config failed: {e}")
            extraction_strategy_legacy = None

        # Step 3: Test with simple content
        log_step("STEP3", "Testing extraction with simple content...")

        async with AsyncWebCrawler(verbose=True, headless=True) as crawler:

            # Test with httpbin.org for simple content
            simple_url = "https://httpbin.org/json"
            log_step("STEP3", f"Testing URL: {simple_url}")

            # Try new config first
            if extraction_strategy_new:
                try:
                    log_step("STEP3A", "Testing new LLMConfig extraction...")
                    result = await crawler.arun(
                        url=simple_url,
                        extraction_strategy=extraction_strategy_new,
                        bypass_cache=True
                    )

                    log_step("STEP3A", f"Result success: {result.success}")
                    if result.success and result.extracted_content:
                        log_step("STEP3A", f"✅ Extracted: {result.extracted_content}")
                        return True
                    else:
                        log_step("STEP3A", "⚠️ No extraction result")

                except Exception as e:
                    log_step("STEP3A", f"❌ New config extraction failed: {e}")

            # Try legacy config
            if extraction_strategy_legacy:
                try:
                    log_step("STEP3B", "Testing legacy config extraction...")
                    result = await crawler.arun(
                        url=simple_url,
                        extraction_strategy=extraction_strategy_legacy,
                        bypass_cache=True
                    )

                    log_step("STEP3B", f"Result success: {result.success}")
                    if result.success and result.extracted_content:
                        log_step("STEP3B", f"✅ Extracted: {result.extracted_content}")
                        return True
                    else:
                        log_step("STEP3B", "⚠️ No extraction result")

                except Exception as e:
                    log_step("STEP3B", f"❌ Legacy config extraction failed: {e}")

        log_step("RESULT", "❌ No working configuration found")
        return False

    except Exception as e:
        log_step("ERROR", f"Fatal error: {e}")
        import traceback
        log_step("TRACE", traceback.format_exc())
        return False

async def main():
    log_step("START", "🔍 CRAWL4AI + OLLAMA DEBUG SESSION")
    log_step("START", "=" * 60)

    start_time = time.time()
    success = await debug_crawl4ai_ollama()
    end_time = time.time()

    duration = end_time - start_time
    log_step("END", "=" * 60)
    log_step("END", f"⏱️ Duration: {duration:.2f}s")
    log_step("END", f"🎯 Result: {'SUCCESS' if success else 'FAILED'}")

if __name__ == "__main__":
    asyncio.run(main())