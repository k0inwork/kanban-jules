# Agent Migration Proposal: Eino → swarm-go + TinyGo

**Status:** Proposal
**Date:** April 9, 2026
**Estimated Effort:** 5-7 days

## Executive Summary

Migrate the agent implementation from CloudWeGo Eino framework to feiskyer/swarm-go, and compile with TinyGo instead of standard Go. This will reduce WASM size from 23MB to 1-5MB (80-95% reduction), simplify the codebase, and add multi-agent capabilities.

**Key Insight:** The filesystem abstractions (LLMFS, ToolFS) are not storage systems but **RPC channels** between the agent (in WASM sandbox, no network) and the host (with network access). These **remain unchanged** in this migration.

## Current Architecture

### Agent Stack

```
┌─────────────────────────────────────────────────────────────┐
│ Browser Host (TypeScript)                                │
│ • Has network access                                     │
│ • Implements LLM API calls                               │
│ • Implements tool functions (board, git, artifacts, etc.)    │
└────────────────┬────────────────────────────────────────────┘
                 │ (JavaScript hooks: sendPrompt, sendRequest, callTool)
                 ↓
┌─────────────────────────────────────────────────────────────┐
│ Wanix Runtime (JavaScript)                                │
│ • 9p IPC server                                        │
│ • Virtual filesystem provider                              │
│ • Syscall/js bridge (Go ↔ JavaScript)                     │
└────────────────┬────────────────────────────────────────────┘
                 │ (9p protocol over MessageChannel)
                 ↓
┌─────────────────────────────────────────────────────────────┐
│ Wanix Kernel (Go)                                       │
│ • Mounts virtual filesystems:                            │
│   - /#llm/    (LLMFS - RPC to host's LLM API)          │
│   - /#tools/   (ToolFS - RPC to host's tool functions)  │
│   - /#board/   (BoardFS - board state access)            │
│   - /#repo/    (GitFS - repository file access)           │
└────────────────┬────────────────────────────────────────────┘
                 │ (WASM runtime)
                 ↓
┌─────────────────────────────────────────────────────────────┐
│ Agent (agent.wasm, 23MB)                               │
│ • CloudWeGo Eino framework                              │
│ • ReAct agent loop (max 12 steps)                        │
│ • NO network access (sandboxed)                           │
│ • Communicates via virtual filesystems                      │
└─────────────────────────────────────────────────────────────┘
```

### Current Implementation

**Files:**
- `wasm/agent/main.go` (102 lines) - Eino ReAct agent setup
- `wasm/agent/llmmodel.go` (218 lines) - OpenAI format LLM client via LLMFS
- `wasm/agent/pipetool.go` (120 lines) - Tool wrapper via ToolFS
- `wasm/agent/go.mod` - Eino + sonic dependencies
- `wasm/agent/shims/sonic/` - 217-line shim for WASM compatibility

**Dependencies:**
- `github.com/cloudwego/eino` - Complex agent framework
- `github.com/bytedance/sonic` - JSON library (requires shim for WASM)
- `tractor.dev/wanix` - Virtual filesystem runtime

**Agent Flow:**
1. Agent loads tool definitions from `/#tools/list` (ToolFS → JS → host)
2. User sends prompt to agent via command line
3. Agent builds OpenAI JSON request with tools
4. Agent writes to `/#llm/request` (LLMFS → JS → host → LLM API)
5. Host makes actual HTTP call to LLM provider
6. Host stores response, returns to agent via `/#llm/result`
7. If LLM requests tool call:
   - Agent writes to `/#tools/call` (ToolFS → JS → host → tool function)
   - Host executes tool, returns result via `/#tools/result`
8. Repeat until agent completes or max steps (12) reached

## Proposed Architecture

### Migrated Stack

