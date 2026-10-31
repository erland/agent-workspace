#!/usr/bin/env bash
set -euo pipefail

# Run inside the image, under the same unprivileged account used in Modal.
test "$(id -u)" -ne 0
test -n "${PLAYWRIGHT_RUNTIME_VERSION:-}"
test -d "${PLAYWRIGHT_BROWSERS_PATH:-/nonexistent}"
export NODE_PATH="$(npm root -g)${NODE_PATH:+:$NODE_PATH}"
node <<'JS'
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
(async () => {
  assert.equal(require('playwright/package.json').version, process.env.PLAYWRIGHT_RUNTIME_VERSION);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto('about:blank');
    assert.equal(await page.evaluate(() => 2 + 2), 4);
    await page.close();
    console.log('Playwright Chromium smoke: PASS');
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
JS
