package trivy

default ignore = false

# Explicit, narrow risk acceptance for 2026-11-08 through 2026-12-08.
# linux-libc-dev contains build-time kernel API headers, NOT the running Linux
# kernel. Trivy maps Linux source-package CVEs to the headers even where the
# vulnerability applies only to running kernel code. See raw findings report.
# Scope: only vulnerability results on this one package. All other vulnerability
# and secret findings remain blocking. A separate workflow gate expires this
# exception on 2026-12-08 for mandatory re-review.
ignore {
  input.Type == "vulnerability"
  input.PkgName == "linux-libc-dev"
}