```
┌─────────────────────────────────────────────────────────────┐
│ Browser Host (TypeScript)                                │
│ • Has network access                                     │
│ • Implements LLM API calls                               │
│ • Implements tool functions (board, git, artifacts, etc.)    │
└────────────────┬────────────────────────────────────────────┘
                 │ (JavaScript hooks: sendPrompt, sendRequest, callTool)
                 ↓
┌─────────────────────────────────────────────────────────────┐
│ Wanix Runtime (JavaScript)                                │
│ • 9p IPC server                                        │
│ • Virtual filesystem provider                              │
│ • Syscall/js bridge (Go ↔ JavaScript)                     │
└────────────────┬────────────────────────────────────────────┘
                 │ (9p protocol over MessageChannel)
                 ↓
┌─────────────────────────────────────────────────────────────┐
│ Wanix Kernel (Go)                                       │
│ • Mounts virtual filesystems:                            │
│   - /#llm/    (LLMFS - RPC to host's LLM API)          │
│   - /#tools/   (ToolFS - RPC to host's tool functions)  │
│   - /#board/   (BoardFS - board state access)            │
│   - /#repo/    (GitFS - repository file access)           │
└────────────────┬────────────────────────────────────────────┘
                 │ (WASM runtime)
                 ↓
┌─────────────────────────────────────────────────────────────┐
│ Agent (agent.wasm, 1-5MB)                              │
│ • feiskyer/swarm-go framework                            │
│ • Native Go function calls (wrapped for ToolFS)           │
│ • Multi-agent handoff support                             │
│ • NO network access (sandboxed)                           │
│ • Communicates via virtual filesystems                      │
└─────────────────────────────────────────────────────────────┘
```

### Key Changes

| Component | Current | Proposed | Rationale |
|-----------|---------|-----------|-----------|
| **Agent Framework** | CloudWeGo Eino | feiskyer/swarm-go | Simpler, native functions, multi-agent support |
| **Compiler** | Standard Go (`GOOS=js GOARCH=wasm`) | TinyGo (`-target wasm`) | LLVM-based, 80-95% smaller WASM |
| **JSON Library** | sonic (with shim) | standard `encoding/json` | TinyGo supports stdlib JSON |
| **Dependencies** | Eino + sonic + shim | swarm-go only | Simpler dependency tree |
| **Communication** | LLMFS/ToolFS (virtual filesystems) | **Unchanged** | Still required - no network in WASM |

### What Changes

**Agent Implementation:**
```go
// Before: Eino (wasm/agent/main.go:51-60)
agent, err := react.NewAgent(context.Background(), &react.AgentConfig{
    Model: llm,
    ToolsConfig: compose.ToolsNodeConfig{
        Tools: einoToolsToAny(einoTools),
    },
    MaxStep: 12,
})

// After: swarm-go (simplified)
client := swarm.NewSwarm(swarm.NewCustomClient(llmClient))
agent := swarm.NewAgent("Board Assistant")
agent.WithModel("gpt-4o").
    WithInstructions("You are a coding assistant...")

// Load tools from ToolFS (unchanged)
tools, _ := loadToolsFromPipe()

// Wrap filesystem-based tools as swarm functions
for _, tool := range tools {
    agent.AddFunction(swarm.NewAgentFunction(
        tool.Name,
        tool.Desc,
        func(args map[string]interface{}) (interface{}, error) {
            // Still use ToolFS for RPC to host
            return callToolViaPipe(tool.Name, args)
        },
        toolParams,
    ))
}

response, err := client.Run(context.TODO(), agent, messages, nil, "gpt-4o", false, true, 12, true)
```

**Build Process:**
```yaml
# Before: Standard Go compiler
docker run --rm \
  -v ${{ github.workspace }}/wasm/agent:/build \
  -w /build \
  golang:1.25.0-alpine \
  sh -c "go mod download && GOOS=js GOARCH=wasm go build -o agent.wasm ."

# After: TinyGo compiler
docker run --rm \
  -v ${{ github.workspace }}/wasm/agent:/build \
  -w /build \
  tinygo/tinygo:0.36.0 \
  sh -c "go mod download && tinygo build -o agent.wasm -target wasm -no-debug ."
```

**Dependencies:**
```go
// Before: wasm/agent/go.mod
module agent
go 1.25
replace github.com/bytedance/sonic => ./shims/sonic
require github.com/cloudwego/eino v0.3.6

// After: wasm/agent/go.mod
module agent
go 1.25
require github.com/feiskyer/swarm-go v0.1.0
```

### What Stays the Same

**Virtual Filesystem RPC Layer:**
- `wasm/boot/llmfs.go` (217 lines) - LLM API bridge
- `wasm/boot/toolfs.go` (172 lines) - Tool function bridge
- `wasm/boot/boardfs.go` (272 lines) - Board state access
- `wasm/boot/gitfs.go` (127 lines) - Repository access

