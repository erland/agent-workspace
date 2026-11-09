package trivy

default ignore = false

# Scoped, time-limited build-only waiver. Enforced expiry 2026-12-09 in CI.
# The first rule is the existing Rust kernel-header waiver, unchanged in scope.
ignore {
  input.Type == "vulnerability"
  input.PkgName == "linux-libc-dev"
}

# CVE-2026-3909: Ubuntu 24.04 WebKitGTK 2.52.6.
# Only these six exact Ubuntu WebKitGTK/JavaScriptCore binary packages are
# temporarily accepted for headless *build* use, not desktop/browser tests.
# No other CVE, package, or secret is ignored.
ignore {
  input.Type == "vulnerability"
  input.VulnerabilityID == "CVE-2026-3909"
  allowed := {
    "gir1.2-javascriptcoregtk-4.1",
    "gir1.2-webkit2-4.1",
    "libjavascriptcoregtk-4.1-0",
    "libjavascriptcoregtk-4.1-dev",
    "libwebkit2gtk-4.1-0",
    "libwebkit2gtk-4.1-dev"
  }
  allowed[input.PkgName]
}
