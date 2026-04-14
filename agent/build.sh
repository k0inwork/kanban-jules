#!/usr/bin/env bash
# Build yuan-channel for v86 (386 Linux emulation)
set -euo pipefail

cd "$(dirname "$0")"

echo "Building yuan-channel for v86 (GOOS=linux GOARCH=386)..."
GOOS=linux GOARCH=386 go build -o yuan-channel.386 yuan-channel.go
echo "Built: yuan-channel.386 ($(stat -c%s yuan-channel.386) bytes)"