**Agent-Host Communication Flow:**
```
agent.go (in WASM)
  → os.WriteFile("/#llm/request", openaiJSON)
  → LLMFS Close() hook calls JavaScript
  → window.boardVM.llmfs.sendRequest(reqJSON)
  → Host makes HTTP call to LLM provider
  → Host stores response in LLMFS
  → agent.go reads os.ReadFile("/#llm/result")
```

**Why These Stay:**
1. Agent runs in Wanix VM sandbox with **no network access**
2. Virtual filesystems are **IPC/RPC channels**, not storage
3. Wanix kernel provides `syscall/js` bridge for Go ↔ JavaScript
4. Host has network access and actual tool implementations
5. No way to bypass this without rearchitecting entire Wanix layer

## Benefits

### 1. Massive Size Reduction

| Metric | Current | Proposed | Improvement |
|--------|---------|-----------|-------------|
| **WASM File Size** | 23MB | 1-5MB (est.) | 80-95% reduction |
| **Download Time** (10Mbps) | 18.4s | 0.8-4s | 78-96% faster |
| **Memory Usage** | ~50MB | ~10MB (est.) | 80% reduction |
| **Parse Time** (V8) | ~2s | ~0.2s (est.) | 90% faster |

**Impact:**
- Faster page load for users
- Lower bandwidth costs
- Better performance on mobile devices
- Smaller browser memory footprint

### 2. Simpler Codebase

| Aspect | Current | After Migration |
|--------|---------|----------------|
| **Agent Setup** | Complex Eino configuration | 10-line swarm-go setup |
| **Tool Integration** | Requires Eino types | Native Go functions |
| **Dependencies** | Eino + sonic shim | swarm-go only |
| **Lines of Code** | ~440 lines | ~300 lines (32% reduction) |
| **Go Modules** | Eino + sonic + shim | swarm-go |

**Before (Eino):**
```go
// 60+ lines of boilerplate
agent, err := react.NewAgent(context.Background(), &react.AgentConfig{
    Model: llm,
    ToolsConfig: compose.ToolsNodeConfig{
        Tools: einoToolsToAny(einoTools),
    },
    MaxStep: 12,
})
if err != nil {
    log.Fatal("create agent:", err)
}

msg, err := agent.Generate(context.Background(), []*schema.Message{
    schema.SystemMessage(systemPrompt()),
    schema.UserMessage(prompt),
})
```

**After (swarm-go):**
```go
// 10 lines of simple setup
client := swarm.NewSwarm(swarm.NewCustomClient(llmClient))
agent := swarm.NewAgent("Assistant")
agent.WithModel("gpt-4o").WithInstructions(systemPrompt())

response, err := client.Run(context.TODO(), agent, messages, nil, "gpt-4o", false, true, 12, true)
```

### 3. Multi-Agent Capabilities

swarm-go has built-in agent handoff:

```go
// Specialist agents for different tasks
codeAgent := swarm.NewAgent("Code Agent")
codeAgent.WithInstructions("You write and modify code.")

reviewAgent := swarm.NewAgent("Review Agent")
reviewAgent.WithInstructions("You review code for bugs and best practices.")

// Handoff function
transferToReview := swarm.NewAgentFunction(
    "requestCodeReview",
    "Request code review from Review Agent",
    func(args map[string]interface{}) (interface{}, error) {
        return reviewAgent, nil // Return agent to hand off to
    },
    []swarm.Parameter{},
)

codeAgent.AddFunction(transferToReview)

// User: "Write a function to sort an array, then review it"
// Code Agent writes function → calls requestCodeReview → Review Agent reviews
```

**Use Cases:**
- **Specialist agents**: Code, Review, Testing, Documentation
- **Language-specific agents**: TypeScript, Python, Go
- **Domain-specific agents**: Database, API, UI
- **User interaction agents**: English, Spanish, etc.

### 4. Better WASM Optimization

TinyGo is specifically designed for WASM targets:

| Feature | Standard Go | TinyGo |
|---------|-------------|---------|
| **Compiler** | Go compiler | LLVM-based |
| **Standard Library** | Full (large) | Minimal (WASM-focused) |
| **GC** | Full Go GC | Conservative GC |
| **WASM Support** | Basic | First-class |
| **Size Optimization** | Minimal | Aggressive tree-shaking |

