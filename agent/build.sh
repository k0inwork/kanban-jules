#!/usr/bin/env bash
# Build yuan tools for v86 (386 Linux emulation)
set -euo pipefail

cd "$(dirname "$0")"

echo "Building yuan-chat for v86 (GOOS=linux GOARCH=386)..."
GOOS=linux GOARCH=386 go build -o yuan-chat.386 yuan-chat.go
echo "Built: yuan-chat.386 ($(stat -c%s yuan-chat.386) bytes)"

echo "Building yuan-channel for v86 (GOOS=linux GOARCH=386)..."
GOOS=linux GOARCH=386 go build -o yuan-channel.386 yuan-channel.go
echo "Built: yuan-channel.386 ($(stat -c%s yuan-channel.386) bytes)"
