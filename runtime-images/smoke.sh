#!/usr/bin/env bash
set -euo pipefail

# Runs as the runtime image's unprivileged user.
test "$(id -u)" -ne 0
for executable in java javac mvn node npm pnpm git python3 jq zip unzip tar gzip; do
  command -v "$executable" >/dev/null
done
node -e 'const x=require("node:assert/strict");x.equal(2+2,4)'
printf '{"pass":true}\n' | jq -e '.pass == true' >/dev/null

root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT

mkdir -p "$root/maven/src/test/java/demo" "$root/npm"
cat > "$root/maven/pom.xml" <<'POM'
<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
<modelVersion>4.0.0</modelVersion><groupId>demo</groupId><artifactId>runtime-smoke</artifactId><version>1.0.0</version>
<properties><maven.compiler.release>17</maven.compiler.release><project.build.sourceEncoding>UTF-8</project.build.sourceEncoding></properties>
<dependencies><dependency><groupId>org.junit.jupiter</groupId><artifactId>junit-jupiter</artifactId><version>5.11.4</version><scope>test</scope></dependency></dependencies>
<build><plugins>
<plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-compiler-plugin</artifactId><version>3.13.0</version></plugin>
<plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-surefire-plugin</artifactId><version>3.5.2</version></plugin>
</plugins></build>
</project>
POM
cat > "$root/maven/src/test/java/demo/SmokeTest.java" <<'JAVA'
package demo;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertEquals;
class SmokeTest { @Test void passes() { assertEquals(4, 2 + 2); } }
JAVA
(cd "$root/maven" && mvn --batch-mode --no-transfer-progress verify)
test -f "$root/maven/target/surefire-reports/TEST-demo.SmokeTest.xml"
grep -q 'tests="1"' "$root/maven/target/surefire-reports/TEST-demo.SmokeTest.xml"

cat > "$root/npm/package.json" <<'JSON'
{"name":"runtime-smoke","version":"1.0.0","private":true,"scripts":{"test":"node --test smoke.test.js","build":"node -e \"require('node:fs').writeFileSync('dist.txt','ok')\""}}
JSON
cat > "$root/npm/smoke.test.js" <<'JS'
const { test } = require('node:test');
const assert = require('node:assert/strict');
test('runtime works', () => assert.equal(2 + 2, 4));
JS
(cd "$root/npm" && npm install --package-lock-only --ignore-scripts --no-audit --no-fund && npm ci --ignore-scripts --no-audit --no-fund && npm test && npm run build)
test "$(cat "$root/npm/dist.txt")" = ok
echo "Runtime smoke: PASS"
