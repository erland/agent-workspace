#!/usr/bin/env bash
set -euo pipefail
npm test
npm run typecheck
npm run build
npm run smoke:modal
