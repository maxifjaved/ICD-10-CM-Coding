#!/usr/bin/env bun
/**
 * OpenL.io Batch Image OCR Script (Bun Version with Proxy Support)
 *
 * This script recursively finds all image files from a specified folder and its subfolders,
 * then sends them to openl.io for OCR processing using a worker pool through rotating proxies.
 * It downloads and saves the recognized text files in the same location as the source images.
 *
 * Usage: bun run openl-ocr.js <path-to-folder> [options]
 *
 * Options:
 *   --batch-size=<number>   Number of concurrent active requests (default: 5)
 *   --delay=<number>        Delay in milliseconds between batches (default: 3000)
 *   --extensions=<list>     Comma-separated list of file extensions to process (default: jpeg,jpg,png,gif,bmp)
 *   --stale-lock=<number>   Time in minutes after which to consider a lock file stale (default: 30)
 *   --proxy=<yes|no>        Use proxy rotation (default: yes)
 *   --proxy-timeout=<sec>   Timeout for proxy requests in seconds (default: 30)
 *   --proxy-retries=<num>   Number of proxy retries before failing (default: 3)
 */

// Check and install required dependencies
async function checkAndInstallDependencies() {
    const requiredPackages = [
      'node-fetch@2.6.7',
      'https-proxy-agent',
      'cheerio',
      'crypto'
    ];
  
    try {
      console.log("Checking for required dependencies...");
  
      // Try to import them to see if they're installed
      for (const pkg of requiredPackages) {
        const pkgName = pkg.split('@')[0];
        try {
          await import(pkgName);
        } catch (error) {
          console.log(`Installing missing dependency: ${pkg}`);
          const proc = Bun.spawn(["bun", "install", pkg]);
          await proc.exited;
        }
      }
  
      console.log("All dependencies are installed.");
    } catch (error) {
      console.error(`Error checking/installing dependencies: ${error.message}`);
      process.exit(1);
    }
  }
  
  // Run the dependency check at startup
  await checkAndInstallDependencies();
  
  // Import built-in Bun features
  import { file } from 'bun';
  import fs from 'fs';
  import path from 'path';
  import { fileURLToPath } from 'url';
  import { dirname } from 'path';
  import crypto from 'crypto';
  
  // Get current directory
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  
  // Now dynamically import the packages that might have been installed
  let fetch, HttpsProxyAgent, cheerio;
  
  try {
    fetch = (await import('node-fetch')).default;
    HttpsProxyAgent = (await import('https-proxy-agent')).HttpsProxyAgent;
    cheerio = await import('cheerio');
  } catch (error) {
    console.error(`Error importing dependencies: ${error.message}`);
    process.exit(1);
  }
  
  // OpenL.io API credentials
  const OPENL_CONFIG = {
    apiSecret: '6VRWYJLMAPAR9KX2UJ',
    secretKey: 'IEODE9aBhM'
  };
  
  // Default configuration
  const DEFAULT_CONFIG = {
    batchSize: 5,
    batchDelay: 3000, // 3 seconds
    fileExtensions: ['jpeg', 'jpg', 'png', 'gif', 'bmp'],
    staleLockTime: 30, // 30 minutes
    useProxy: true,
    proxyTimeout: 30, // 30 seconds
    proxyRetries: 3, // Number of retries with different proxies
    proxyRefreshInterval: 30 * 60 * 1000 // 30 minutes
  };
  
  // Parse command line arguments
  function parseArgs(args) {
    const config = { ...DEFAULT_CONFIG };
    // Get folder path (first argument)
    let folderPath = args[0];
  
    // Handle options (remaining arguments)
    for (let i = 1; i < args.length; i++) {
      const arg = args[i];
  
      if (arg.startsWith('--batch-size=')) {
        const size = parseInt(arg.split('=')[1]);
        if (!isNaN(size) && size > 0) {
          config.batchSize = size;
        }
      }
      else if (arg.startsWith('--delay=')) {
        const delay = parseInt(arg.split('=')[1]);
        if (!isNaN(delay) && delay >= 0) {
          config.batchDelay = delay;
        }
      }
      else if (arg.startsWith('--extensions=')) {
        const extensions = arg.split('=')[1].split(',').map(ext => ext.trim().toLowerCase());
        if (extensions.length > 0) {
          config.fileExtensions = extensions;
        }
      }
      else if (arg.startsWith('--stale-lock=')) {
        const staleLock = parseInt(arg.split('=')[1]);
        if (!isNaN(staleLock) && staleLock > 0) {
          config.staleLockTime = staleLock;
        }
      }
      else if (arg.startsWith('--proxy=')) {
        const useProxy = arg.split('=')[1].trim().toLowerCase();
        config.useProxy = useProxy === 'yes' || useProxy === 'true' || useProxy === '1';
      }
      else if (arg.startsWith('--proxy-timeout=')) {
        const timeout = parseInt(arg.split('=')[1]);
        if (!isNaN(timeout) && timeout > 0) {
          config.proxyTimeout = timeout;
        }
      }
      else if (arg.startsWith('--proxy-retries=')) {
        const retries = parseInt(arg.split('=')[1]);
        if (!isNaN(retries) && retries >= 0) {
          config.proxyRetries = retries;
        }
      }
    }
  
    return { folderPath, config };
  }
  
  // Sleep helper function
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  // Generate OpenL.io required headers
  function generateOpenLHeaders(apiSecret, secretKey) {
    const timestamp = Date.now().toString();
    const nonce = Math.random().toString();
    
    // Create signature as per OpenL.io requirements
    const signatureData = timestamp + apiSecret + secretKey;
    const signature = crypto.createHash('md5').update(signatureData).digest('hex');
    
    console.log(`Generated authentication parameters:
      - timestamp: ${timestamp}
      - nonce: ${nonce}
      - signature: ${signature} (from ${signatureData.replace(secretKey, "***REDACTED***")})
    `);
    
    return {
      "accept": "application/json, text/plain, */*",
      "accept-language": "en-GB,en-US;q=0.9,en;q=0.8",
      "cache-control": "no-cache",
      "pragma": "no-cache",
      "priority": "u=1, i",
      "sec-ch-ua": "\"Not:A-Brand\";v=\"24\", \"Chromium\";v=\"134\"",
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": "\"macOS\"",
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-site",
      "nonce": nonce,
      "secret": secretKey,
      "signature": signature,
      "timestamp": timestamp,
      "x-api-secret": apiSecret,
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
      "referrer": "https://openl.io/",
      "referrerPolicy": "strict-origin-when-cross-origin"
    };
  }
  
  // File locking functions
  function getLockFilePath(imagePath) {
    return `${imagePath}.lock`;
  }
  
  function isFileLocked(imagePath) {
    const lockFilePath = getLockFilePath(imagePath);
    return fs.existsSync(lockFilePath);
  }
  
  function isLockStale(lockFilePath, staleLockTimeMinutes) {
    if (!fs.existsSync(lockFilePath)) return false;
  
    try {
      const stats = fs.statSync(lockFilePath);
      const lockAge = (Date.now() - stats.mtimeMs) / (1000 * 60); // age in minutes
      return lockAge > staleLockTimeMinutes;
    } catch (error) {
      // If we can't read the file stats, assume it's not stale
      return false;
    }
  }
  
  function createLockFile(imagePath, processId) {
    const lockFilePath = getLockFilePath(imagePath);
    try {
      // Write the process ID to the lock file
      fs.writeFileSync(lockFilePath, `${processId}:${Date.now()}`, 'utf8');
      return true;
    } catch (error) {
      console.error(`Error creating lock file for ${path.basename(imagePath)}: ${error.message}`);
      return false;
    }
  }
  
  function removeLockFile(imagePath) {
    const lockFilePath = getLockFilePath(imagePath);
    try {
      if (fs.existsSync(lockFilePath)) {
        fs.unlinkSync(lockFilePath);
      }
      return true;
    } catch (error) {
      console.error(`Error removing lock file for ${path.basename(imagePath)}: ${error.message}`);
      return false;
    }
  }
  
  // Attempt to acquire a lock for the image
  function acquireLock(imagePath, processId, staleLockTimeMinutes) {
    const lockFilePath = getLockFilePath(imagePath);
  
    if (!fs.existsSync(lockFilePath)) {
      // No lock exists, create one
      return createLockFile(imagePath, processId);
    }
  
    // Lock exists, check if it's stale
    if (isLockStale(lockFilePath, staleLockTimeMinutes)) {
      console.log(`Found stale lock for ${path.basename(imagePath)}, overriding`);
      // Remove the stale lock and create a new one
      removeLockFile(imagePath);
      return createLockFile(imagePath, processId);
    }
  
    // Lock exists and is not stale
    return false;
  }
  
  // Proxy Manager Class
  class ProxyManager {
    constructor(config) {
      this.config = config;
      this.proxies = [];
      this.currentIndex = 0;
      this.lastRefresh = 0;
      this.proxyFile = 'available_proxies.json';
    }
  
    async init() {
      console.log('Initializing proxy manager...');
      try {
        // Try to load proxies from cache file
        if (fs.existsSync(this.proxyFile)) {
          const proxyData = JSON.parse(fs.readFileSync(this.proxyFile, 'utf8'));
          const age = (Date.now() - proxyData.timestamp) / 1000;
  
          // Use cached proxies if they're less than 30 minutes old
          if (age < 1800 && proxyData.proxies && proxyData.proxies.length > 0) {
            this.proxies = proxyData.proxies;
            this.lastRefresh = proxyData.timestamp;
            console.log(`Loaded ${this.proxies.length} proxies from cache`);
            return;
          }
        }
  
        // Fetch new proxies
        await this.refreshProxies();
      } catch (error) {
        console.error(`Proxy manager initialization error: ${error.message}`);
        // Create an empty proxy list if fetch fails
        this.proxies = [];
      }
    }
  
    async refreshProxies() {
      try {
        console.log('Fetching fresh proxy list...');
  
        // Fetch the proxy list
        const response = await fetch('https://free-proxy-list.net/', {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          },
          timeout: 10000, // 10-second timeout
        });
  
        if (!response.ok) {
          throw new Error(`Failed to fetch proxy list: ${response.status}`);
        }
  
        const html = await response.text();
  
        // Parse the HTML to extract proxies
        const $ = cheerio.load(html);
        const proxies = [];
  
        // Find the table with proxies
        $('table tbody tr').each((i, element) => {
          const tds = $(element).find('td');
  
          const ip = $(tds[0]).text().trim();
          const port = $(tds[1]).text().trim();
          const https = $(tds[6]).text().trim() === 'yes';
  
          // Only collect https proxies (more secure)
          if (https) {
            proxies.push({
              ip,
              port,
              fails: 0,
              lastUsed: 0
            });
          }
        });
  
        if (proxies.length === 0) {
          throw new Error('No HTTPS proxies found in the list');
        }
  
        // Save the proxies
        this.proxies = proxies;
        this.lastRefresh = Date.now();
        this.currentIndex = 0;
  
        // Save to cache file
        fs.writeFileSync(this.proxyFile, JSON.stringify({
          timestamp: this.lastRefresh,
          proxies: this.proxies
        }, null, 2));
  
        console.log(`Fetched ${proxies.length} HTTPS proxies`);
      } catch (error) {
        console.error(`Error refreshing proxies: ${error.message}`);
        throw error;
      }
    }
  
    async getProxy() {
      // Check if we need to refresh the proxy list
      if (Date.now() - this.lastRefresh > this.config.proxyRefreshInterval) {
        await this.refreshProxies();
      }
  
      // If no proxies available, try to refresh or return null
      if (this.proxies.length === 0) {
        try {
          await this.refreshProxies();
        } catch (error) {
          console.error('Failed to refresh proxies and none are available');
          return null;
        }
  
        // Still no proxies after refresh
        if (this.proxies.length === 0) {
          return null;
        }
      }
  
      // Find the next proxy that hasn't failed too many times
      let attemptsLeft = this.proxies.length;
      while (attemptsLeft > 0) {
        const proxy = this.proxies[this.currentIndex];
        this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
        attemptsLeft--;
  
        // Skip proxies that have failed too many times
        if (proxy.fails >= 3) {
          continue;
        }
  
        // Update last used time
        proxy.lastUsed = Date.now();
        return proxy;
      }
  
      // If all proxies have failed too many times, reset fail counts and try again
      console.log('All proxies have failed too many times. Resetting fail counts.');
      for (const proxy of this.proxies) {
        proxy.fails = 0;
      }
  
      return this.proxies[0];
    }
  
    markProxyFailed(proxy) {
      if (!proxy) return;
  
      // Find the proxy in our list
      const index = this.proxies.findIndex(p => p.ip === proxy.ip && p.port === proxy.port);
      if (index !== -1) {
        this.proxies[index].fails += 1;
        console.log(`Marked proxy ${proxy.ip}:${proxy.port} as failed (${this.proxies[index].fails} fails)`);
  
        // Remove proxy if it has failed too many times
        if (this.proxies[index].fails >= 5) {
          console.log(`Removing proxy ${proxy.ip}:${proxy.port} due to too many failures`);
          this.proxies.splice(index, 1);
        }
  
        // Update cache file
        fs.writeFileSync(this.proxyFile, JSON.stringify({
          timestamp: this.lastRefresh,
          proxies: this.proxies
        }, null, 2));
      }
    }
  
    // Method to perform fetch with a proxy
    async fetchWithProxy(url, options, retries = 3) {
      if (!this.config.useProxy) {
        // No proxy, use direct connection
        return fetch(url, options);
      }
  
      let lastError = null;
      let proxy = null;
      let lastResponseData = null;
  
      for (let attempt = 0; attempt < retries; attempt++) {
        try {
          // Get a proxy
          proxy = await this.getProxy();
  
          if (!proxy) {
            console.log('No proxy available, using direct connection');
            return fetch(url, options);
          }
  
          console.log(`Using proxy ${proxy.ip}:${proxy.port} (attempt ${attempt + 1}/${retries})`);
          
          // Print some details about what we're sending
          console.log(`URL: ${url}`);
          console.log(`Method: ${options.method || 'GET'}`);
          
          // Log headers but sanitize sensitive values
          const sanitizedHeaders = {...options.headers};
          if (sanitizedHeaders.secret) sanitizedHeaders.secret = "***REDACTED***";
          if (sanitizedHeaders.signature) sanitizedHeaders.signature = "***REDACTED***";
          if (sanitizedHeaders["x-api-secret"]) sanitizedHeaders["x-api-secret"] = "***REDACTED***";
          console.log(`Headers: ${JSON.stringify(sanitizedHeaders, null, 2)}`);
          
          // Create proxy agent - fixed to work with the package's export
          const proxyUrl = `http://${proxy.ip}:${proxy.port}`;
          const proxyAgent = new HttpsProxyAgent(proxyUrl);
  
          // Set timeout
          const timeoutMs = this.config.proxyTimeout * 1000;
  
          // Make the request with the proxy
          const response = await fetch(url, {
            ...options,
            agent: proxyAgent,
            timeout: timeoutMs
          });
  
          // Check if request was successful
          if (response.ok) {
            return response;
          } else {
            // Clone the response and get more details
            const clonedResponse = response.clone();
            let responseText = '';
            try {
              responseText = await clonedResponse.text();
            } catch (e) {
              responseText = 'Could not read response body';
            }
            
            // Log response headers
            const responseHeaders = {};
            response.headers.forEach((value, key) => {
              responseHeaders[key] = value;
            });
            
            lastResponseData = {
              status: response.status,
              statusText: response.statusText,
              headers: responseHeaders,
              body: responseText.substring(0, 1000) // Limit to 1000 chars to avoid huge logs
            };
            
            throw new Error(`HTTP error: ${response.status} - ${response.statusText}`);
          }
        } catch (error) {
          lastError = error;
          
          let errorDetails = `Proxy error (${proxy?.ip}:${proxy?.port}): ${error.message}`;
          
          // Add additional response data if we have it
          if (lastResponseData) {
            errorDetails += `\nResponse Status: ${lastResponseData.status} ${lastResponseData.statusText}`;
            errorDetails += `\nResponse Headers: ${JSON.stringify(lastResponseData.headers, null, 2)}`;
            if (lastResponseData.body) {
              errorDetails += `\nResponse Body: ${lastResponseData.body}`;
            }
          }
          
          console.log(errorDetails);
  
          // Mark the proxy as failed
          if (proxy) {
            this.markProxyFailed(proxy);
          }
  
          // Wait a bit before trying the next proxy
          await sleep(1000);
        }
      }
  
      // All retries failed, try direct connection
      console.log('All proxy attempts failed, trying direct connection');
      try {
        console.log('Making direct request to:', url);
        const sanitizedHeaders = {...options.headers};
        if (sanitizedHeaders.secret) sanitizedHeaders.secret = "***REDACTED***";
        if (sanitizedHeaders.signature) sanitizedHeaders.signature = "***REDACTED***";
        if (sanitizedHeaders["x-api-secret"]) sanitizedHeaders["x-api-secret"] = "***REDACTED***";
        console.log(`Headers: ${JSON.stringify(sanitizedHeaders, null, 2)}`);
        
        const response = await fetch(url, options);
        
        // Check if direct request was successful
        if (response.ok) {
          return response;
        } else {
          // Get more details about the failed direct request
          const clonedResponse = response.clone();
          let responseText = '';
          try {
            responseText = await clonedResponse.text();
          } catch (e) {
            responseText = 'Could not read response body';
          }
          
          const responseHeaders = {};
          response.headers.forEach((value, key) => {
            responseHeaders[key] = value;
          });
          
          const errorDetails = {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders,
            body: responseText.substring(0, 1000)
          };
          
          console.error('Direct request failed:');
          console.error(`Status: ${errorDetails.status} ${errorDetails.statusText}`);
          console.error(`Headers: ${JSON.stringify(errorDetails.headers, null, 2)}`);
          console.error(`Body: ${errorDetails.body}`);
          
          throw new Error(`Direct HTTP error: ${response.status} - ${response.statusText}`);
        }
      } catch (directError) {
        console.error('Direct connection error:', directError.message);
        // If direct connection also fails, throw the original proxy error with last response data
        if (lastResponseData) {
          throw new Error(`Failed after multiple attempts. Last status: ${lastResponseData.status}. Error: ${lastError?.message || directError.message}`);
        } else {
          throw lastError || directError;
        }
      }
    }
  }
  
  // Perform OCR on a single image using OpenL.io API with proxy support
  async function performOCR(imagePath, processId, config, proxyManager) {
    // Try to acquire a lock first
    if (!acquireLock(imagePath, processId, config.staleLockTime)) {
      return {
        success: false,
        locked: true,
        filename: path.basename(imagePath),
        error: 'Image is being processed by another instance'
      };
    }
  
    try {
      // Get the filename from the path
      const filename = path.basename(imagePath);
      console.log(`Reading image file: ${filename} (${imagePath})`);
  
      // Use a fixed boundary as shown in the working example
      const boundary = "----WebKitFormBoundaryeCcyg0e3MLVhFcGo";
  
      // Generate timestamps etc.
      const timestamp = Date.now().toString();
      const nonce = Math.random().toString();
      
      // Create signature as per OpenL.io requirements
      const signatureData = timestamp + OPENL_CONFIG.apiSecret + OPENL_CONFIG.secretKey;
      const signature = crypto.createHash('md5').update(signatureData).digest('hex');
      
      console.log(`Generated authentication parameters:
        - timestamp: ${timestamp}
        - nonce: ${nonce}
        - signature: ${signature}
      `);
  
      // Define headers exactly as in the working example
      const headers = {
        "accept": "application/json, text/plain, */*",
        "accept-language": "en-GB,en-US;q=0.9,en;q=0.8",
        "cache-control": "no-cache",
        "content-type": `multipart/form-data; boundary=${boundary}`,
        "nonce": nonce,
        "pragma": "no-cache",
        "priority": "u=1, i",
        "sec-ch-ua": "\"Not:A-Brand\";v=\"24\", \"Chromium\";v=\"134\"",
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": "\"macOS\"",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-site",
        "secret": OPENL_CONFIG.secretKey,
        "signature": signature,
        "timestamp": timestamp,
        "x-api-secret": OPENL_CONFIG.apiSecret,
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
      };
  
      // Read the image file
      const imageBuffer = fs.readFileSync(imagePath);
      console.log(`Successfully read ${imageBuffer.length} bytes from file`);
      
      // Create form data manually, strictly following the working example format
      console.log('Creating manual multipart/form-data body...');
      
      // Start with boundary
      let formDataParts = [];
      formDataParts.push(`--${boundary}`);
      formDataParts.push('Content-Disposition: form-data; name="file"; filename="' + filename + '"');
      formDataParts.push('Content-Type: image/jpeg');
      formDataParts.push('');  // Empty line before content
      
      // We'll use a raw body instead of FormData
      const formDataStart = formDataParts.join('\r\n') + '\r\n';
      const formDataEnd = '\r\n--' + boundary + '--\r\n';
      
      // Create the complete body as a Buffer
      const body = Buffer.concat([
        Buffer.from(formDataStart, 'utf8'),
        imageBuffer,
        Buffer.from(formDataEnd, 'utf8')
      ]);
      
      console.log('Sending request to OpenL.io API with manual multipart body...');
      console.log(`Request URL: https://api.openl.io/translate/img`);
      console.log(`Request method: POST`);
      console.log(`Total body size: ${body.length} bytes`);
      
      // Send the request through a proxy
      const response = await proxyManager.fetchWithProxy('https://api.openl.io/translate/img', {
        method: 'POST',
        headers: headers,
        body: body,
      }, config.proxyRetries);
  
      if (!response.ok) {
        // Remove lock file if request fails
        removeLockFile(imagePath);
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
  
      // Get the response text first to debug
      let responseText;
      try {
        responseText = await response.text();
        console.log(`Raw API response (first 200 chars): ${responseText.substring(0, 200)}`);
        
        // Try to parse as JSON
        const responseData = JSON.parse(responseText);
        
        if (!responseData || !responseData.text) {
          // Remove lock file if processing fails
          removeLockFile(imagePath);
          console.error('Invalid response structure:', JSON.stringify(responseData, null, 2));
          throw new Error('Invalid response from OpenL.io API (missing text field)');
        }
  
        // Get the OCR text result
        const textContent = responseData.text;
        console.log(`Received OCR text (first 100 chars): ${textContent.substring(0, 100)}`);
  
        // Save the text to a file with the same name as the image but .txt extension
        const outputFile = `${path.basename(imagePath, path.extname(imagePath))}.txt`;
        const outputPath = path.join(path.dirname(imagePath), outputFile);
        fs.writeFileSync(outputPath, textContent, 'utf8');
        console.log(`Saved OCR text to: ${outputPath}`);
  
        // Remove the lock file after successful processing
        removeLockFile(imagePath);
  
        return { success: true, filename, outputFile };
      } catch (parseError) {
        // Remove lock file if an exception occurs during parsing
        removeLockFile(imagePath);
        console.error('Error parsing API response:', parseError);
        console.error('Raw response:', responseText);
        return { 
          success: false, 
          filename: path.basename(imagePath), 
          error: `Error parsing API response: ${parseError.message}. Raw response: ${responseText.substring(0, 200)}...` 
        };
      }
    } catch (error) {
      // Remove lock file if an exception occurs
      removeLockFile(imagePath);
      console.error(`OCR processing error for ${path.basename(imagePath)}:`, error);
      return { success: false, filename: path.basename(imagePath), error: error.message };
    }
  }
  
  // Perform OCR on a single image without using proxy
  async function performOCRDirect(imagePath, processId, config) {
    // Try to acquire a lock first
    if (!acquireLock(imagePath, processId, config.staleLockTime)) {
      return {
        success: false,
        locked: true,
        filename: path.basename(imagePath),
        error: 'Image is being processed by another instance'
      };
    }
  
    try {
      // Get the filename from the path
      const filename = path.basename(imagePath);
      console.log(`[DIRECT] Reading image file: ${filename} (${imagePath})`);
  
      // Use a fixed boundary as shown in the working example
      const boundary = "----WebKitFormBoundaryeCcyg0e3MLVhFcGo";
  
      // Generate timestamps etc.
      const timestamp = Date.now().toString();
      const nonce = Math.random().toString();
      
      // Create signature as per OpenL.io requirements
      const signatureData = timestamp + OPENL_CONFIG.apiSecret + OPENL_CONFIG.secretKey;
      const signature = crypto.createHash('md5').update(signatureData).digest('hex');
      
      console.log(`[DIRECT] Generated authentication parameters:
        - timestamp: ${timestamp}
        - nonce: ${nonce}
        - signature: ${signature}
      `);
  
      // Define headers exactly as in the working example
      const headers = {
        "accept": "application/json, text/plain, */*",
        "accept-language": "en-GB,en-US;q=0.9,en;q=0.8",
        "cache-control": "no-cache",
        "content-type": `multipart/form-data; boundary=${boundary}`,
        "nonce": nonce,
        "pragma": "no-cache",
        "priority": "u=1, i",
        "sec-ch-ua": "\"Not:A-Brand\";v=\"24\", \"Chromium\";v=\"134\"",
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": "\"macOS\"",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-site",
        "secret": OPENL_CONFIG.secretKey,
        "signature": signature,
        "timestamp": timestamp,
        "x-api-secret": OPENL_CONFIG.apiSecret,
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
        "referrer": "https://openl.io/",
        "referrerPolicy": "strict-origin-when-cross-origin"
      };
  
      // Read the image file
      const imageBuffer = fs.readFileSync(imagePath);
      console.log(`[DIRECT] Successfully read ${imageBuffer.length} bytes from file`);
      
      // Create form data manually, strictly following the working example format
      console.log('[DIRECT] Creating manual multipart/form-data body...');
      
      // Start with boundary
      let formDataParts = [];
      formDataParts.push(`--${boundary}`);
      formDataParts.push('Content-Disposition: form-data; name="file"; filename="' + filename + '"');
      formDataParts.push('Content-Type: image/jpeg');
      formDataParts.push('');  // Empty line before content
      
      // We'll use a raw body instead of FormData
      const formDataStart = formDataParts.join('\r\n') + '\r\n';
      const formDataEnd = '\r\n--' + boundary + '--\r\n';
      
      // Create the complete body as a Buffer
      const body = Buffer.concat([
        Buffer.from(formDataStart, 'utf8'),
        imageBuffer,
        Buffer.from(formDataEnd, 'utf8')
      ]);
      
      console.log('[DIRECT] Sending request to OpenL.io API with manual multipart body...');
      console.log(`[DIRECT] Request URL: https://api.openl.io/translate/img`);
      console.log(`[DIRECT] Request method: POST`);
      console.log(`[DIRECT] Total body size: ${body.length} bytes`);
      
      // Send the request directly
      let response;
      try {
        response = await fetch('https://api.openl.io/translate/img', {
          method: 'POST',
          headers: headers,
          body: body
        });
        
        console.log(`[DIRECT] Response status: ${response.status} ${response.statusText}`);
        
        // Log response headers
        const responseHeaders = {};
        response.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });
        console.log(`[DIRECT] Response headers: ${JSON.stringify(responseHeaders, null, 2)}`);
      } catch (fetchError) {
        console.error('[DIRECT] Fetch error:', fetchError);
        throw fetchError;
      }
  
      if (!response.ok) {
        // Try to get more information about the error
        let errorText = '';
        try {
          errorText = await response.text();
          console.error(`[DIRECT] Error response body: ${errorText}`);
        } catch (textError) {
          console.error('[DIRECT] Could not read error response body:', textError);
        }
        
        // Remove lock file if request fails
        removeLockFile(imagePath);
        throw new Error(`HTTP error! Status: ${response.status}, Body: ${errorText.substring(0, 200)}`);
      }
  
      // Get the response text first to debug
      let responseText;
      try {
        responseText = await response.text();
        console.log(`[DIRECT] Raw API response (first 200 chars): ${responseText.substring(0, 200)}`);
        
        // Try to parse as JSON
        const responseData = JSON.parse(responseText);
        
        if (!responseData) {
          console.error('[DIRECT] Response is not valid JSON');
          removeLockFile(imagePath);
          throw new Error('Invalid JSON response from OpenL.io API');
        }
        
        if (!responseData.text) {
          console.error('[DIRECT] Response JSON missing text field:', JSON.stringify(responseData, null, 2));
          removeLockFile(imagePath);
          throw new Error('Invalid response structure from OpenL.io API (missing text field)');
        }
  
        // Get the OCR text result
        const textContent = responseData.text;
        console.log(`[DIRECT] Received OCR text (first 100 chars): ${textContent.substring(0, 100)}`);
  
        // Save the text to a file with the same name as the image but .txt extension
        const outputFile = `${path.basename(imagePath, path.extname(imagePath))}.txt`;
        const outputPath = path.join(path.dirname(imagePath), outputFile);
        fs.writeFileSync(outputPath, textContent, 'utf8');
        console.log(`[DIRECT] Saved OCR text to: ${outputPath}`);
  
        // Remove the lock file after successful processing
        removeLockFile(imagePath);
  
        return { success: true, filename, outputFile };
      } catch (parseError) {
        // Remove lock file if an exception occurs during parsing
        removeLockFile(imagePath);
        console.error('[DIRECT] Error parsing API response:', parseError);
        console.error('[DIRECT] Raw response:', responseText);
        return { 
          success: false, 
          filename: path.basename(imagePath), 
          error: `Error parsing API response: ${parseError.message}. Raw response: ${responseText.substring(0, 200)}...` 
        };
      }
    } catch (error) {
      // Remove lock file if an exception occurs
      removeLockFile(imagePath);
      console.error(`[DIRECT] OCR processing error for ${path.basename(imagePath)}:`, error);
      return { success: false, filename: path.basename(imagePath), error: error.message };
    }
  }
  
  // Process images using a worker pool with proxy
  async function processImagesWithPool(imagePaths, config, processId, proxyManager) {
    const results = {
      successful: 0,
      failed: 0,
      skipped: 0,
      locked: 0,
      details: []
    };
  
    // Initial filtering of already processed images
    const pendingImagePaths = [];
    for (const imagePath of imagePaths) {
      const txtPath = `${path.basename(imagePath, path.extname(imagePath))}.txt`;
      const fullTxtPath = path.join(path.dirname(imagePath), txtPath);
  
      if (fs.existsSync(fullTxtPath)) {
        console.log(`Skipping: ${path.basename(imagePath)} (already processed)`);
        results.skipped++;
        results.details.push({
          success: true,
          skipped: true,
          filename: path.basename(imagePath),
          outputFile: txtPath
        });
      } else if (isFileLocked(imagePath)) {
        console.log(`Skipping: ${path.basename(imagePath)} (locked by another process)`);
        results.locked++;
        results.details.push({
          success: false,
          locked: true,
          filename: path.basename(imagePath),
          error: 'Being processed by another instance'
        });
      } else {
        pendingImagePaths.push(imagePath);
      }
    }
  
    // If no images to process, return early
    if (pendingImagePaths.length === 0) {
      return results;
    }
  
    console.log(`\nStarting worker pool with ${config.batchSize} concurrent workers`);
    
    // Queue implementation
    const queue = [...pendingImagePaths];
    let completed = 0;
    const total = pendingImagePaths.length;
  
    // Worker function - processes one image at a time from the queue
    const worker = async () => {
      while (queue.length > 0) {
        const imagePath = queue.shift();
        const fileName = path.basename(imagePath);
        
        console.log(`Processing: ${fileName} [${completed + 1}/${total}]`);
        
        try {
          const result = await performOCR(imagePath, processId, config, proxyManager);
          
          if (result.success) {
            results.successful++;
            console.log(`✓ ${result.filename} → ${result.outputFile} [${completed + 1}/${total}]`);
          } else if (result.locked) {
            results.locked++;
            console.log(`⊘ ${result.filename} - ${result.error} [${completed + 1}/${total}]`);
          } else {
            results.failed++;
            console.log(`✗ ${result.filename} - Error: ${result.error} [${completed + 1}/${total}]`);
          }
          
          results.details.push(result);
        } catch (error) {
          const result = {
            success: false,
            filename: fileName,
            error: error.message
          };
          results.failed++;
          console.log(`✗ ${fileName} - Error: ${error.message} [${completed + 1}/${total}]`);
          results.details.push(result);
        }
        
        completed++;
      }
    };
  
    // Start the worker pool with exactly config.batchSize workers
    const workerPromises = [];
    const workerCount = Math.min(config.batchSize, pendingImagePaths.length);
    
    for (let i = 0; i < workerCount; i++) {
      workerPromises.push(worker());
    }
  
    // Wait for all workers to complete
    await Promise.all(workerPromises);
  
    return results;
  }
  
  // Process images using a worker pool without proxy
  async function processImagesWithPoolDirect(imagePaths, config, processId) {
    const results = {
      successful: 0,
      failed: 0,
      skipped: 0,
      locked: 0,
      details: []
    };
  
    // Initial filtering of already processed images
    const pendingImagePaths = [];
    for (const imagePath of imagePaths) {
      const txtPath = `${path.basename(imagePath, path.extname(imagePath))}.txt`;
      const fullTxtPath = path.join(path.dirname(imagePath), txtPath);
  
      if (fs.existsSync(fullTxtPath)) {
        console.log(`Skipping: ${path.basename(imagePath)} (already processed)`);
        results.skipped++;
        results.details.push({
          success: true,
          skipped: true,
          filename: path.basename(imagePath),
          outputFile: txtPath
        });
      } else if (isFileLocked(imagePath)) {
        console.log(`Skipping: ${path.basename(imagePath)} (locked by another process)`);
        results.locked++;
        results.details.push({
          success: false,
          locked: true,
          filename: path.basename(imagePath),
          error: 'Being processed by another instance'
        });
      } else {
        pendingImagePaths.push(imagePath);
      }
    }
  
    // If no images to process, return early
    if (pendingImagePaths.length === 0) {
      return results;
    }
  
    console.log(`\nStarting worker pool with ${config.batchSize} concurrent workers`);
    
    // Queue implementation
    const queue = [...pendingImagePaths];
    let completed = 0;
    const total = pendingImagePaths.length;
  
    // Worker function - processes one image at a time from the queue
    const worker = async () => {
      while (queue.length > 0) {
        const imagePath = queue.shift();
        const fileName = path.basename(imagePath);
        
        console.log(`Processing: ${fileName} [${completed + 1}/${total}]`);
        
        try {
          const result = await performOCRDirect(imagePath, processId, config);
          
          if (result.success) {
            results.successful++;
            console.log(`✓ ${result.filename} → ${result.outputFile} [${completed + 1}/${total}]`);
          } else if (result.locked) {
            results.locked++;
            console.log(`⊘ ${result.filename} - ${result.error} [${completed + 1}/${total}]`);
          } else {
            results.failed++;
            console.log(`✗ ${result.filename} - Error: ${result.error} [${completed + 1}/${total}]`);
          }
          
          results.details.push(result);
        } catch (error) {
          const result = {
            success: false,
            filename: fileName,
            error: error.message
          };
          results.failed++;
          console.log(`✗ ${fileName} - Error: ${error.message} [${completed + 1}/${total}]`);
          results.details.push(result);
        }
        
        completed++;
      }
    };
  
    // Start the worker pool with exactly config.batchSize workers
    const workerPromises = [];
    const workerCount = Math.min(config.batchSize, pendingImagePaths.length);
    
    for (let i = 0; i < workerCount; i++) {
      workerPromises.push(worker());
    }
  
    // Wait for all workers to complete
    await Promise.all(workerPromises);
  
    return results;
  }
  
  // Find all image files in a directory and its subdirectories
  function findImageFiles(directoryPath, extensions) {
    try {
      const imageFiles = [];
  
      // Recursive function to scan directories
      function scanDirectory(dir) {
        // Read all files in the directory
        const items = fs.readdirSync(dir);
  
        for (const item of items) {
          const itemPath = path.join(dir, item);
          const stats = fs.statSync(itemPath);
  
          if (stats.isDirectory()) {
            // If it's a directory, scan it recursively
            scanDirectory(itemPath);
          } else if (stats.isFile()) {
            // If it's a file, check if it's an image
            const ext = path.extname(item).toLowerCase().slice(1);
            if (extensions.includes(ext)) {
              imageFiles.push(itemPath);
            }
          }
        }
      }
  
      // Start the recursive scan
      scanDirectory(directoryPath);
      return imageFiles;
    } catch (error) {
      console.error(`Error reading directory ${directoryPath}: ${error.message}`);
      return [];
    }
  }
  
  // Generate a unique process ID
  function generateProcessId() {
    return `pid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
  
  // Create progress flag files
  function createProgressFile(data) {
    try {
      fs.writeFileSync('ocr_in_progress.flag', JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
      console.error(`Error creating progress file: ${error.message}`);
    }
  }
  
  function createCompletionFile(results, startTime, endTime) {
    try {
      const completionData = {
        completed_at: new Date().toISOString(),
        total_time_seconds: ((endTime - startTime) / 1000).toFixed(2),
        results: {
          total: results.successful + results.failed + results.skipped + results.locked,
          successful: results.successful,
          failed: results.failed,
          skipped: results.skipped,
          locked: results.locked
        }
      };
  
      fs.writeFileSync('ocr_completed.flag', JSON.stringify(completionData, null, 2), 'utf8');
  
      if (fs.existsSync('ocr_in_progress.flag')) {
        fs.unlinkSync('ocr_in_progress.flag');
      }
    } catch (error) {
      console.error(`Error creating completion file: ${error.message}`);
    }
  }
  
  // Main function
  async function main() {
    // Get the folder path and config from command line arguments
    const args = process.argv.slice(2);
  
    if (args.length === 0) {
      console.error('Error: Please provide the path to a folder containing images.');
      console.log('Usage: bun run openl-ocr.js <path-to-folder> [options]');
      console.log('\nOptions:');
      console.log('  --batch-size=<number>   Number of concurrent requests (default: 5)');
      console.log('  --delay=<number>        Delay in milliseconds between batches (default: 3000)');
      console.log('  --extensions=<list>     Comma-separated list of file extensions to process (default: jpeg,jpg,png,gif,bmp)');
      console.log('  --stale-lock=<number>   Time in minutes after which to consider a lock file stale (default: 30)');
      console.log('  --proxy=<yes|no>        Use proxy rotation (default: yes)');
      console.log('  --proxy-timeout=<sec>   Timeout for proxy requests in seconds (default: 30)');
      console.log('  --proxy-retries=<num>   Number of proxy retries before failing (default: 3)');
      process.exit(1);
    }
  
    const { folderPath, config } = parseArgs(args);
  
    // Generate a unique process ID for this script instance
    const processId = generateProcessId();
    console.log(`Starting process with ID: ${processId}`);
  
    // Initialize the proxy manager if using proxies
    let proxyManager = null;
    if (config.useProxy) {
      proxyManager = new ProxyManager(config);
      await proxyManager.init();
    }
  
    // Create in-progress flag
    createProgressFile({
      started_at: new Date().toISOString(),
      process_id: processId,
      config: config,
      folder_path: folderPath,
      proxy_enabled: config.useProxy
    });
  
    // Display summary with subfolder information
    try {
      // Make sure to normalize path and remove trailing slash if present
      const normalizedPath = path.normalize(folderPath).replace(/[\/\\]$/, '');
  
      // Validate the folder exists
      const stats = fs.statSync(normalizedPath);
      if (!stats.isDirectory()) {
        console.error(`Error: '${normalizedPath}' is not a directory.`);
        process.exit(1);
      }
  
      // Find all image files in the directory and its subdirectories
      const imageFiles = findImageFiles(normalizedPath, config.fileExtensions);
  
      if (imageFiles.length === 0) {
        console.error(`Error: No image files found in '${normalizedPath}' or its subdirectories with extensions: ${config.fileExtensions.join(', ')}`);
        process.exit(1);
      }
  
      // Count how many folders contain images
      const imageFolders = new Set();
      imageFiles.forEach(file => {
        imageFolders.add(path.dirname(file));
      });
  
      console.log(`Found ${imageFiles.length} image file(s) across ${imageFolders.size} folder(s)`);
      console.log(`Concurrent workers: ${config.batchSize}, Delay between batches: ${config.batchDelay}ms, Stale lock time: ${config.staleLockTime} minutes`);
      console.log(`Proxy rotation: ${config.useProxy ? 'Enabled' : 'Disabled'}`);
  
      if (config.useProxy && proxyManager) {
        console.log(`Available proxies: ${proxyManager.proxies.length}`);
      }
  
      console.log('Starting OCR processing with OpenL.io API...');
  
      // Update progress file with image count
      createProgressFile({
        started_at: new Date().toISOString(),
        process_id: processId,
        config: config,
        folder_path: folderPath,
        total_images: imageFiles.length,
        folders_count: imageFolders.size,
        proxy_enabled: config.useProxy,
        proxy_count: proxyManager ? proxyManager.proxies.length : 0
      });
  
      // Process all images
      const startTime = Date.now();
  
      // If proxy is disabled, use direct connection
      if (!config.useProxy || !proxyManager) {
        console.log("Processing without proxies");
        const results = await processImagesWithPoolDirect(imageFiles, config, processId);
        const endTime = Date.now();
        const totalTime = (endTime - startTime) / 1000;
  
        // Create completion file
        createCompletionFile(results, startTime, endTime);
  
        // Display summary
        console.log('\n========== SUMMARY ==========');
        console.log(`Total images found: ${imageFiles.length}`);
        console.log(`Successful: ${results.successful}`);
        console.log(`Failed: ${results.failed}`);
        console.log(`Skipped (already processed): ${results.skipped}`);
        console.log(`Skipped (locked by another process): ${results.locked}`);
        console.log(`Total processing time: ${totalTime.toFixed(2)} seconds`);
        console.log('=============================');
      }
      else {
        // Process with proxy
        console.log("Processing with proxy rotation");
        const results = await processImagesWithPool(imageFiles, config, processId, proxyManager);
        const endTime = Date.now();
        const totalTime = (endTime - startTime) / 1000;
  
        // Create completion file
        createCompletionFile(results, startTime, endTime);
  
        // Display summary
        console.log('\n========== SUMMARY ==========');
        console.log(`Total images found: ${imageFiles.length}`);
        console.log(`Successful: ${results.successful}`);
        console.log(`Failed: ${results.failed}`);
        console.log(`Skipped (already processed): ${results.skipped}`);
        console.log(`Skipped (locked by another process): ${results.locked}`);
        console.log(`Total processing time: ${totalTime.toFixed(2)} seconds`);
        console.log('=============================');
      }
    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  }
  
  main().catch(error => {
    console.error('An error occurred:', error);
    process.exit(1);
  });