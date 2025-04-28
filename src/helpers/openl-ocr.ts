import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import fetch from 'node-fetch';
import { HttpsProxyAgent } from 'https-proxy-agent';

interface OCRConfig {
  batchSize: number;
  delay: number;
  extensions: string[];
  staleLock: boolean;
  proxy: string;
  proxyTimeout: number;
  proxyRetries: number;
}

interface ProxyManager {
  getProxy: () => Promise<string>;
  releaseProxy: (proxy: string) => void;
}

interface OCRResult {
  success: boolean;
  locked?: boolean;
  filename?: string;
  outputFile?: string;
  error?: string;
}

// OpenL.io API credentials
const OPENL_CONFIG = {
  apiSecret: "6VRWYJLMAPAR9KX2UJ",
  secretKey: "IEODE9aBhM",
};

// File locking functions
function getLockFilePath(imagePath: string): string {
  return `${imagePath}.lock`;
}

function isLockStale(lockFilePath: string, staleLockTimeMinutes: number): boolean {
  if (!fs.existsSync(lockFilePath)) return false;

  try {
    const stats = fs.statSync(lockFilePath);
    const lockAge = (Date.now() - stats.mtimeMs) / (1000 * 60); // age in minutes
    return lockAge > staleLockTimeMinutes;
  } catch {
    return false;
  }
}

function createLockFile(imagePath: string, processId: string): boolean {
  const lockFilePath = getLockFilePath(imagePath);
  try {
    fs.writeFileSync(lockFilePath, `${processId}:${Date.now()}`, "utf8");
    return true;
  } catch (error) {
    console.error(`Error creating lock file for ${path.basename(imagePath)}: ${error}`);
    return false;
  }
}

function removeLockFile(imagePath: string): boolean {
  const lockFilePath = getLockFilePath(imagePath);
  try {
    if (fs.existsSync(lockFilePath)) {
      fs.unlinkSync(lockFilePath);
    }
    return true;
  } catch (error) {
    console.error(`Error removing lock file for ${path.basename(imagePath)}: ${error}`);
    return false;
  }
}

function acquireLock(imagePath: string, processId: string, staleLockTimeMinutes: number): boolean {
  const lockFilePath = getLockFilePath(imagePath);

  if (!fs.existsSync(lockFilePath)) {
    return createLockFile(imagePath, processId);
  }

  if (isLockStale(lockFilePath, staleLockTimeMinutes)) {
    console.log(`Found stale lock for ${path.basename(imagePath)}, overriding`);
    removeLockFile(imagePath);
    return createLockFile(imagePath, processId);
  }

  return false;
}

export async function performOCR(
  imagePath: string,
  processId: string,
  config: OCRConfig,
  proxyManager: ProxyManager
): Promise<OCRResult> {
  // Try to acquire a lock first
  if (!acquireLock(imagePath, processId, config.staleLock ? 30 : 0)) {
    return {
      success: false,
      locked: true,
      filename: path.basename(imagePath),
      error: "Image is being processed by another instance",
    };
  }

  try {
    const filename = path.basename(imagePath);
    console.log(`Reading image file: ${filename} (${imagePath})`);

    const boundary = "----WebKitFormBoundaryeCcyg0e3MLVhFcGo";
    const timestamp = Date.now().toString();
    const nonce = Math.random().toString();

    const signatureData = timestamp + OPENL_CONFIG.apiSecret + OPENL_CONFIG.secretKey;
    const signature = crypto.createHash("md5").update(signatureData).digest("hex");

    const headers = {
      accept: "application/json, text/plain, */*",
      "accept-language": "en-GB,en-US;q=0.9,en;q=0.8",
      "cache-control": "no-cache",
      "content-type": `multipart/form-data; boundary=${boundary}`,
      nonce,
      pragma: "no-cache",
      priority: "u=1, i",
      "sec-ch-ua": '"Not:A-Brand";v="24", "Chromium";v="134"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-site",
      secret: OPENL_CONFIG.secretKey,
      signature,
      timestamp,
      "x-api-secret": OPENL_CONFIG.apiSecret,
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
    };

    const imageBuffer = fs.readFileSync(imagePath);
    console.log(`Successfully read ${imageBuffer.length} bytes from file`);

    const formDataParts = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="${filename}"`,
      "Content-Type: image/jpeg",
      "",
    ];

    const formDataStart = formDataParts.join("\r\n") + "\r\n";
    const formDataEnd = "\r\n--" + boundary + "--\r\n";

    const body = Buffer.concat([
      Buffer.from(formDataStart, "utf8"),
      imageBuffer,
      Buffer.from(formDataEnd, "utf8"),
    ]);

    console.log("Sending request to OpenL.io API...");

    let response;
    if (config.proxy) {
      const proxy = await proxyManager.getProxy();
      if (proxy) {
        const proxyAgent = new HttpsProxyAgent(proxy);
        response = await fetch("https://api.openl.io/translate/img", {
          method: "POST",
          headers,
          body,
          agent: proxyAgent,
          timeout: config.proxyTimeout * 1000,
        });
        proxyManager.releaseProxy(proxy);
      } else {
        response = await fetch("https://api.openl.io/translate/img", {
          method: "POST",
          headers,
          body,
        });
      }
    } else {
      response = await fetch("https://api.openl.io/translate/img", {
        method: "POST",
        headers,
        body,
      });
    }

    if (!response.ok) {
      removeLockFile(imagePath);
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const responseText = await response.text();
    console.log(`Raw API response (first 200 chars): ${responseText.substring(0, 200)}`);

    const responseData = JSON.parse(responseText);

    if (!responseData || !responseData.text) {
      removeLockFile(imagePath);
      throw new Error("Invalid response from OpenL.io API (missing text field)");
    }

    const textContent = responseData.text;
    console.log(`Received OCR text (first 100 chars): ${textContent.substring(0, 100)}`);

    const outputFile = `${path.basename(imagePath, path.extname(imagePath))}.txt`;
    const outputPath = path.join(path.dirname(imagePath), outputFile);
    fs.writeFileSync(outputPath, textContent, "utf8");
    console.log(`Saved OCR text to: ${outputPath}`);

    removeLockFile(imagePath);

    return { success: true, filename, outputFile };
  } catch (error) {
    removeLockFile(imagePath);
    console.error(`OCR processing error for ${path.basename(imagePath)}:`, error);
    return {
      success: false,
      filename: path.basename(imagePath),
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
} 