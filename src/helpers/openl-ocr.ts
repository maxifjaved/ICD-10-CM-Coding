import fs from 'fs';
import path from 'path';
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

    // Create form data
    const formData = new FormData();
    formData.append("i2ocr_languages", "ir,urd");
    formData.append("engine_options", "engine_3");
    formData.append("layout_options", "single_column");
    formData.append("i2ocr_options", "file");
    formData.append("ocr_type", "1");

    // Add the image file to form data
    const imageBuffer = fs.readFileSync(imagePath);
    const imageBlob = new Blob([imageBuffer], { type: "image/jpeg" });
    formData.append("i2ocr_uploadedfile", imageBlob, filename);

    formData.append("i2ocr_url", "http://");
    formData.append("x", "");
    formData.append("y", "");
    formData.append("w", "");
    formData.append("h", "");
    formData.append("ly", "single_column");
    formData.append("en", "3");

    // Define headers
    const headers = {
      accept: "*/*",
      "accept-language": "en-GB,en-US;q=0.9,en;q=0.8",
      "cache-control": "no-cache",
      dnt: "1",
      origin: "https://www.i2ocr.com",
      pragma: "no-cache",
      priority: "u=1, i",
      referer: "https://www.i2ocr.com/",
      "sec-ch-ua": '"Not:A-Brand";v="24", "Chromium";v="134"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
      "x-requested-with": "XMLHttpRequest",
      cookie: "PHPSESSID=22glcjcs802p9ukn7tc6oho1vv; SERVERID=s3; trial3=1",
    };

    console.log("Sending request to i2ocr.com...");

    let response;
    if (config.proxy) {
      const proxy = await proxyManager.getProxy();
      if (proxy) {
        console.log(`Using proxy: ${proxy}`);
        const proxyAgent = new HttpsProxyAgent(proxy);
        
        // Create a controller for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), config.proxyTimeout * 1000);
        
        try {
          response = await fetch("https://www.i2ocr.com/process_form", {
            method: "POST",
            headers: headers,
            body: formData,
            agent: proxyAgent,
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeoutId);
        }
        
        proxyManager.releaseProxy(proxy);
      } else {
        console.log("No proxy available, using direct connection");
        response = await fetch("https://www.i2ocr.com/process_form", {
          method: "POST",
          headers: headers,
          body: formData,
        });
      }
    } else {
      response = await fetch("https://www.i2ocr.com/process_form", {
        method: "POST",
        headers: headers,
        body: formData,
      });
    }

    if (!response.ok) {
      removeLockFile(imagePath);
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const responseText = await response.text();
    console.log(`Raw API response (first 200 chars): ${responseText.substring(0, 200)}`);

    // Extract the download link for the text file
    const downloadLinkMatch = responseText.match(
      /\$\(\"#download_text\"\)\.attr\(\"href\", \"([^\"]+)\"\)/
    );

    if (!downloadLinkMatch || !downloadLinkMatch[1]) {
      removeLockFile(imagePath);
      throw new Error("Could not find download link in response");
    }

    const downloadUrl = `https://www.i2ocr.com${downloadLinkMatch[1]}`;
    console.log(`Download URL: ${downloadUrl}`);

    // Download the text file
    let textResponse;
    if (config.proxy) {
      const proxy = await proxyManager.getProxy();
      if (proxy) {
        console.log(`Using proxy for download: ${proxy}`);
        const proxyAgent = new HttpsProxyAgent(proxy);
        
        // Create a controller for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), config.proxyTimeout * 1000);
        
        try {
          textResponse = await fetch(downloadUrl, {
            headers: {
              cookie: headers.cookie,
              referer: "https://www.i2ocr.com/",
              "user-agent": headers["user-agent"],
            },
            agent: proxyAgent,
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeoutId);
        }
        
        proxyManager.releaseProxy(proxy);
      } else {
        console.log("No proxy available for download, using direct connection");
        textResponse = await fetch(downloadUrl, {
          headers: {
            cookie: headers.cookie,
            referer: "https://www.i2ocr.com/",
            "user-agent": headers["user-agent"],
          },
        });
      }
    } else {
      textResponse = await fetch(downloadUrl, {
        headers: {
          cookie: headers.cookie,
          referer: "https://www.i2ocr.com/",
          "user-agent": headers["user-agent"],
        },
      });
    }

    if (!textResponse.ok) {
      removeLockFile(imagePath);
      throw new Error(`Failed to download text file: ${textResponse.status}`);
    }

    const textContent = await textResponse.text();
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