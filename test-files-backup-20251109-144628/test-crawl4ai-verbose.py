#!/usr/bin/env python3
"""
Test Crawl4AI with maximum verbosity to debug Ollama communication
"""

import asyncio
import logging
import time

# Enable detailed logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

def log_step(step, message):
    timestamp = time.strftime("%H:%M:%S")
    print(f"[{timestamp}] {step}: {message}")

async def test_verbose_crawl4ai():
    """Test with maximum verbosity enabled"""

    log_step("START", "Starting verbose Crawl4AI test...")

    try:
        from crawl4ai import AsyncWebCrawler, LLMConfig
        from crawl4ai.extraction_strategy import LLMExtractionStrategy

        # Create simple LLM config
        llm_config = LLMConfig(
            provider="ollama/llama3.2:3b",
            base_url="http://localhost:11434"
        )

        extraction_strategy = LLMExtractionStrategy(
            llm_config=llm_config,
            schema={
                "type": "object",
                "properties": {
                    "message": {"type": "string", "description": "Simple message"}
                }
            },
            extraction_type="schema",
            instruction="Return JSON with message 'hello'",
            verbose=True  # Enable verbose mode
        )

        log_step("TEST", "Creating AsyncWebCrawler with verbose=True...")

        async with AsyncWebCrawler(verbose=True, headless=True) as crawler:
            log_step("TEST", "Running extraction with debug logging...")

            # Test with a simple page that has minimal content
            result = await crawler.arun(
                url="https://httpbin.org/json",
                extraction_strategy=extraction_strategy,
                bypass_cache=True
            )

            log_step("RESULT", f"Success: {result.success}")
            log_step("RESULT", f"HTML length: {len(result.html) if result.html else 0}")
            log_step("RESULT", f"Markdown length: {len(result.markdown) if result.markdown else 0}")
            log_step("RESULT", f"Extracted content: {result.extracted_content}")
            log_step("RESULT", f"Error message: {result.error_message}")

            # Check if we have any extraction logs or details
            if hasattr(result, 'extraction_logs'):
                log_step("LOGS", f"Extraction logs: {result.extraction_logs}")

            return result.extracted_content is not None

    except Exception as e:
        log_step("ERROR", f"Error: {e}")
        import traceback
        log_step("TRACE", traceback.format_exc())
        return False

async def main():
    log_step("START", "🔍 VERBOSE CRAWL4AI + OLLAMA TEST")
    log_step("START", "=" * 60)

    start_time = time.time()
    success = await test_verbose_crawl4ai()
    end_time = time.time()

    duration = end_time - start_time
    log_step("END", "=" * 60)
    log_step("END", f"⏱️ Duration: {duration:.2f}s")
    log_step("END", f"🎯 Result: {'SUCCESS' if success else 'FAILED'}")

if __name__ == "__main__":
    asyncio.run(main())