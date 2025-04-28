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
  text?: string;
  error?: string;
}

export async function performOCR(
  imageBuffer: Buffer,
  filename: string,
  config: OCRConfig,
  proxyManager: ProxyManager
): Promise<OCRResult> {
  try {
    console.log(`Processing image: ${filename}`);

    // Determine image type from filename
    const extension = filename.split('.').pop()?.toLowerCase() || '';
    const mimeType = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'bmp': 'image/bmp'
    }[extension] || 'image/jpeg';

    // Create form data
    const formData = new FormData();
    formData.append("i2ocr_languages", "ir,urd");
    formData.append("engine_options", "engine_3");
    formData.append("layout_options", "single_column");
    formData.append("i2ocr_options", "file");
    formData.append("ocr_type", "1");

    // Add the image file to form data with correct MIME type
    const imageBlob = new Blob([imageBuffer], { type: mimeType });
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
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const responseText = await response.text();
    console.log(`Raw API response (first 200 chars): ${responseText.substring(0, 200)}`);

    // Check for error message in response
    if (responseText.includes("Invalid Image Type")) {
      throw new Error("Invalid image type. Supported formats: JPG, JPEG, PNG, GIF, BMP");
    }

    // Extract the download link for the text file
    const downloadLinkMatch = responseText.match(
      /\$\(\"#download_text\"\)\.attr\(\"href\", \"([^\"]+)\"\)/
    );

    if (!downloadLinkMatch || !downloadLinkMatch[1]) {
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
      throw new Error(`Failed to download text file: ${textResponse.status}`);
    }

    const textContent = await textResponse.text();
    console.log(`Received OCR text (first 100 chars): ${textContent.substring(0, 100)}`);

    return { success: true, text: textContent };
  } catch (error) {
    console.error(`OCR processing error for ${filename}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
} 