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

# Exercise Poppler's actual PDF-to-PNG path as the same unprivileged user.
command -v pdftoppm
pdftoppm -v
python3 - <<'PY'
from pathlib import Path
# Generate a minimal self-contained PDF with correctly calculated xref offsets.
objects = [
    b"<< /Type /Catalog /Pages 2 0 R >>",
    b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] /Contents 4 0 R /Resources << >> >>",
    b"<< /Length 25 >>" + bytes([10]) + b"stream" + bytes([10]) + b"0 0 0 rg 10 10 40 40 re f" + bytes([10]) + b"endstream"
]
data = bytearray(b"%PDF-1.4\n")
offsets = [0]
for n, obj in enumerate(objects, 1):
    offsets.append(len(data))
    data.extend(f"{n} 0 obj\n".encode() + obj + b"\nendobj\n")
xref = len(data)
data.extend(f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode())
for offset in offsets[1:]:
    data.extend(f"{offset:010d} 00000 n \n".encode())
data.extend(f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
Path("smoke.pdf").write_bytes(data)
PY
pdftoppm -f 1 -l 1 -singlefile -png -r 120 smoke.pdf smoke-output
python3 - <<'PY'
from pathlib import Path
png = Path("smoke-output.png").read_bytes()
assert png.startswith(bytes.fromhex("89504e470d0a1a0a")), "pdftoppm output is not PNG"
assert len(png) > 50, "pdftoppm produced an empty PNG"
print("Poppler PDF rasterization smoke: PASS")
PY
