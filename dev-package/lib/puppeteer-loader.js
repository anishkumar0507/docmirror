'use strict';

const fs = require('fs');

// puppeteer-core v22+ ships as ESM — require() fails in CommonJS (Vercel + local).
// Dynamic import() works in CJS on Node 18+ and is the recommended serverless pattern.

let puppeteerCoreCache = null;
let puppeteerCache     = null;
let chromiumCache      = null;

/** @returns {Promise<import('puppeteer-core').PuppeteerNode>} */
async function loadPuppeteerCore() {
  if (!puppeteerCoreCache) {
    puppeteerCoreCache = await import('puppeteer-core');
  }
  return puppeteerCoreCache.default || puppeteerCoreCache;
}

/** @returns {Promise<import('puppeteer').PuppeteerNode>} */
async function loadPuppeteer() {
  if (!puppeteerCache) {
    puppeteerCache = await import('puppeteer');
  }
  return puppeteerCache.default || puppeteerCache;
}

/** @returns {Promise<typeof import('@sparticuz/chromium')>} */
async function loadChromium() {
  if (!chromiumCache) {
    chromiumCache = await import('@sparticuz/chromium');
  }
  return chromiumCache.default || chromiumCache;
}

function isServerlessRuntime() {
  return !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

/**
 * Launch a Puppeteer browser — serverless (Vercel/Lambda) or local dev.
 * @returns {Promise<import('puppeteer-core').Browser>}
 */
async function launchBrowser() {
  if (isServerlessRuntime()) {
    const puppeteer = await loadPuppeteerCore();
    const chromium  = await loadChromium();

    return puppeteer.launch({
      args:            chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath:  await chromium.executablePath(),
      headless:        chromium.headless,
    });
  }

  let puppeteer;
  try {
    puppeteer = await loadPuppeteer();
  } catch (_) {
    throw new Error(
      'Puppeteer is not installed.\n' +
      'Open a terminal inside the dev-package folder and run:\n' +
      '  npm install\n' +
      'Then restart server.js.'
    );
  }

  const launchOptions = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  };

  if (process.env.CHROME_PATH) {
    launchOptions.executablePath = process.env.CHROME_PATH;
  } else {
    const chromiumPath = await puppeteer.executablePath();
    if (!fs.existsSync(chromiumPath)) {
      throw new Error(
        'Puppeteer Chromium binary not found.\n' +
        'Run: cd dev-package && npm install\n' +
        'Then restart server.js.'
      );
    }
    launchOptions.executablePath = chromiumPath;
  }

  return puppeteer.launch(launchOptions);
}

module.exports = {
  launchBrowser,
  loadPuppeteerCore,
  loadPuppeteer,
  loadChromium,
  isServerlessRuntime,
};
