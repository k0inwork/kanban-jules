#!/bin/bash
cd /Users/yanistabuns/opencluade/kanban-jules/wasm/boot
GOOS=js GOARCH=wasm go build -mod=vendor -buildvcs=false -o /Users/yanistabuns/opencluade/kanban-jules/public/assets/wasm/boot.wasm .
echo "EXIT: $?"
