#!/usr/bin/env python3
"""
Test different Ollama URL formats and configurations with Crawl4AI
"""

import asyncio
import time

def log_step(step, message):
    timestamp = time.strftime("%H:%M:%S")
    print(f"[{timestamp}] {step}: {message}")

async def test_ollama_formats():
    """Test different Ollama configurations"""

    log_step("START", "Testing different Ollama configurations...")

    from crawl4ai import AsyncWebCrawler, LLMConfig
    from crawl4ai.extraction_strategy import LLMExtractionStrategy

    # Different URL formats to try
    configs_to_test = [
        {
            "name": "Standard format",
            "provider": "ollama/llama3.2:3b",
            "base_url": "http://localhost:11434"
        },
        {
            "name": "Without http://",
            "provider": "ollama/llama3.2:3b",
            "base_url": "localhost:11434"
        },
        {
            "name": "With /v1 endpoint",
            "provider": "ollama/llama3.2:3b",
            "base_url": "http://localhost:11434/v1"
        },
        {
            "name": "With /api endpoint",
            "provider": "ollama/llama3.2:3b",
            "base_url": "http://localhost:11434/api"
        },
        {
            "name": "Simple model name",
            "provider": "llama3.2:3b",
            "base_url": "http://localhost:11434"
        },
        {
            "name": "Different port format",
            "provider": "ollama/llama3.2:3b",
            "base_url": "http://127.0.0.1:11434"
        }
    ]

    async with AsyncWebCrawler(verbose=False, headless=True) as crawler:

        for i, config in enumerate(configs_to_test, 1):
            log_step(f"TEST{i}", f"Testing: {config['name']}")
            log_step(f"TEST{i}", f"Provider: {config['provider']}")
            log_step(f"TEST{i}", f"Base URL: {config['base_url']}")

            try:
                # Create LLM config
                llm_config = LLMConfig(
                    provider=config['provider'],
                    base_url=config['base_url']
                )

                # Create extraction strategy with very simple schema
                extraction_strategy = LLMExtractionStrategy(
                    llm_config=llm_config,
                    schema={
                        "type": "object",
                        "properties": {
                            "result": {"type": "string", "description": "Simple result"}
                        }
                    },
                    extraction_type="schema",
                    instruction="Return JSON: {\"result\": \"success\"}",
                    verbose=True
                )

                # Test with simple content
                start_time = time.time()
                result = await crawler.arun(
                    url="https://httpbin.org/json",
                    extraction_strategy=extraction_strategy,
                    bypass_cache=True
                )
                end_time = time.time()
                duration = end_time - start_time

                log_step(f"TEST{i}", f"Duration: {duration:.2f}s")
                log_step(f"TEST{i}", f"Success: {result.success}")

                if result.success and result.extracted_content:
                    log_step(f"TEST{i}", f"✅ WORKING! Extracted: {result.extracted_content}")
                    return config
                else:
                    log_step(f"TEST{i}", f"❌ No extraction result")

            except Exception as e:
                log_step(f"TEST{i}", f"❌ Error: {e}")

            log_step(f"TEST{i}", "-" * 50)

    log_step("RESULT", "❌ No working configuration found")
    return None

async def main():
    log_step("START", "🔍 OLLAMA CONFIGURATION TESTING")
    log_step("START", "=" * 60)

    start_time = time.time()
    working_config = await test_ollama_formats()
    end_time = time.time()

    duration = end_time - start_time
    log_step("END", "=" * 60)
    log_step("END", f"⏱️ Total Duration: {duration:.2f}s")

    if working_config:
        log_step("END", f"🎯 Working Config: {working_config}")
    else:
        log_step("END", "🎯 No working configuration found")

if __name__ == "__main__":
    asyncio.run(main())