#!/usr/bin/env bash
set -euo pipefail
[ "$(id -u)" != 0 ]
[ "$(go env GOTOOLCHAIN)" = "local" ]
command -v git
go version
mkdir -p /workspace/smoke
cd /workspace/smoke
printf 'module example.com/smoke\n\ngo 1.27\n' > go.mod
printf 'package smoke\nfunc Add(a,b int) int { return a+b }\n' > smoke.go
printf 'package smoke\nimport "testing"\nfunc TestAdd(t *testing.T) { if Add(1,2)!=3 {t.Fatal("unexpected result")} }\n' > smoke_test.go
go test ./...
go vet ./...
go build ./...
