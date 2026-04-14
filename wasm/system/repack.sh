#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/../.."
ROOT="$(pwd)"
BUILD_DIR="wasm/system/.build"
OUTPUT_DIR="public/assets/wasm"
TAR_NAME="sys.tar.gz"
OVERLAY_DIR="wasm/system/bin"

run_docker() {
	echo "==> Building base image from Dockerfile.wasm ..."
	rm -rf "$BUILD_DIR"
	docker build -f Dockerfile.wasm --target bundle -t sys-tar-builder .
	echo "==> Extracting Docker output ..."
	mkdir -p "$BUILD_DIR"
	docker create --name sys-tar-extract sys-tar-builder
	docker cp sys-tar-extract:/bundle/. "$BUILD_DIR/"
	docker rm sys-tar-extract
	echo "==> Docker build complete"
}

overlay_files() {
	echo "==> Overlaying $OVERLAY_DIR/ onto $BUILD_DIR/rootfs/bin/"
	for f in "$OVERLAY_DIR"/*; do
		cp -v "$f" "$BUILD_DIR/rootfs/bin/"
		chmod +x "$BUILD_DIR/rootfs/bin/$(basename "$f")"
	done
	# Also overlay agent.wasm if it exists
	if [ -f "wasm/agent/agent.wasm" ]; then
		echo "==> Overlaying wasm/agent/agent.wasm"
		cp -v "wasm/agent/agent.wasm" "$BUILD_DIR/rootfs/bin/"
	fi
	# Also overlay yuan-chat.386 Go binary if it exists
	if [ -f "agent/yuan-chat.386" ]; then
		echo "==> Overlaying agent/yuan-chat.386 as yuan-chat-go"
		cp -v "agent/yuan-chat.386" "$BUILD_DIR/rootfs/bin/yuan-chat-go"
		chmod +x "$BUILD_DIR/rootfs/bin/yuan-chat-go"
	fi
}

repack() {
	echo "==> Repacking $BUILD_DIR -> $OUTPUT_DIR/$TAR_NAME"
	mkdir -p "$OUTPUT_DIR"
	tar -C "$BUILD_DIR" -czf "$OUTPUT_DIR/$TAR_NAME" .
	ls -lh "$OUTPUT_DIR/$TAR_NAME"
	echo "==> Done"
}

# Decide: docker or repack-only
if [ "${1:-}" = "--docker" ] || [ ! -d "$BUILD_DIR" ]; then
	run_docker
fi

overlay_files
repack
