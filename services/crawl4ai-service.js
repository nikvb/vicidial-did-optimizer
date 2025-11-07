import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import webshareProxyService from './webshare-proxy-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class Crawl4AIService {
  constructor() {
    this.pythonScript = path.join(__dirname, '..', 'scripts', 'enhanced_openrouter_scraper.py');
    this.isReady = false;
    this.init();
  }

  async init() {
    try {
      // Using pre-built enhanced script with OpenRouter integration
      await webshareProxyService.initialize();
      this.isReady = true;
      console.log('✅ Crawl4AI service initialized with OpenRouter + proxy rotation');
    } catch (error) {
      console.error('❌ Failed to initialize Crawl4AI service:', error);
    }
  }

  async ensurePythonScript() {
    const scriptsDir = path.join(__dirname, '..', 'scripts');

    try {
      await fs.access(scriptsDir);
    } catch {
      await fs.mkdir(scriptsDir, { recursive: true });
    }

    const pythonScriptContent = `#!/usr/bin/env python3
import asyncio
import json
import sys
import re
from crawl4ai import AsyncWebCrawler
from crawl4ai.extraction_strategy import LLMExtractionStrategy
from crawl4ai.chunking_strategy import RegexChunking

async def scrape_robokiller_data(phone_number):
    """Scrape RoboKiller reputation data for a phone number"""
    clean_number = re.sub(r'\\D', '', phone_number)
    url = f"https://lookup.robokiller.com/search?q={clean_number}"

    async with AsyncWebCrawler(verbose=False, headless=True) as crawler:
        try:
            # Define extraction strategy for reputation data
            extraction_strategy = LLMExtractionStrategy(
                provider="ollama/llama2",  # Fallback to basic extraction if no LLM
                api_token="",
                schema={
                    "type": "object",
                    "properties": {
                        "userReports": {"type": "number", "description": "Number of user reports"},
                        "reputationStatus": {"type": "string", "description": "Reputation status: Positive, Negative, Neutral, or Unknown"},
                        "totalCalls": {"type": "number", "description": "Total number of calls"},
                        "lastCallDate": {"type": "string", "description": "Date of last call"},
                        "robokillerStatus": {"type": "string", "description": "RoboKiller status: Allowed, Blocked, or Unknown"},
                        "spamScore": {"type": "number", "description": "Spam score percentage"},
                        "callerName": {"type": "string", "description": "Caller name if available"},
                        "location": {"type": "string", "description": "Location information"},
                        "carrier": {"type": "string", "description": "Phone carrier information"}
                    }
                },
                extraction_type="schema",
                instruction="Extract phone number reputation data from the RoboKiller lookup page"
            )

            # Crawl the page
            result = await crawler.arun(
                url=url,
                extraction_strategy=extraction_strategy,
                bypass_cache=True,
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            )

            if result.success:
                # Try to extract using LLM first
                if result.extracted_content:
                    try:
                        extracted_data = json.loads(result.extracted_content)
                        return {
                            "success": True,
                            "data": extracted_data,
                            "method": "llm_extraction"
                        }
                    except:
                        pass

                # Fallback to regex extraction from HTML
                html_content = result.html
                data = extract_with_regex(html_content)
                return {
                    "success": True,
                    "data": data,
                    "method": "regex_extraction"
                }
            else:
                return {
                    "success": False,
                    "error": f"Failed to crawl {url}: {result.error_message}",
                    "method": "crawl_failed"
                }

        except Exception as e:
            return {
                "success": False,
                "error": str(e),
                "method": "exception"
            }

def extract_with_regex(html_content):
    """Extract reputation data using regex patterns"""
    data = {
        "userReports": 0,
        "reputationStatus": "Unknown",
        "totalCalls": 0,
        "lastCallDate": None,
        "robokillerStatus": "Unknown",
        "spamScore": None,
        "callerName": None,
        "location": None,
        "carrier": None
    }

    # Extract reputation status
    reputation_patterns = [
        r'reputation["\']?\\s*[:\-]\\s*["\']?(positive|negative|neutral)',
        r'class=["\']reputation["\'][^>]*>\\s*(positive|negative|neutral)',
        r'reputation-value["\'][^>]*>\\s*(positive|negative|neutral)'
    ]

    for pattern in reputation_patterns:
        match = re.search(pattern, html_content, re.IGNORECASE)
        if match:
            status = match.group(1).lower()
            data["reputationStatus"] = status.capitalize()
            break

    # Extract RoboKiller status
    status_patterns = [
        r'robokiller["\']?\\s*[:\-]\\s*["\']?(allowed|blocked)',
        r'status["\']?\\s*[:\-]\\s*["\']?(allowed|blocked)',
        r'class=["\']status["\'][^>]*>\\s*(allowed|blocked)'
    ]

    for pattern in status_patterns:
        match = re.search(pattern, html_content, re.IGNORECASE)
        if match:
            status = match.group(1).lower()
            data["robokillerStatus"] = status.capitalize()
            break

    # Extract user reports
    reports_patterns = [
        r'user[\\s\\-]?reports?["\']?\\s*[:\-]\\s*["\']?(\\d+)',
        r'reports?["\']?\\s*[:\-]\\s*["\']?(\\d+)',
        r'(\\d+)\\s*reports?'
    ]

    for pattern in reports_patterns:
        match = re.search(pattern, html_content, re.IGNORECASE)
        if match:
            data["userReports"] = int(match.group(1))
            break

    # Extract total calls
    calls_patterns = [
        r'total[\\s\\-]?calls?["\']?\\s*[:\-]\\s*["\']?(\\d+)',
        r'calls?["\']?\\s*[:\-]\\s*["\']?(\\d+)',
        r'(\\d+)\\s*calls?'
    ]

    for pattern in calls_patterns:
        match = re.search(pattern, html_content, re.IGNORECASE)
        if match:
            data["totalCalls"] = int(match.group(1))
            break

    # Extract last call date
    date_patterns = [
        r'last[\\s\\-]?call["\']?\\s*[:\-]\\s*["\']?([^<>"\\n]+)',
        r'(\\w+\\s+\\d+,\\s+\\d{4})',
        r'(\\d{1,2}/\\d{1,2}/\\d{2,4})'
    ]

    for pattern in date_patterns:
        match = re.search(pattern, html_content, re.IGNORECASE)
        if match:
            data["lastCallDate"] = match.group(1).strip()
            break

    # Extract spam score
    spam_patterns = [
        r'spam[\\s\\-]?score["\']?\\s*[:\-]\\s*["\']?(\\d+)',
        r'(\\d+)%?\\s*spam'
    ]

    for pattern in spam_patterns:
        match = re.search(pattern, html_content, re.IGNORECASE)
        if match:
            data["spamScore"] = int(match.group(1))
            break

    return data

async def main():
    if len(sys.argv) != 2:
        print(json.dumps({"success": False, "error": "Phone number required"}))
        return

    phone_number = sys.argv[1]
    result = await scrape_robokiller_data(phone_number)
    print(json.dumps(result))

if __name__ == "__main__":
    asyncio.run(main())
`;

    await fs.writeFile(this.pythonScript, pythonScriptContent);
    await fs.chmod(this.pythonScript, '755');
  }

  async scrapeRoboKillerData(phoneNumber, useProxy = true) {
    if (!this.isReady) {
      throw new Error('Crawl4AI service not ready');
    }

    let proxy = null;
    let proxyId = null;

    if (useProxy) {
      try {
        proxy = await webshareProxyService.getRandomProxy();
        proxyId = proxy.id;
        console.log(`🌐 Using proxy: ${proxy.country}/${proxy.city} - ${proxy.host}:${proxy.port}`);
      } catch (error) {
        console.warn('⚠️ Failed to get proxy, proceeding without proxy:', error.message);
      }
    }

    return new Promise((resolve, reject) => {
      const args = [this.pythonScript, phoneNumber];
      if (proxy) {
        args.push(`--proxy=${proxy.proxyUrl}`);
      }

      const python = spawn('python3', args, {
        env: {
          ...process.env,
          OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
          OPENROUTER_MODEL: process.env.OPENROUTER_MODEL
        }
      });
      let stdout = '';
      let stderr = '';

      python.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      python.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      python.on('close', (code) => {
        if (code !== 0) {
          console.error(`Python script error (${code}):`, stderr);
          if (proxyId) {
            webshareProxyService.markProxyError(proxyId);
          }
          reject(new Error(`Crawl4AI script failed with code ${code}: ${stderr}`));
          return;
        }

        try {
          // Extract JSON from stdout (handle debug output pollution)
          const lines = stdout.split('\n');
          const jsonLine = lines.find(line => line.startsWith('{') && line.includes('"success"'));

          if (!jsonLine) {
            throw new Error('No JSON found in output');
          }

          const result = JSON.parse(jsonLine);
          if (proxyId && result.success) {
            webshareProxyService.markProxySuccess(proxyId);
          } else if (proxyId && !result.success) {
            webshareProxyService.markProxyError(proxyId);
          }
          resolve(result);
        } catch (error) {
          console.error('Failed to parse Python output:', stdout);
          if (proxyId) {
            webshareProxyService.markProxyError(proxyId);
          }
          reject(new Error(`Failed to parse Crawl4AI output: ${error.message}`));
        }
      });

      python.on('error', (error) => {
        if (proxyId) {
          webshareProxyService.markProxyError(proxyId);
        }
        reject(new Error(`Failed to spawn Python process: ${error.message}`));
      });

      // Set timeout for long-running scrapes
      setTimeout(() => {
        python.kill('SIGTERM');
        if (proxyId) {
          webshareProxyService.markProxyError(proxyId);
        }
        reject(new Error('Crawl4AI request timeout'));
      }, 30000); // 30 second timeout
    });
  }

  async batchScrape(phoneNumbers, options = {}) {
    const { batchSize = 3, delayMs = 2000, maxRetries = 2 } = options;
    const results = [];

    for (let i = 0; i < phoneNumbers.length; i += batchSize) {
      const batch = phoneNumbers.slice(i, i + batchSize);
      console.log(`🔄 Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(phoneNumbers.length/batchSize)}`);

      const batchPromises = batch.map(async (phoneNumber) => {
        let lastError;

        for (let retry = 0; retry <= maxRetries; retry++) {
          try {
            if (retry > 0) {
              console.log(`🔄 Retry ${retry}/${maxRetries} for ${phoneNumber}`);
              await new Promise(resolve => setTimeout(resolve, 1000 * retry));
            }

            const result = await this.scrapeRoboKillerData(phoneNumber);
            return { phoneNumber, success: true, data: result, retry };
          } catch (error) {
            lastError = error;
            console.warn(`⚠️ Attempt ${retry + 1} failed for ${phoneNumber}:`, error.message);
          }
        }

        return { phoneNumber, success: false, error: lastError.message, retry: maxRetries };
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      // Add delay between batches to avoid rate limiting
      if (i + batchSize < phoneNumbers.length) {
        console.log(`⏳ Waiting ${delayMs}ms before next batch...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    return results;
  }

  async healthCheck() {
    try {
      const testResult = await this.scrapeRoboKillerData('8005551234', false); // Test without proxy first
      const proxyStats = webshareProxyService.getProxyStats();

      return {
        status: 'healthy',
        ready: this.isReady,
        testScrape: testResult.success,
        proxyService: {
          initialized: proxyStats.isInitialized,
          totalProxies: proxyStats.totalProxies,
          healthyProxies: proxyStats.healthyProxies,
          countries: proxyStats.countries
        },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        ready: this.isReady,
        error: error.message,
        proxyService: webshareProxyService.getProxyStats(),
        timestamp: new Date().toISOString()
      };
    }
  }

  async getProxyStats() {
    return webshareProxyService.getProxyStats();
  }

  async testProxyConnection() {
    try {
      const proxy = await webshareProxyService.getRandomProxy();
      const testResult = await webshareProxyService.testProxy(proxy.proxyUrl);
      return {
        proxy: {
          host: proxy.host,
          port: proxy.port,
          country: proxy.country,
          city: proxy.city
        },
        test: testResult
      };
    } catch (error) {
      return {
        error: error.message,
        proxy: null,
        test: { success: false, error: error.message }
      };
    }
  }
}

// Export singleton instance
export default new Crawl4AIService();