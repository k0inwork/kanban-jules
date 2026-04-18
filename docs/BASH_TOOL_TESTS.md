# Bash Executor — Test Documentation

## Test Suites

### 1. Unit Tests (vitest)

**File**: `src/modules/bash-executor/BashExecutorHandler.test.ts`
**Run**: `npx vitest run src/modules/bash-executor/BashExecutorHandler.test.ts`
**Duration**: ~130ms

Mocks `boardVM` on `globalThis` and tests handler logic without a real VM.

| Test | What it verifies |
|------|-----------------|
| default cwd /home/project | `exec` uses `/home/project` when no cwd given |
| custom cwd and timeout | `exec` forwards cwd/timeout to bashExec |
| timeout capped at 120s | `exec` clamps timeout to 120000ms max |
| missing command | `exec` returns error when command is empty |
| no boardVM | `exec` returns error when bashExec unavailable |
| copy repo-root to project | `clone` copies `/tmp/repo-root` → `/home/project` |
| repo not cloned | `clone` returns error when prefetch not done |
| no boardVM on clone | `clone` returns error when boardVM unavailable |
| skip prefetch | `init` skips when no repoUrl configured |

### 2. E2E Tests (puppeteer)

**File**: `tests/bash-executor.e2e.test.ts`
**Run**: `npx vitest run tests/bash-executor.e2e.test.ts`
**Duration**: ~90s (v86 boot takes 30-60s)
**Requirements**: port 3099 free, chromium available

Starts its own dev server on port 3099, boots v86 in headless chromium, waits for boardVM, then exercises the full stack:

| Test | What it verifies |
|------|-----------------|
| boardVM.bashExec available | VM boot completes and Go WASM registers the bridge |
| echo command | Simple `echo hello-e2e` returns stdout with exitCode 0 |
| file round-trip | Write via bashExec, read via fsBridge.readFile, cleanup via fsBridge.rm |
| non-zero exit code | `exit 42` reports exitCode 42 |
| command timeout | `sleep 60` with 3s timeout returns exitCode -1 and error message |

## Data Flow Tested

```
Unit test:  handler → mock boardVM.bashExec → assert args/result
E2E test:   page.evaluate → boardVM.bashExec → OSC 89 → session-mux
            → shell fork → /tmp/bash-exec/<id>/ files → fsBridge poll → result
```

## Running All Tests

```bash
# Unit only (fast, no browser needed)
npx vitest run src/modules/bash-executor/BashExecutorHandler.test.ts

# E2E (needs free port 3099, boots real VM)
npx vitest run tests/bash-executor.e2e.test.ts

# All tests
npx vitest run
```
