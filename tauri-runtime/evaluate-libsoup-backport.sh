#!/usr/bin/env bash
# Feasibility-only experiment. Never install these packages into the release
# image or weaken its Trivy security gate without an explicit security review.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
export LC_ALL=C

OUT="/results"
mkdir -p "$OUT"
exec > >(tee "$OUT/build.log") 2>&1

echo "Evaluation: current signed Debian sid libsoup3 source, min 3.8.0, on Debian 13"
. /etc/os-release
test "$ID" = debian
test "$VERSION_ID" = 13
echo "OS: $PRETTY_NAME"

apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates dpkg-dev devscripts build-essential \
  meson ninja-build pkg-config apt-utils gnupg python3

# Debian sid supplies SOURCE only. Binary packages are never installed from sid.
cat > /etc/apt/sources.list.d/sid-source.sources <<'SOURCES'
Types: deb-src
URIs: https://deb.debian.org/debian
Suites: sid
Components: main
Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg
SOURCES

# Compatible debhelper v14 is available in Debian's signed stable backports.
cat > /etc/apt/sources.list.d/trixie-backports.sources <<'SOURCES'
Types: deb
URIs: https://deb.debian.org/debian
Suites: trixie-backports
Components: main
Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg
SOURCES

apt-get update
apt-get install -y --no-install-recommends -t trixie-backports debhelper
mkdir -p /src
cd /src
apt-cache showsrc libsoup3 | grep '^Version:' | head -10
apt-get source libsoup3
srcdir="$(find /src -mindepth 1 -maxdepth 1 -type d -name 'libsoup3-*' | sort | tail -1)"
test -n "$srcdir"
cd "$srcdir"
source_version="$(dpkg-parsechangelog -S Version)"
dpkg --compare-versions "$source_version" ge "3.8.0-1" || {
  echo "::error::Source version $source_version does not meet patched libsoup minimum 3.8.0" >&2
  exit 1
}
echo "SOURCE_VERSION=$source_version" | tee "$OUT/source-version.txt"
echo "SOURCE_SHA256S:"
sha256sum /src/libsoup3_* | tee "$OUT/source-sha256.txt"

# Source control metadata is from sid but binary build-dependencies are drawn
# only from stable + signed trixie-backports, never from sid.
apt-get build-dep -y --no-install-recommends .
dpkg-buildpackage -us -uc -b -j2
find /src -maxdepth 1 -type f -name '*.deb' -printf '%f\n' | tee "$OUT/built-debs.txt"
test -s "$OUT/built-debs.txt"
echo 'FEASIBILITY=PASS (compile only, NOT security-approved or deployed)'
