#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT
swiftc -parse-as-library -module-cache-path "$TEST_DIR/ModuleCache" \
    "$ROOT/installer/macos/ServerProcess.swift" \
    "$ROOT/installer/macos/test-server-process.swift" \
    -o "$TEST_DIR/shutdown-checks"
"$TEST_DIR/shutdown-checks"