**Impact:**
- TinyGo removes unused code at compile time
- Smaller standard library (only WASM-relevant features)
- LLVM optimizations for WASM target
- Better run-time performance in V8 engine

### 5. Removed Complexity

**Deleted Files:**
- `wasm/agent/shims/sonic/` (entire directory, ~217 lines)
  - `loader/loader.go`
  - `ast/ast.go`
  - `sonic.go`

**Why Removed:**
- Standard Go's `encoding/json` works in TinyGo without shim
- Sonic is optimized for speed, but WASM bottleneck is elsewhere (IPC, network latency)
- Shim adds complexity and maintenance burden

## Migration Plan

### Phase 1: Proof of Concept (2 days)

**Goal:** Demonstrate swarm-go can replace Eino with existing LLMFS/ToolFS

**Tasks:**
1. Create `wasm/agent/main.go` with swarm-go
2. Implement filesystem-based LLM client (wrap existing llmmodel.go)
3. Implement filesystem-based tool wrappers (wrap existing pipetool.go)
4. Update `wasm/agent/go.mod`:
   ```go
   module agent
   go 1.25
   require github.com/feiskyer/swarm-go v0.1.0
   ```
5. Test locally with standard Go compiler (don't use TinyGo yet)

**Success Criteria:**
- Agent loads tools from `/#tools/list`
- Agent sends prompt to LLM via `/#llm/request`
- Agent receives response via `/#llm/result`
- Agent can call tools via `/#tools/call`
- No behavior changes from current agent

### Phase 2: TinyGo Migration (1 day)

**Goal:** Compile with TinyGo and verify compatibility

**Tasks:**
1. Test code compatibility with TinyGo standard library
2. Remove sonic dependency and shims
3. Update `.github/workflows/build-wasm-assets.yml`:
   ```yaml
   - name: Build agent.wasm with TinyGo
     run: |
       docker run --rm \
         -v ${{ github.workflow.workspace }}/wasm/agent:/build \
         -w /build \
         tinygo/tinygo:0.36.0 \
         sh -c "go mod download && tinygo build -o agent.wasm -target wasm -no-debug ."
   ```
4. Build and test WASM file size
5. Verify runtime behavior in browser

**Success Criteria:**
- WASM compiles without errors
- WASM size is < 5MB (down from 23MB)
- Agent runs correctly in Wanix VM
- All tool invocations work

### Phase 3: Optimization & Testing (2-3 days)

**Goal:** Leverage swarm-go features and optimize for production

**Tasks:**
1. Add multi-agent handoff for specialist agents:
   - Code Agent (writes/modifies code)
   - Review Agent (code review, linting)
   - Test Agent (generates tests)
2. Add streaming responses (swarm-go supports streaming)
3. Optimize tool integration:
   - Cache tool definitions from `/#tools/list`
   - Batch tool calls when possible
4. Update documentation:
   - `AGENTS.md` - update agent architecture section
   - `docs/apptron-strip-proposal.md` - note migration completion
5. E2E testing:
   - Run `npm run test` (unit tests)
   - Run `npx tsx e2e/terminal-lifecycle.e2e.ts`
   - Manual testing with real board

**Success Criteria:**
- Multi-agent handoff works
- Streaming responses functional
- Test suite passes
- E2E tests pass
- Performance metrics collected (load time, memory, execution time)

### Phase 4: Cleanup (0.5-1 day)

**Goal:** Remove legacy code and update documentation

**Tasks:**
1. Delete `wasm/agent/shims/` directory
2. Remove Eino references from docs
3. Update `AGENTS.md` with new architecture
4. Add migration notes to `CHANGELOG.md`
5. Update CI/CD workflow documentation

**Success Criteria:**
- No unused code in repository
- All documentation updated
- CI/CD workflow documented

## Risk Assessment

### Technical Risks

| Risk | Likelihood | Impact | Mitigation |
|-------|-----------|--------|------------|
| **TinyGo compatibility issues** | Low | High | Phase 2 tests compatibility early; can fallback to standard Go |
| **swarm-go API changes** | Low | Medium | Lock to specific version; update with minor releases |
| **Performance regression** | Low | Medium | Benchmark in Phase 3; optimize hot paths |
| **ToolFS/LLMFS integration breaks** | Low | High | Phase 1 validates integration; keep Eino version as fallback |

### Operational Risks

| Risk | Likelihood | Impact | Mitigation |
|-------|-----------|--------|------------|
| **Deployment downtime** | Low | Medium | Feature flag; gradual rollout |
| **User-visible bugs** | Medium | High | Extensive E2E testing; canary deployment |
| **Build pipeline failure** | Low | Medium | Test workflow changes in draft PR |

### Rollback Plan

If migration fails in production:

1. **Revert code changes:** `git revert <commit-sha>`
2. **Restore previous WASM assets:** `git checkout HEAD~1 public/assets/wasm/agent.wasm`
3. **Deploy hotfix:** Push revert commit, trigger CI workflow
4. **Notify users:** Post update in board UI

**Recovery Time:** < 1 hour (automated CI, manual rollback)

## Effort Estimate

| Phase | Tasks | Effort | Owner |
|-------|-------|---------|-------|
| **Phase 1** | PoC implementation | 2 days | Developer |
| **Phase 2** | TinyGo migration | 1 day | Developer |
| **Phase 3** | Optimization & testing | 2-3 days | Developer + QA |
| **Phase 4** | Cleanup & docs | 0.5-1 day | Developer |
| **Total** | | **5.5-7 days** | |

**Buffer for unknowns:** +2 days = **7.5-9 days**

## Comparison with Alternatives

### Alternative 1: Keep Eino, Optimize Current Stack

**Changes:**
- Optimize agent code
- Reduce Eino feature usage
- Manual tree-shaking

**Pros:**
- No migration risk
- Familiar stack

**Cons:**
- Still 23MB (no size reduction)
- Complex Eino configuration
- No multi-agent support
- No TinyGo optimizations

**Verdict:** Not recommended - misses primary benefits (size reduction, simplicity)

### Alternative 2: Use Different Agent Framework

**Options:**
- LangChain (Go port)
- OpenAI Swarm (Go port, not swarm-go)
- Custom agent framework

**Pros:**
- Potential for better features

**Cons:**
- Higher migration cost (unknown framework)
- Less mature than swarm-go
- No WASM-specific considerations

**Verdict:** Not recommended - swarm-go is best-fit (lightweight, Go-native, WASM-friendly)

### Alternative 3: Remove Wanix VM, Use Pure WASM

**Changes:**
- Remove Wanix kernel
- Direct JavaScript API calls from Go
- Build standalone WASM agent

**Pros:**
- No Wanix dependency
- Potentially smaller

**Cons:**
- Requires complete rearchitecture (2+ weeks)
- Lose boot.wasm functionality (terminal, VM)
- Lose BoardFS, GitFS filesystems
- High risk, high effort

**Verdict:** Not recommended - too disruptive for this proposal's scope

## Success Metrics

### Primary Metrics

| Metric | Target | Measurement |
|--------|---------|--------------|
| **WASM file size** | < 5MB | `ls -lh public/assets/wasm/agent.wasm` |
| **Page load time** | < 5s (10Mbps) | Browser DevTools Network tab |
| **Agent startup time** | < 1s | Console timestamp logging |
| **Memory usage** | < 20MB | Chrome DevTools Memory profiler |

### Quality Metrics

| Metric | Target | Measurement |
|--------|---------|--------------|
| **Test coverage** | > 80% | `npx vitest run --coverage` |
| **E2E test pass rate** | 100% | `npx tsx e2e/*.e2e.ts` |
| **Bug reports** | < 5/month | Issue tracker |
| **Performance regression** | 0% | Benchmark before/after |

### Adoption Metrics

| Metric | Target | Measurement |
|--------|---------|--------------|
| **Successful agent runs** | > 95% | Orchestrator logs |
| **Tool invocation success rate** | > 98% | ToolFS logs |
| **User satisfaction** | > 4/5 | User feedback |

## Post-Migration Roadmap

### Short-term (1-2 months)

1. **Multi-Agent Specialization**
   - Implement Code, Review, Test agents
   - Add agent handoff for complex tasks
   - A/B test single vs multi-agent performance

2. **Performance Optimization**
   - Implement tool result caching
   - Add streaming responses for long-running tasks
   - Optimize LLMFS/ToolFS serialization

3. **Monitoring & Observability**
   - Add agent telemetry (execution time, tool calls, errors)
   - Integrate with existing logging system
   - Create performance dashboards

### Medium-term (3-6 months)

1. **Advanced Multi-Agent Patterns**
   - Agent swarms (parallel execution)
   - Hierarchical agent teams
   - Agent memory across sessions

2. **Tool Expansion**
   - Add more board-specific tools
   - Support for external integrations (GitHub, Jira, etc.)
   - Custom tool registration API

3. **TinyGo Advanced Features**
   - Use TinyGo's `--size` optimizations
   - Experiment with WASM GC tuning
   - Explore TinyGo's `--heap-size` configuration

### Long-term (6-12 months)

1. **Decentralized Agents**
   - Run agents in workers for parallelism
   - Agent-to-agent communication without host mediation
   - Agent marketplace (third-party agents)

2. **ML-Based Optimization**
   - Learn optimal agent selection per task type
   - Dynamic agent handoff based on task complexity
   - Auto-tuning of hyperparameters

## Dependencies

### External Dependencies

| Dependency | Version | Purpose | Update Frequency |
|-------------|----------|---------|------------------|
| `github.com/feiskyer/swarm-go` | v0.1.0 | Agent framework | Monthly |
| `tinygo/tinygo` (Docker) | 0.36.0 | Compiler | Quarterly |
| `tractor.dev/wanix` | Latest | Runtime | As needed |

### Internal Dependencies

| Component | Impact | Notes |
|-----------|--------|-------|
| `wasm/boot/llmfs.go` | None | Used as-is |
| `wasm/boot/toolfs.go` | None | Used as-is |
| `src/modules/executor-wasm/` | Minor | Agent interface unchanged |
| `src/core/orchestrator.ts` | None | No changes needed |
| `src/services/GitFs.ts` | None | No changes needed |

## Documentation Updates

### Files to Update

1. **AGENTS.md**
   - Update agent architecture diagram
   - Document swarm-go migration
   - Remove Eino references
   - Add multi-agent examples

2. **docs/apptron-strip-proposal.md**
   - Note migration completion
   - Update size estimates (actual vs estimated)
   - Remove "aptn-tinygo not needed initially" (now used)

3. **README.md**
   - Update WASM build instructions
   - Note TinyGo compiler requirement
   - Add agent architecture link

4. **.github/workflows/build-wasm-assets.yml**
   - Update build command (Go → TinyGo)
   - Add version variables (GO_VERSION, TINYGO_VERSION)

### New Documentation

1. **docs/agent-migration.md** (this file)
   - Migration plan
   - Decision rationale
   - Rollback procedures

2. **docs/multi-agent-guide.md**
   - How to create specialist agents
   - Agent handoff patterns
   - Best practices

3. **docs/agent-telemetry.md**
   - Metrics to collect
   - How to analyze agent performance
   - Optimization recommendations

## Approval Checklist

- [ ] Technical review completed
- [ ] Security review completed (no new attack vectors introduced)
- [ ] Performance review completed (size, speed, memory targets met)
- [ ] Documentation review completed
- [ ] QA sign-off (all tests pass)
- [ ] Product owner approval
- [ ] Stakeholder notification sent
- [ ] Rollback plan documented
- [ ] Monitoring/alerting configured

## References

### Links

- **swarm-go:** https://github.com/feiskyer/swarm-go
- **TinyGo:** https://tinygo.org/
- **CloudWeGo Eino:** https://github.com/cloudwego/eino
- **Wanix:** https://github.com/tractordev/wanix
- **apptron-strip-proposal:** /docs/apptron-strip-proposal.md

### Related Proposals

- **Apptron Strip Proposal:** `/docs/apptron-strip-proposal.md` - Wanix VM architecture
- **Modules System:** `/docs/modules-spec.md` - Module registry and tool definitions

### Commits

- `cbcfc84` - feat(llmfs): add LLMFS 9p filesystem with real API calls
- `3fb1c32` - feat(wasm): add WASM terminal with v86 VM boot
- `c03e270` - wanix runs

---

**Next Steps:**

1. Review this proposal with team
2. Assign Phase 1 owner and timeline
3. Create tracking issue on GitHub
4. Begin Phase 1: Proof of Concept
