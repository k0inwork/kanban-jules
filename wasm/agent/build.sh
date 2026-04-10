#!/bin/sh
cd "$(dirname "$0")"
GOOS=wasip1 GOARCH=wasm go build -o agent.wasm . && echo "built agent.wasm ($(wc -c < agent.wasm) bytes)"
