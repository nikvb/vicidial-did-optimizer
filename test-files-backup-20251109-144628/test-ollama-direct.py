#!/usr/bin/env python3
"""
Test Ollama connection directly to understand how to integrate with Crawl4AI
"""

import json
import time
import requests

def test_ollama_connection():
    """Test direct connection to Ollama server"""
    print("🔗 Testing Ollama Connection...")

    try:
        # Test if Ollama server is running
        response = requests.get("http://localhost:11434/api/tags", timeout=5)
        if response.status_code == 200:
            data = response.json()
            models = [model['name'] for model in data.get('models', [])]
            print(f"✅ Ollama server running. Models: {models}")
            return True
        else:
            print(f"❌ Ollama server returned status {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Failed to connect to Ollama: {e}")
        return False

def test_ollama_chat():
    """Test Ollama chat functionality"""
    print("\n🤖 Testing Ollama Chat...")

    try:
        # Test simple chat request
        payload = {
            "model": "llama3.2:3b",
            "messages": [
                {
                    "role": "user",
                    "content": "Extract reputation from this text: 'Phone number 7193000078 has neutral reputation according to users.' Return only JSON: {\"reputation\": \"status\", \"phone\": \"number\"}"
                }
            ],
            "stream": False,
            "options": {
                "temperature": 0.1,
                "num_predict": 100
            }
        }

        start_time = time.time()
        response = requests.post(
            "http://localhost:11434/api/chat",
            json=payload,
            timeout=30
        )
        end_time = time.time()

        if response.status_code == 200:
            data = response.json()
            content = data.get('message', {}).get('content', '')
            duration = end_time - start_time

            print(f"✅ Chat successful ({duration:.2f}s)")
            print(f"📄 Response: {content}")

            # Try to extract JSON from response
            try:
                import re
                json_match = re.search(r'\{.*\}', content, re.DOTALL)
                if json_match:
                    extracted_json = json.loads(json_match.group())
                    print(f"📊 Extracted JSON: {extracted_json}")
                    return True
                else:
                    print("⚠️ No JSON found in response")
            except Exception as e:
                print(f"⚠️ Failed to parse JSON: {e}")

            return True
        else:
            print(f"❌ Chat failed with status {response.status_code}")
            print(f"❌ Response: {response.text}")
            return False

    except Exception as e:
        print(f"❌ Chat request failed: {e}")
        return False

def main():
    print("🧪 OLLAMA DIRECT CONNECTION TEST")
    print("=" * 50)

    # Test 1: Server connection
    connection_ok = test_ollama_connection()

    if connection_ok:
        # Test 2: Chat functionality
        chat_ok = test_ollama_chat()

        print("\n" + "=" * 50)
        print(f"🎯 Connection Test: {'PASSED' if connection_ok else 'FAILED'}")
        print(f"🎯 Chat Test: {'PASSED' if chat_ok else 'FAILED'}")

        if connection_ok and chat_ok:
            print("✅ Ollama is ready for Crawl4AI integration!")
        else:
            print("❌ Ollama has issues that need to be resolved")
    else:
        print("\n❌ Cannot proceed - Ollama server not accessible")

if __name__ == "__main__":
    main()