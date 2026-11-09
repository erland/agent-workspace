#!/usr/bin/env python3
"""Guardrail: an exact allowlist and independent expiry, not blanket CVE ignoring."""
from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
rego = (root / "tauri-runtime/trivy-temporary-policy.rego").read_text()
workflow = (root / ".github/workflows/tauri-runtime.yml").read_text()
expected_packages = {
    "gir1.2-javascriptcoregtk-4.1",
    "gir1.2-webkit2-4.1",
    "libjavascriptcoregtk-4.1-0",
    "libjavascriptcoregtk-4.1-dev",
    "libwebkit2gtk-4.1-0",
    "libwebkit2gtk-4.1-dev",
}
rules = re.findall(r"(?m)^ignore \{[\s\S]*?^\}", rego)
assert len(rules) == 2, "Exactly two historical waivers expected"
kernel, webkit = rules
assert 'input.Type == "vulnerability"' in kernel
assert 'input.PkgName == "linux-libc-dev"' in kernel
assert "input.VulnerabilityID" not in kernel
assert 'input.Type == "vulnerability"' in webkit
assert 'input.VulnerabilityID == "CVE-2026-3909"' in webkit
allowed = re.search(r"allowed := \{([\s\S]*?)\}", webkit)
assert allowed, "Explicit package allowlist is required"
found = set(re.findall(r'"([^"]+)"', allowed.group(1)))
assert found == expected_packages, f"Unexpected allowed packages: {found ^ expected_packages}"
assert "allowed[input.PkgName]" in webkit
assert 'ignore-policy: tauri-runtime/trivy-temporary-policy.rego' in workflow
assert '2026-12-08' in workflow and '2026-12-09' in workflow
assert 'if [[ "$today" > "2026-12-09" ]]' in workflow
assert 'exit 1' in workflow
print("WAIVER_SCOPE=PASS exact CVE/packages and enforced expiration")
