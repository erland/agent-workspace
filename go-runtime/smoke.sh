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
# Match the verifier subprocess execution style used through Modal.
bash -c 'command -v gofmt >/dev/null && gofmt -l smoke.go smoke_test.go >/dev/null'
# Exercise the executable-package build path used by GO-003.
mkdir -p cmd/demo
printf 'package main\nfunc main() {}\n' > cmd/demo/main.go
go list -f '{{if eq .Name "main"}}{{.ImportPath}}{{end}}' ./...
mkdir -p .agent-workspace-go-bin
go build -trimpath -o .agent-workspace-go-bin/demo ./cmd/demo
test -s .agent-workspace-go-bin/demo
test -x .agent-workspace-go-bin/demo
