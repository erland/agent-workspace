#!/usr/bin/env bash
set -euo pipefail

# Verify that browser system libraries are present and the unprivileged runtime
# can install the exact browser requested by a project (without apt/root access).
test "$(id -u)" -ne 0
test -n "${PLAYWRIGHT_BROWSERS_PATH:-}"
test -w "$PLAYWRIGHT_BROWSERS_PATH"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cd "$tmp"
npm init -y >/dev/null
npm install --no-audit --no-fund playwright@1.56.1 >/dev/null
node node_modules/playwright/cli.js install chromium --only-shell
node <<'JS'
const assert = require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();
  await page.goto('about:blank');
  assert.equal(await page.evaluate(()=>2+2),4);
  console.log('Project-local Chromium Headless Shell smoke: PASS');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
JS
