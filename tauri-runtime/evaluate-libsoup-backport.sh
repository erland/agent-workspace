#!/usr/bin/env bash
# Feasibility-only experiment. NEVER install evaluated packages into the Tauri
# release image or change the Trivy gate without a separate security review.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
export LC_ALL=C

OUT="/results"
mkdir -p "$OUT"
exec > >(tee "$OUT/build.log") 2>&1

echo "Evaluation: libsoup3 Debian unstable source 3.8.0-3 on Debian 13"
. /etc/os-release
test "$ID" = debian
test "$VERSION_ID" = 13
echo "OS: $PRETTY_NAME"

apt-get update
apt-get install -y --no-install-recommends ca-certificates dpkg-dev devscripts build-essential   debhelper dh-sequence-gir meson ninja-build pkg-config apt-utils gnupg   python3 python3-pip python3-setuptools
# Trust only Debian's existing archive signing keys. The additional sid entry
# is source-only, and must NOT grant installation of binary packages from sid.
printf 'Types: deb-src\nURIs: https://deb.debian.org/debian\nSuites: sid\nComponents: main\nSigned-By: /usr/share/keyrings/debian-archive-keyring.gpg\n' \
  > /etc/apt/sources.list.d/sid-source.sources
# Debian trixie-backports offers debhelper 14 while other binary packages
# still resolve from stable unless explicitly requested. No unstable binary repo.
printf 'Types: deb\\nURIs: https://deb.debian.org/debian\\nSuites: trixie-backports\\nComponents: main\\nSigned-By: /usr/share/keyrings/debian-archive-keyring.gpg\\n' \\
  > /etc/apt/sources.list.d/trixie-backports.sources
apt-get update
apt-get install -y --no-install-recommends -t trixie-backports debhelper
mkdir -p /src
cd /src
apt-get source "libsoup3=3.8.0-3"
test -d libsoup3-3.8.0
cd libsoup3-3.8.0
echo "SOURCE_VERSION=$(dpkg-parsechangelog -S Version)"
echo "SOURCE_SHA256S:"
sha256sum /src/libsoup3_3.8.0* || true

# The src package from sid is allowed as build input; dependencies must remain
# from stable Debian 13. apt-get build-dep resolves only stable binary repositories.
apt-get build-dep -y --no-install-recommends . 
dpkg-buildpackage -us -uc -b -j2
find /src -maxdepth 1 -type f -name '*.deb' -printf '%f\n' | tee "$OUT/built-debs.txt"
test -s "$OUT/built-debs.txt"
echo 'FEASIBILITY=PASS (compile only, NOT security-approved or deployed)'
