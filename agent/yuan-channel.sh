#!/usr/bin/env bash
# yuan-channel.sh — shell wrapper for YUAN FS channel interaction.
#
# Quick interactive interface to the YUAN agent via filesystem channels.
# Works with the Go yuan-channel binary or standalone with curl.
#
# Usage:
#   ./yuan-channel.sh                    # interactive mode
#   ./yuan-channel.sh "Fix the bug"      # one-shot message
#   ./yuan-channel.sh --status           # check agent status
#   ./yuan-channel.sh --watch            # watch output continuously
#
# Environment:
#   YUAN_DIR     — channel directory (default: .yuan)
#   YUAN_HOST    — Fleet server host (default: localhost)
#   YUAN_PORT    — Fleet server port (default: 5173)

set -euo pipefail

YUAN_DIR="${YUAN_DIR:-.yuan}"
YUAN_HOST="${YUAN_HOST:-localhost}"
YUAN_PORT="${YUAN_PORT:-3000}"
YUAN_URL="http://${YUAN_HOST}:${YUAN_PORT}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Ensure channel directory exists
ensure_channels() {
  mkdir -p "${YUAN_DIR}/llm"
  for f in in out status tools llm/req llm/res; do
    touch "${YUAN_DIR}/${f}"
  done
  [ -s "${YUAN_DIR}/status" ] || echo "idle" > "${YUAN_DIR}/status"
}

# Send message to agent via FS channel
send_message() {
  local msg="$1"
  echo "running" > "${YUAN_DIR}/status"
  echo "${msg}" > "${YUAN_DIR}/in"
  echo -e "${BLUE}Sent:${NC} ${msg}"
  
  # If Go binary is running, it handles the rest via file watch.
  # Otherwise, send directly via HTTP.
  if ! pgrep -f "yuan-channel" > /dev/null 2>&1; then
    local response
    response=$(curl -s -X POST "${YUAN_URL}/api/yuan/send" \
      -H "Content-Type: application/json" \
      -d "{\"message\": $(printf '%s' "${msg}" | jq -Rs .)}" 2>&1) || true
    
    if [ -n "${response}" ]; then
      echo "${response}" > "${YUAN_DIR}/out"
      echo "idle" > "${YUAN_DIR}/status"
      echo -e "${GREEN}Response:${NC}"
      echo "${response}" | jq -r '.response // .' 2>/dev/null || echo "${response}"
    else
      echo "error" > "${YUAN_DIR}/status"
      echo -e "${RED}Error: No response from agent${NC}"
    fi
  else
    # Wait for Go binary to process
    echo -e "${YELLOW}Waiting for response...${NC}"
    local timeout=120
    local elapsed=0
    while [ "${elapsed}" -lt "${timeout}" ]; do
      local status
      status=$(cat "${YUAN_DIR}/status" 2>/dev/null || echo "unknown")
      if [ "${status}" = "idle" ] || [ "${status}" = "error" ]; then
        break
      fi
      sleep 0.5
      elapsed=$((elapsed + 1))
    done
    echo -e "${GREEN}Response:${NC}"
    cat "${YUAN_DIR}/out"
  fi
}

# Show current status
show_status() {
  local status
  status=$(cat "${YUAN_DIR}/status" 2>/dev/null || echo "unknown")
  case "${status}" in
    idle)    echo -e "${GREEN}Status: idle${NC}" ;;
    running) echo -e "${YELLOW}Status: running${NC}" ;;
    error)   echo -e "${RED}Status: error${NC}" ;;
    *)       echo -e "Status: ${status}" ;;
  esac
}

# Watch output continuously
watch_output() {
  echo -e "${BLUE}Watching ${YUAN_DIR}/out (Ctrl+C to stop)${NC}"
  tail -f "${YUAN_DIR}/out" 2>/dev/null
}

# Interactive REPL
interactive_mode() {
  echo -e "${BLUE}YUAN Agent Interactive Channel${NC}"
  echo "=============================="
  echo "Channel dir: ${YUAN_DIR}"
  echo "Server:      ${YUAN_URL}"
  echo ""
  echo "Type a message and press Enter."
  echo "Commands: /status, /tools, /out, /quit"
  echo ""
  
  while true; do
    echo -ne "${BLUE}yuan>${NC} "
    read -r line || break
    
    [ -z "${line}" ] && continue
    
    case "${line}" in
      /quit|/exit)
        echo "Goodbye."
        break
        ;;
      /status)
        show_status
        ;;
      /tools)
        cat "${YUAN_DIR}/tools" 2>/dev/null || echo "No tools loaded"
        ;;
      /out)
        cat "${YUAN_DIR}/out" 2>/dev/null || echo "No output yet"
        ;;
      /help)
        echo "Commands: /status, /tools, /out, /quit, /help"
        ;;
      *)
        send_message "${line}"
        ;;
    esac
    echo ""
  done
}

# --- Main ---

ensure_channels

case "${1:-}" in
  --status|-s)
    show_status
    ;;
  --watch|-w)
    watch_output
    ;;
  --help|-h)
    echo "Usage: yuan-channel.sh [message | --status | --watch | --help]"
    echo ""
    echo "Options:"
    echo "  (no args)     Interactive mode (REPL)"
    echo "  \"message\"     Send a single message"
    echo "  --status, -s  Show agent status"
    echo "  --watch, -w   Watch output continuously"
    echo "  --help, -h    Show this help"
    ;;
  "")
    interactive_mode
    ;;
  *)
    send_message "$*"
    ;;
esac
