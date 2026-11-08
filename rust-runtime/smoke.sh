#!/usr/bin/env bash
set -euo pipefail
test "$(id -u)" -ne 0
for executable in rustc cargo rustup cc pkg-config python3 jq git zip unzip tar gzip; do
  command -v "$executable" >/dev/null
done
rustc --version | grep -F '1.99.1'
cargo --version
cargo fmt --version
cargo clippy --version
root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT
cd "$root"
cargo new --bin smoke --vcs none
cd smoke
cat > src/main.rs <<'RS'
fn sum(a: i32, b: i32) -> i32 { a + b }
fn main() { assert_eq!(sum(2, 2), 4); }
#[cfg(test)]
mod tests {
    #[test] fn it_adds() { assert_eq!(super::sum(2, 3), 5); }
}
RS
cargo fmt
cargo fmt --check
cargo check --offline
cargo test --offline
cargo clippy --offline --all-targets -- -D warnings
cargo build --offline --release
./target/release/smoke
echo "Rust runtime smoke: PASS"
