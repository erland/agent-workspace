#!/usr/bin/env bash
set -euo pipefail
test "$(id -u)" -ne 0
node --version | grep -F 'v22.21.1'
npm --version
rustc --version | grep -F '1.99.1'
cargo fmt --version
cargo clippy --version
for lib in webkit2gtk-4.1 ayatana-appindicator3-0.1 librsvg-2.0; do
  pkg-config --exists "$lib"
  pkg-config --modversion "$lib"
done
test -f /usr/include/xdo.h
root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT
cd "$root"
cargo new --bin tauri-runtime-smoke --vcs none
cd tauri-runtime-smoke
cat > src/main.rs <<'RS'
fn double(x: u32) -> u32 { x * 2 }
fn main() { assert_eq!(double(4), 8); }
#[cfg(test)]
mod tests {
    #[test] fn doubles() { assert_eq!(super::double(3), 6); }
}
RS
cargo fmt
cargo fmt --check
cargo check --offline
cargo test --offline
cargo clippy --offline --all-targets -- -D warnings
cargo build --offline --release
./target/release/tauri-runtime-smoke
node -e 'if(process.versions.node.split(".")[0] !== "22") process.exit(1)'
echo "Tauri runtime prerequisites and Rust/Node smoke: PASS"
