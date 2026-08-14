import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import webshareProxyService from './webshare-proxy-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class Crawl4AIService {
  constructor() {
    this.pythonScript = path.join(__dirname, '..', 'scripts', 'fast_robokiller_scraper.py');
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

  async scrapeRoboKillerData(phoneNumber, useProxy = true, proxyOverride = null) {
    if (!this.isReady) {
      throw new Error('Crawl4AI service not ready');
    }

    let proxy = proxyOverride || null;
    let proxyId = proxy ? proxy.id : null;

    if (useProxy && !proxy) {
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

      let resolved = false;
      let timeoutId = null;

      const python = spawn('python3', args, {
        env: {
          ...process.env,
          OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
          OPENROUTER_MODEL: process.env.OPENROUTER_MODEL
        }
      });
      let stdout = '';
      let stderr = '';

      // Handle EPIPE errors on stdin (when Python process dies)
      python.stdin.on('error', (err) => {
        if (err.code === 'EPIPE') {
          console.warn('⚠️ EPIPE on stdin - Python process closed unexpectedly');
        }
      });

      python.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      python.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      // Handle process error (e.g., spawn failed)
      python.on('error', (error) => {
        if (resolved) return;
        resolved = true;
        if (timeoutId) clearTimeout(timeoutId);
        if (proxyId) {
          webshareProxyService.markProxyError(proxyId);
        }

        // Check if it's an EPIPE error
        if (error.code === 'EPIPE') {
          resolve({
            success: false,
            error: 'EPIPE - Python process closed unexpectedly',
            method: 'epipe_error'
          });
        } else {
          reject(new Error(`Failed to spawn Python process: ${error.message}`));
        }
      });

      python.on('close', (code, signal) => {
        if (resolved) return;
        resolved = true;
        if (timeoutId) clearTimeout(timeoutId);

        // Handle unexpected termination (e.g., killed by signal)
        if (signal) {
          console.warn(`Python process killed by signal: ${signal}`);
          if (proxyId) {
            webshareProxyService.markProxyError(proxyId);
          }
          resolve({
            success: false,
            error: `Process killed by signal: ${signal}`,
            method: 'signal_killed'
          });
          return;
        }

        // Check stderr for EPIPE or pipe errors
        if (stderr.includes('EPIPE') || stderr.includes('Broken pipe') || stderr.includes('BrokenPipeError')) {
          console.warn('⚠️ Python script had EPIPE error');
          if (proxyId) {
            webshareProxyService.markProxyError(proxyId);
          }
          resolve({
            success: false,
            error: 'EPIPE error in Python script',
            method: 'epipe_error'
          });
          return;
        }

        if (code !== 0 && code !== null) {
          console.error(`Python script error (${code}):`, stderr.substring(0, 500));
          if (proxyId) {
            webshareProxyService.markProxyError(proxyId);
          }
          resolve({
            success: false,
            error: `Script failed with code ${code}: ${stderr.substring(0, 200)}`,
            method: 'script_error'
          });
          return;
        }

        try {
          // Extract JSON from stdout (handle debug output pollution)
          const lines = stdout.split('\n');
          const jsonLine = lines.find(line => line.startsWith('{') && line.includes('"success"'));

          if (!jsonLine) {
            console.error('No JSON in output. stdout:', stdout.substring(0, 500));
            if (proxyId) {
              webshareProxyService.markProxyError(proxyId);
            }
            resolve({
              success: false,
              error: 'No JSON found in output',
              method: 'parse_error'
            });
            return;
          }

          const result = JSON.parse(jsonLine);
          if (proxyId && result.success) {
            webshareProxyService.markProxySuccess(proxyId);
          } else if (proxyId && !result.success) {
            webshareProxyService.markProxyError(proxyId);
          }
          resolve(result);
        } catch (error) {
          console.error('Failed to parse Python output:', stdout.substring(0, 500));
          if (proxyId) {
            webshareProxyService.markProxyError(proxyId);
          }
          resolve({
            success: false,
            error: `Parse error: ${error.message}`,
            method: 'parse_error'
          });
        }
      });

      // Set timeout for long-running scrapes (extended to 60 seconds)
      timeoutId = setTimeout(() => {
        if (resolved) return;
        resolved = true;

        try {
          python.kill('SIGTERM');
        } catch (e) {
          // Ignore kill errors
        }

        if (proxyId) {
          webshareProxyService.markProxyError(proxyId);
        }
        resolve({
          success: false,
          error: 'Crawl4AI request timeout (60s)',
          method: 'timeout'
        });
      }, 60000); // 60 second timeout (increased from 30)
    });
  }

  async batchScrape(phoneNumbers, options = {}) {
    const { batchSize = 20, delayMs = 500, maxRetries = 2 } = options;
    const results = [];

    for (let i = 0; i < phoneNumbers.length; i += batchSize) {
      const batch = phoneNumbers.slice(i, i + batchSize);
      const batchNum = Math.floor(i/batchSize) + 1;
      const totalBatches = Math.ceil(phoneNumbers.length/batchSize);
      console.log(`🔄 Processing batch ${batchNum}/${totalBatches} (${batch.length} DIDs)`);

      // Get one proxy for the whole batch
      let batchProxy = null;
      try {
        batchProxy = await webshareProxyService.getRandomProxy();
        console.log(`🌐 Batch proxy: ${batchProxy.country}/${batchProxy.city} - ${batchProxy.host}:${batchProxy.port}`);
      } catch (error) {
        console.warn('⚠️ No proxy available for batch, running direct');
      }

      let batchResults = await this.runBatchProcess(batch, batchProxy);

      // Check for blocked results and retry with new proxy
      const blocked = batchResults.filter(r => r.data?.is_blocked);
      if (blocked.length > 0 && maxRetries > 0) {
        console.warn(`🚫 ${blocked.length} DIDs blocked, switching proxy and retrying`);
        if (batchProxy) webshareProxyService.markProxyError(batchProxy.id);
        let retryProxy = null;
        try { retryProxy = await webshareProxyService.getRandomProxy(); } catch {}
        const blockedNumbers = blocked.map(r => r.phoneNumber);
        const retryResults = await this.runBatchProcess(blockedNumbers, retryProxy);
        // Merge: replace blocked results with retry results
        for (const retry of retryResults) {
          const idx = batchResults.findIndex(r => r.phoneNumber === retry.phoneNumber);
          if (idx !== -1) batchResults[idx] = retry;
        }
      }

      results.push(...batchResults);

      if (i + batchSize < phoneNumbers.length) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    return results;
  }

  async runBatchProcess(phoneNumbers, proxy = null) {
    return new Promise((resolve) => {
      const args = [this.pythonScript, `--numbers=${phoneNumbers.join(',')}`, `--concurrency=${phoneNumbers.length}`];
      if (proxy) args.push(`--proxy=${proxy.proxyUrl}`);

      let stdout = '';
      let stderr = '';
      let resolved = false;

      const python = spawn('python3', args, { env: { ...process.env } });

      python.stdout.on('data', d => { stdout += d.toString(); });
      python.stderr.on('data', d => { stderr += d.toString(); });

      const timeoutId = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        python.kill('SIGTERM');
        console.warn(`⚠️ Batch timeout for ${phoneNumbers.length} DIDs`);
        resolve(phoneNumbers.map(p => ({ phoneNumber: p, success: false, data: { success: false, error: 'timeout' } })));
      }, 60000);

      python.on('close', () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeoutId);
        try {
          const lines = stdout.split('\n');
          const jsonLine = lines.find(l => l.startsWith('{') && l.includes('"batch"'));
          if (!jsonLine) throw new Error('No batch JSON in output');
          const parsed = JSON.parse(jsonLine);
          resolve(parsed.results.map(r => ({
            phoneNumber: r.phone,
            success: r.success,
            data: r
          })));
        } catch (e) {
          console.error('Batch parse error:', e.message, stdout.substring(0, 200));
          resolve(phoneNumbers.map(p => ({ phoneNumber: p, success: false, data: { success: false, error: e.message } })));
        }
      });
    });
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