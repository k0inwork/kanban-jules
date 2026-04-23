# LLM Optimization Analysis: Reducing Cost & Latency via Small/Specialized Models

## Executive Summary

The codebase has **12 distinct LLM call sites** across 8 files, all funneling through a single `core/llm.ts` gateway (Gemini + OpenAI-compatible). Of these, **7 calls do classification, extraction, or validation** — tasks that don't require a general-purpose LLM. Using a tiered architecture (local classifiers + small models + API fallback), we can eliminate **~70% of paid API calls** while keeping quality for complex tasks (code generation, planning).

---

## 1. Current LLM Call Inventory

All calls route through `core/llm.ts:4` → `llmCall(config, prompt, jsonMode?)`.

### Tier A: Simple Classification/Validation (replace first)

| # | Site | File:Line | Purpose | Tokens In/Out | JSON |
|---|---|---|---|---|---|
| 1 | Signal/Noise | `JulesPostman.ts:143` | Classify Jules messages | S/S | No ("SIGNAL"/"NOISE") |
| 2 | Format Validation | `UserNegotiator.ts:117` | Check reply matches format | S/S | No ("true"/"false") |
| 3 | Progress Verify | `JulesNegotiator.ts:148` | Check if progress meets criteria | S/S | No ("true"/"false") |
| 4 | Final Verify | `JulesNegotiator.ts:305` | Final output verification | S/S | No ("true"/"false") |

### Tier B: Structured Extraction (replace second)

| # | Site | File:Line | Purpose | Tokens In/Out | JSON |
|---|---|---|---|---|---|
| 5 | Task Extraction | `prompt.ts:29` | Extract tasks from user message | M/S | Yes |
| 6 | Architect Protocol | `Architect.ts:16` | Generate multi-step plan | L/M | Yes |
| 7 | Session Analysis | `JulesNegotiator.ts:246` | Analyze paused Jules session | L/M | Yes |

### Tier C: Complex Generation (keep as API)

| # | Site | File:Line | Purpose | Tokens In/Out | JSON |
|---|---|---|---|---|---|
| 8 | Programmer Codegen | `orchestrator.ts:193` | Generate JavaScript code | L/L | No |
| 9 | Analysis Tool | `orchestrator.ts:80` | Analyze arbitrary data | L/M | Conditional |
| 10 | Project Review | `ProcessAgent.ts:95` | Review project state + propose | L/M | Yes |

### Debug/Test

| # | Site | File:Line | Purpose |
|---|---|---|---|
| 11 | XML Tool Test | `App.tsx:553` | Debug tool-call generation |
| 12 | parseTasksFromMessage callers | `App.tsx:119`, `MailboxView.tsx:75`, `PreviewPane.tsx:41` | Invoke #5 |

---

## 2. Replacement Strategy: Three Approaches

### Approach A: PAW (ProgramAsWeights) — Already Prototyped

Compiles NL specs into LoRA adapters on GPT-2 124M, runs in-browser via WASM.

| Property | Value |
|---|---|
| Base model | GPT-2 124M (~134 MB, cached) |
| Per-program | ~5 MB adapter + ~7 MB prefix cache |
| Compile time | ~100s (one-time, API call) |
| Inference | ~50-200ms, free after compile |
| Runtime | WASM/CPU, no GPU needed |

**Best fit**: Tier A calls (#1-4). Binary or simple multi-class classification.

**Limitation**: GPT-2 124M quality ceiling. Struggles with nuanced extraction or anything requiring reasoning. Each new task type needs a separate compile.

**Already specified**: See `docs/paw-integration-spec.md` for full architecture.

### Approach B: WebLLM — Larger Models in Browser

Runs quantized models (0.5B-3B) via WebGPU in browser. OpenAI-compatible API with JSON mode.

| Model | Download | VRAM | Classif. | Extract. | Summar. |
|---|---|---|---|---|---|
| SmolLM2-360M q4f16 | 194 MB | 376 MB | B+ | C+ | D |
| Qwen2.5-0.5B q4f16 | 265 MB | 945 MB | A- | B | C- |
| Llama-3.2-1B q4f16 | 663 MB | 879 MB | A | B+ | C+ |
| **Qwen2.5-1.5B q4f16** | **828 MB** | **1,630 MB** | **A** | **A-** | **B** |
| Qwen2.5-3B q4f16 | 1,656 MB | 2,505 MB | A+ | A | A- |
| Llama-3.2-3B q4f16 | 1,724 MB | 2,264 MB | A+ | A | B+ |

**Key capabilities**:
- JSON mode via `@mlc-ai/web-xgrammar` (structured output guaranteed)
- Cache API / IndexedDB caching (download once, ~1-3s cold start from cache)
- `engine.reload()` for model swapping at runtime
- No LoRA support (unlike PAW)

**Recommended default**: `Qwen2.5-1.5B-Instruct-q4f16_1-MLC` — best quality-per-byte, handles all Tier A + most Tier B tasks.
**Low-end fallback**: `SmolLM2-360M-Instruct-q4f16_1-MLC` — 194 MB, runs everywhere.

**Latency** (M1-class hardware):
- 1.5B model: ~40-55 tok/s decode, ~500-700 tok/s prefill
- Classification (50 tok in, 10 tok out): **<500ms**
- Extraction (200 tok in, 50 tok out): **<1s**

### Approach C: Encoder-Only Classifiers (Non-Generative)

Specialized classification models from HuggingFace, runnable via Transformers.js in browser:

| Model | Size | Task | Latency |
|---|---|---|---|
| `SamLowe/roberta-base-go_emotions` | 125M | 27-class emotion/sentiment | ~10ms |
| `cardiffnlp/twitter-roberta-base-sentiment-latest` | 125M | 3-class sentiment | ~10ms |
| `MoritzLaurer/mDeBERTa-v3-base-xnli` | 86M | Zero-shot classification | ~20ms |
| `facebook/bart-large-mnli` | 406M | Zero-shot classification (gold std) | ~50ms |
| `knowledgator/GLiNER-medium-v2.1` | ~300M | Zero-shot entity extraction | ~30ms |
| `sentence-transformers/all-MiniLM-L6-v2` | 22M | Embedding similarity (384-dim) | ~5ms |

**Best fit**: Pure classification tasks where labels are known ahead of time. Near-zero latency.

**Not suitable**: Extraction of variable-length text, summarization, any generative task.

---

## 3. Recommended Architecture: PAW-First Hybrid

PAW and WebLLM complement each other perfectly:

| | PAW (GPT-2 + LoRA) | WebLLM (Qwen2.5-1.5B) |
|---|---|---|
| Runs on | Any device (WASM/CPU) | WebGPU only (Chrome/Edge) |
| Setup | Compile once per spec (~100s) | Download once (~828 MB, cached) |
| Strength | Binary/simple classification | Extraction, JSON, multi-class |
| Weakness | Can't extract or summarize | Needs GPU, larger download |

**Strategy**: Always try PAW first (free, instant, works everywhere). Fall back to WebLLM when no PAW program exists for the task or when the task needs extraction/JSON output. Fall back to API when neither is available.

```
Input
  │
  ▼
┌──────────────────────────────┐
│  Tier 0: Rules + Regex       │  ~20% of calls, ~0 cost, <1ms
│  (format validation, etc.)   │
└──────────┬───────────────────┘
           │ needs model
           ▼
┌──────────────────────────────┐
│  Tier 1: PAW (if compiled)   │  ~30% of calls, ~0 cost, ~50-200ms
│  - signal-noise              │  Runs on ANY device (WASM/CPU)
│  - verify-progress           │
│  - format-check              │
└──────────┬───────────────────┘
           │ no PAW program / needs extraction
           ▼
┌──────────────────────────────┐
│  Tier 2: WebLLM 1.5B         │  ~20% of calls, ~0 cost, ~200-500ms
│  (if WebGPU available)       │  JSON Schema mode for structured output
│  - task extraction           │
│  - session analysis          │
│  - complex verification      │
└──────────┬───────────────────┘
           │ no WebGPU / complex task
           ▼
┌──────────────────────────────┐
│  Tier 3: Cheap API           │  ~20% of calls, ~$0.0002/call
│  (Groq Llama-3.1-8B or      │
│   GPT-4o-mini)               │
└──────────┬───────────────────┘
           │ code gen / planning
           ▼
┌──────────────────────────────┐
│  Tier 4: Full API (current)  │  ~10% of calls
│  (Gemini / GPT-4)            │
└──────────────────────────────┘
```

### Decision Flow Per Call

```
For each LLM call:
  1. Can regex/rules handle it?           → Tier 0
  2. Does a PAW program exist for this?    → Tier 1 (PAW)
  3. Is WebGPU available?                  → Tier 2 (WebLLM)
  4. Is it code gen or complex planning?   → Tier 4 (full API)
  5. Otherwise                             → Tier 3 (cheap API)
```

### Call-to-Tier Mapping

| Call Site | Current | Primary | Fallback | Method |
|---|---|---|---|---|
| #1 Signal/Noise | API | **Tier 1** | Tier 2 | PAW `signal-noise` program |
| #2 Format Validation | API | **Tier 0** | Tier 1 | Regex + PAW `format-check` |
| #3 Progress Verify | API | **Tier 1** | Tier 2 | PAW `verify-progress` program |
| #4 Final Verify | API | **Tier 1** | Tier 2 | PAW `verify-output` program |
| #5 Task Extraction | API | **Tier 2** | Tier 3 | WebLLM JSON mode (PAW can't extract) |
| #6 Architect Protocol | API | **Tier 3** | Tier 4 | Groq/GPT-4o-mini (structured plan) |
| #7 Session Analysis | API | **Tier 2** | Tier 3 | WebLLM JSON mode (PAW can't analyze) |
| #8 Programmer Codegen | API | **Tier 4** | — | Keep current (needs code quality) |
| #9 Analysis Tool | API | **Tier 3** | Tier 4 | Groq or GPT-4o-mini |
| #10 Project Review | API | **Tier 3** | Tier 4 | GPT-4o-mini ($0.15/$0.60 per M tok) |

**Key insight**: PAW handles the 4 high-frequency, simple calls (#1-4). WebLLM handles the 2 extraction/analysis calls (#5, #7) that PAW can't. Only planning and code generation hit the API.

---

## 4. Cost Comparison

### Current State (all calls to Gemini/GPT-4)

Assuming ~100 task cycles/day, average 3 LLM calls per step, 5 steps per task:
- ~1,500 calls/day
- Tier A calls (#1-4): ~600 calls × ~$0.002 = **$1.20/day**
- Tier B calls (#5-7): ~450 calls × ~$0.005 = **$2.25/day**
- Tier C calls (#8-10): ~450 calls × ~$0.015 = **$6.75/day**
- **Total: ~$10.20/day = ~$306/month**

### After Optimization

- Tier 0 (rules/embeddings): 600 calls × $0 = **$0**
- Tier 1 (WebLLM local): 450 calls × $0 = **$0**
- Tier 2 (Groq/GPT-4o-mini): 300 calls × ~$0.0003 = **$0.09/day**
- Tier 3 (full API): 150 calls × ~$0.015 = **$2.25/day**
- **Total: ~$2.34/day = ~$70/month**

**Savings: ~77% cost reduction** (from $306 → $70/month)

### One-Time Costs

- PAW compilation (if used): 5-10 programs × ~$0.10 compile = ~$1.00
- WebLLM model download: ~828 MB (cached after first load, free)

---

## 5. PAW vs WebLLM Comparison

| Aspect | PAW (GPT-2 + LoRA) | WebLLM (Qwen2.5-1.5B) |
|---|---|---|
| **Download** | 134 MB base + ~12 MB/program | 828 MB (single model) |
| **VRAM** | Not needed (WASM/CPU) | ~1,630 MB (WebGPU) |
| **Quality** | B+ for classification, C- for extraction | A for classification, A- for extraction |
| **Flexibility** | One program per spec (compile needed) | Any prompt, no compilation |
| **Latency** | 50-200ms | 200-500ms |
| **Structured output** | No (prompt engineering) | Yes (JSON Schema mode) |
| **Multi-task** | Need separate adapter per task | Single model handles all tasks |
| **Device compat** | Runs everywhere (CPU/WASM) | Needs WebGPU (Chrome/Edge) |
| **Setup cost** | ~100s compile per program | None (just download) |
| **Best for** | Very simple, fixed classification | General-purpose replacement |

**Recommendation**: Use **PAW as primary** for all compiled tasks (instant, runs everywhere, zero GPU). Use **WebLLM as the upgrade path** for tasks PAW can't handle (extraction, JSON, analysis). On devices without WebGPU, those tasks fall through to cheap API instead. The decision is per-call, not per-device.

---

## 6. Cheap API Alternatives (Tier 2)

| Provider | Model | Input $/M tok | Output $/M tok | TTFT | Notes |
|---|---|---|---|---|---|
| **Groq** | Llama-3.1-8B-Instant | $0.05 | $0.08 | ~15ms | Fastest API. Free tier available. |
| **Groq** | Gemma-2-9B-it | $0.20 | $0.20 | ~20ms | Better quality. |
| OpenAI | GPT-4o-mini | $0.15 | $0.60 | ~200ms | Best structured output. |
| Google | Gemini 2.0 Flash | $0.10 | $0.40 | ~150ms | Generous free tier. |
| Together AI | Qwen2.5-0.5B | ~$0.01 | ~$0.01 | ~30ms | Cheapest. Classification only. |
| Cerebras | Llama-3.1-8B | ~$0.10 | ~$0.10 | ~10ms | Hardware-optimized speed. |

**Recommended Tier 2 default**: Groq Llama-3.1-8B-Instant — $0.05/$0.08 per M tokens, 15ms TTFT, adequate for protocol generation and analysis.

---

## 7. Hybrid Approach: Embeddings + Rules

For the simplest tasks, no generative model is needed at all:

### Signal/Noise Classification (#1)

```typescript
// Pre-compute anchor embeddings
const SIGNAL_EMBEDDING = await embed("error crash failed urgent critical question");
const NOISE_EMBEDDING = await embed("progress update working thinking log output");

// Classify by cosine similarity
function classifyMessage(text: string): "SIGNAL" | "NOISE" {
  const emb = await embed(text);
  const sigScore = cosineSimilarity(emb, SIGNAL_EMBEDDING);
  const noiseScore = cosineSimilarity(emb, NOISE_EMBEDDING);
  return sigScore > noiseScore ? "SIGNAL" : "NOISE";
}
```

**Cost**: $0. **Latency**: ~5ms. **Quality**: B+ (degrades on ambiguous messages).

### Format Validation (#2)

Most format checks can be done with regex:

```typescript
function validateReply(reply: string, format: string): boolean {
  if (format === "yes/no") return /^(yes|no)$/i.test(reply.trim());
  if (format === "number") return /^\d+(\.\d+)?$/.test(reply.trim());
  if (format === "url") return /^https?:\/\//.test(reply.trim());
  // Fallback to WebLLM for complex formats
  return null; // escalate to model
}
```

**Cost**: $0. **Latency**: <1ms. **Covers**: ~80% of format validations.

---

## 8. Cold Start & Progressive Readiness

On first visit, nothing is local — no PAW programs compiled, no WebLLM model downloaded. The system must degrade gracefully.

### Readiness States

```
State A: COLD START (first visit)
  - No PAW programs in IndexedDB
  - No WebLLM model cached
  - All calls → current API (no regression)

State B: PAW READY (after background compile)
  - 4 core PAW programs compiled and stored
  - Tier A calls (#1-4) → PAW (free, instant)
  - Everything else → API

State C: WEBLLM READY (after background download)
  - Qwen2.5-1.5B cached in browser
  - Tier A → PAW, Tier B (#5,#7) → WebLLM
  - Only planning/codegen → API

State D: FULLY OPTIMIZED (both ready)
  - All tiers active, 77% cost reduction
```

### Background Warmup Strategy

On app load, kick off non-blocking background tasks:

```
App Load
  │
  ├─► Check IndexedDB for PAW programs
  │     Missing? → Queue background compile (one at a time, ~100s each)
  │     Compile uses existing API key, runs in service worker or background tab
  │
  ├─► Check WebGPU availability
  │     Available? → Start WebLLM model download (~828 MB)
  │     Cache API stores it, ~2-5 min download on broadband
  │     Show subtle progress indicator in UI
  │
  └─► All LLM calls use API until local resources are ready
```

### Per-Call Level System

Each `llmCall` site declares its **level** — how local it can go. If the required model is missing, it escalates to the next available level.

**Levels**:
- `static` — PAW compiled program (smallest, fastest, runs everywhere via WASM)
- `dynamic` — WebLLM local model (larger, needs WebGPU, but flexible)
- `global` — Remote API (always works, costs money)

```typescript
type LlmLevel = 'static' | 'dynamic' | 'global';

// Each call site declares its preferred level
const CALL_LEVELS: Record<string, LlmLevel> = {
  'signal-noise':      'static',   // PAW program exists
  'format-validate':   'static',   // PAW program exists
  'verify-progress':   'static',   // PAW program exists
  'verify-output':     'static',   // PAW program exists
  'task-extract':      'dynamic',  // needs extraction capability
  'session-analyze':   'dynamic',  // needs JSON analysis
  'architect-plan':    'global',   // needs planning quality
  'programmer-codegen':'global',   // needs code generation
  'analyze-tool':      'global',   // needs reasoning
  'project-review':    'global',   // needs full context
};

async function llmCall leveled(
  callSite: string,
  prompt: string,
  jsonMode?: boolean
): Promise<string> {
  const level = CALL_LEVELS[callSite] ?? 'global';

  // Try preferred level first, escalate if model missing
  if (level === 'static') {
    const pawResult = await tryPaw(callSite, prompt);
    if (pawResult) return pawResult;
    // PAW not compiled → try dynamic
  }

  if (level === 'static' || level === 'dynamic') {
    const webllmResult = await tryWebLLM(prompt, jsonMode);
    if (webllmResult) return webllmResult;
    // WebLLM not ready → fall to global
  }

  // Global: always available
  return await llmCall(currentConfig, prompt, jsonMode);
}
```

**Escalation path**:
```
static  →  dynamic  →  global
(PAW)      (WebLLM)    (API)

Call wants "static":
  PAW ready?    → use PAW (done)
  PAW missing?  → WebLLM ready? → use WebLLM (done)
                   WebLLM missing? → use API (done)

Call wants "dynamic":
  WebLLM ready?  → use WebLLM (done)
  WebLLM missing? → use API (done)

Call wants "global":
  → use API (always)
```

**Key principle**: Every call site declares its level. Missing models escalate upward — never fail. On cold start, everything escalates to `global` (current API behavior). As models compile/download, calls automatically shift local.

### Triggering Compilation

PAW programs should be compiled opportunistically, not on-demand:

| Trigger | Action |
|---|---|
| First app load | Queue compile of `signal-noise` (highest frequency call) |
| User configures API key | Queue remaining programs |
`verify-progress`, `format-check`, `verify-output` |
| User opens PAW settings | Show compile status, allow manual recompile |
| Spec changes (dynamic programs) | Recompile only affected program |

### WebLLM Download Strategy

| Trigger | Action |
|---|---|
| App load + WebGPU detected | Start background download of Qwen2.5-1.5B |
| Download complete | Set `webLLMReady = true`, all Tier 2 calls go local |
| Download fails / OOM | Try SmolLM2-360M (194 MB fallback) |
| Both fail | Disable WebLLM tier, all calls go PAW → API |

---

## 9. Implementation Path

### Phase 1: PAW Core Programs (Tier 1)

- Compile 4 PAW programs: `signal-noise`, `format-check`, `verify-progress`, `verify-output`
- Add PAW lookup to `core/llm.ts`: check IndexedDB for compiled program before API call
- Wire into `JulesPostman.ts:143` (#1), `UserNegotiator.ts:117` (#2), `JulesNegotiator.ts:148,305` (#3,#4)
- **Effort**: ~3 days. **Savings**: ~40% of calls, zero ongoing cost, works on all devices.

### Phase 2: Rules + Regex (Tier 0)

- Replace `#2 Format Validation` with regex for known formats (yes/no, number, url, email)
- PAW `format-check` handles complex/unknown formats as fallback
- **Effort**: ~1 day. **Savings**: additional ~10% of calls.

### Phase 3: WebLLM Integration (Tier 2)

- Add `@mlc-ai/web-llm` dependency
- Implement WebGPU detection + model selection (1.5B default, 360M fallback)
- Wire WebLLM into `core/llm.ts` as a third provider (after PAW, before API)
- Replace calls #5 (task extraction) and #7 (session analysis) with local inference
- **Effort**: ~1 week. **Savings**: cumulative ~70% of calls.

### Phase 4: Cheap API Routing (Tier 3)

- Add Groq/OpenRouter as provider options
- Route calls #6, #9, #10 to cheapest adequate model (Groq Llama-3.1-8B)
- Keep #8 Programmer on current provider
- **Effort**: ~2 days. **Savings**: cumulative ~77% cost reduction.

---

## 10. LLM Management Panel

A dedicated settings tab giving the user full visibility and control over every LLM tier.

### Layout

```
┌─────────────────────────────────────────────────────────────┐
│  LLM Engine Settings                                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─ PROVIDERS ───────────────────────────────────────────┐ │
│  │  Primary API    [Gemini ▾]   Key: ****...****  [Test] │ │
│  │  Cheap API      [Groq  ▾]   Key: ****...****  [Test] │ │
│  │  PAW Compile    [OpenAI ▾]   Key: ****...****  [Test] │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌─ LOCAL MODELS ────────────────────────────────────────┐ │
│  │                                                       │ │
│  │  PAW Runtime (WASM)                                   │ │
│  │  ├ Base Model (GPT-2 124M)     ● Loaded    134 MB    │ │
│  │  └ Programs:                                          │ │
│  │    ├ signal-noise      ✅ Ready      12 MB   50ms     │ │
│  │    ├ format-check      ✅ Ready      11 MB   60ms     │ │
│  │    ├ verify-progress   ⏳ Compiling  --      45/100s  │ │
│  │    └ verify-output     ○ Not compiled                  │ │
│  │                                                       │ │
│  │  WebLLM (WebGPU)                                      │ │
│  │  ├ Device Support      ● Available (WebGPU detected)  │ │
│  │  ├ VRAM Budget         2.1 GB used / 4.0 GB avail     │ │
│  │  │                                                    │ │
│  │  │  Model                    Status    Size   Speed   │ │
│  │  │  SmolLM2-360M-q4          ● Ready   194 MB  95t/s  │ │
│  │  │  Qwen2.5-1.5B-q4          ● Ready   828 MB  48t/s  │ │
│  │  │  Llama-3.2-3B-q4          ○ Cached  1.7 GB   —     │ │
│  │  │  Gemma-2-2B-q4            — Not downloaded         │ │
│  │  │                                                    │ │
│  │  │  [Download Model ▾]  [Delete Selected]              │ │
│  │                                                       │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌─ CALL ROUTING ────────────────────────────────────────┐ │
│  │  Call Site           Level      Resolved     Hits      │ │
│  │  ─────────────────   ──────     ────────    ──────     │ │
│  │  Signal/Noise        static     PAW ✓        342       │ │
│  │  Format Validate     static     PAW ✓        89        │ │
│  │  Progress Verify     static     PAW ✓        156       │ │
│  │  Final Verify        static     API ↑        44        │ │
│  │  Task Extraction     dynamic    WebLLM ✓     67        │ │
│  │  Session Analysis    dynamic    WebLLM ✓     31        │ │
│  │  Architect Protocol  global     API ✓        23        │ │
│  │  Programmer Codegen  global     API ✓        112       │ │
│  │  Analysis Tool       global     API ✓        18        │ │
│  │  Project Review      global     API ✓        12        │ │
│  │                                                      │ │
│  │  ✓ = preferred level hit   ↑ = escalated up          │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌─ USAGE STATS (last 7 days) ───────────────────────────┐ │
│  │  Total calls:  894                                    │ │
│  │  Tier 0 (Rules):      89   (10%)  $0.00               │ │
│  │  Tier 1 (PAW):       542   (61%)  $0.00               │ │
│  │  Tier 2 (WebLLM):     98   (11%)  $0.00               │ │
│  │  Tier 3 (Cheap API):  41   ( 5%)  $0.01               │ │
│  │  Tier 4 (Full API):  124   (14%)  $1.86               │ │
│  │  ─────────────────────────────────────────             │ │
│  │  Total cost:                          $1.87            │ │
│  │  Estimated without optimization:     $13.50           │ │
│  │  Savings:                             $11.63 (86%)     │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌─ ACTIONS ─────────────────────────────────────────────┐ │
│  │  [Recompile All PAW]  [Clear Model Cache]             │ │
│  │  [Download WebLLM Model]  [Run Diagnostics]           │ │
│  │  [Export Programs]  [Import Programs]                  │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Status Indicators

| Icon | State | Meaning |
|---|---|---|
| ● Green | Ready | Model loaded, responding to calls |
| ⏳ Yellow | Loading | Download in progress or compiling |
| ○ Gray | Not available | Not compiled/downloaded, using fallback |
| ✅ White | Compiled | PAW program ready in IndexedDB |
| 🔴 Red | Error | Load failed, check console |

### Provider Configuration

Each provider has:
- **Dropdown**: Gemini / OpenAI / Groq / Together AI / OpenRouter / Custom URL
- **API Key field**: Masked input with test button
- **Test button**: Sends a trivial prompt, measures TTFT, shows success/fail
- **Model selector**: Appears after provider is chosen (e.g., Groq → Llama-3.1-8B, Gemma-2-9B)

Three separate provider slots:
1. **Primary API** — used for Tier 4 (code gen, current behavior)
2. **Cheap API** — used for Tier 3 (planning, analysis)
3. **PAW Compile API** — used only for compilation (needs a strong model like GPT-4)

### PAW Program Cards

Each compiled PAW program shows:
- Program name and spec (click to expand/edit)
- Status (compiled / compiling / missing)
- Adapter size and average inference latency
- Hit count (how many times used this session)
- [Recompile] button — re-runs compilation with current spec
- [Delete] button — removes from IndexedDB, reverts to fallback

### WebLLM Section

- Auto-detects WebGPU support on mount
- **Multiple models** can be downloaded and cached simultaneously
- Each model shows: name, size, cache status, VRAM usage, measured tok/s
- Model selector for each call site (e.g., use 360M for classification, 1.5B for extraction, 3B for analysis)
- [Download] / [Delete] per model, progress bar when loading
- VRAM budget indicator: total available vs sum of loaded models
- Default set: `{ classification: "SmolLM2-360M", extraction: "Qwen2.5-1.5B", analysis: "Qwen2.5-1.5B" }`
- Swap models at runtime via `engine.reload()` — ~3-5s from cache

### Diagnostics

[Run Diagnostics] button executes a self-test:
1. Test each provider with a trivial prompt
2. Load and run each PAW program on a known input
3. Load WebLLM and classify a test message
4. Measure and display latency for each tier
5. Show any errors with suggestions

### Data Sources

The panel reads from:
- `localStorage` / settings: provider configs, API keys
- IndexedDB `PawProgram` table: compiled programs and metadata
- Cache API: WebLLM model cache status (`hasModelInCache()`)
- In-memory counters: hit counts per tier (reset on page reload, or persist to IndexedDB for stats)

---

## 11. Risk Assessment

| Risk | Severity | Mitigation |
|---|---|---|
| WebGPU not available (Safari, Firefox) | Medium | Auto-fallback to PAW or API |
| Model quality regression on edge cases | Medium | Confidence thresholds → API fallback |
| 828 MB download on first visit | Low | Progressive loading, background preload |
| Groq rate limits on free tier | Low | Multi-provider fallback |
| WebLLM breaking changes | Low | Pin version, test before upgrade |

---

## 12. Implementation Plan

### Architecture: What Changes

The level system adds one new abstraction layer. Everything else (call sites) changes minimally.

**Current flow**:
```
Call site → context.llmCall(prompt, jsonMode) → host.ts:134 → API
```

**New flow**:
```
Call site → context.llmCall(prompt, jsonMode, level?) → host.ts → level router → PAW / WebLLM / API
```

### New Files to Create

| File | Purpose | Size |
|---|---|---|
| `src/core/llm-router.ts` | Level routing logic: static → dynamic → global | ~80 lines |
| `src/core/paw-runtime.ts` | PAW IndexedDB lookup + WASM inference wrapper | ~60 lines |
| `src/core/webllm-runtime.ts` | WebLLM engine init, model cache, inference | ~100 lines |
| `src/core/llm-stats.ts` | Hit counters per tier, usage stats persistence | ~50 lines |
| `src/components/LLMSettingsPanel.tsx` | Management panel UI component | ~400 lines |
| `src/services/db.ts` (modify) | Add `PawProgram` table to Dexie schema | ~20 lines |

### Files to Modify

#### 1. `src/core/types.ts` (3 lines)

Add `level` parameter to `RequestContext.llmCall`:

```typescript
// Before:
llmCall: (prompt: string, jsonMode?: boolean) => Promise<string>;

// After:
llmCall: (prompt: string, jsonMode?: boolean, level?: 'static' | 'dynamic' | 'global') => Promise<string>;
```

**Impact**: Backwards compatible — `level` is optional, defaults to `'global'`.

#### 2. `src/core/host.ts` (~30 lines changed)

The `llmCall` method at line 134 becomes a thin wrapper around the level router:

```typescript
// Before: host.ts:134-207 has all the API logic inline

// After:
async llmCall(prompt: string, jsonMode?: boolean, level?: LlmLevel): Promise<string> {
  if (!this.config) throw new Error("Host not initialized");
  return llmRouter.route(level ?? 'global', prompt, jsonMode, this.config);
}
```

The existing API call logic moves into `llm-router.ts` as the `global` handler. The retry/timeout logic stays there too.

#### 3. `src/modules/executor-jules/JulesPostman.ts` (~10 lines changed)

Lines 95-128: Currently does inline Gemini/OpenAI fetch for classification. Change to use `this.config.llmCall` with `level: 'static'`:

```typescript
// Before: 30 lines of inline Gemini + OpenAI fetch

// After:
const result = await llmCall(
  `Classify as SIGNAL or NOISE. Message: "${content}". Return only SIGNAL or NOISE.`,
  false,
  'static'  // → PAW signal-noise program, fallback to API
);
category = result.trim().toUpperCase() === 'SIGNAL' ? 'SIGNAL' : 'NOISE';
```

**Simplifies code**: Removes 30 lines of duplicated API logic. JulesPostman is the ONLY call site that bypasses `host.llmCall` — this fixes that architectural inconsistency.

#### 4. `src/services/negotiators/UserNegotiator.ts` (3 lines changed)

Line 126-134: Add level to `validateReply`:

```typescript
// Before:
const result = await llmCall(prompt);

// After:
const result = await llmCall(prompt, false, 'static');
```

#### 5. `src/services/negotiators/JulesNegotiator.ts` (6 lines changed)

Lines 148, 246, 305: Add level to each `safeLlmCall`:

```typescript
// Line 148 (progress verify) — static
await safeLlmCall(verifyPrompt, false, 'static');

// Line 246 (session analysis) — dynamic
await safeLlmCall(analysisPrompt, true, 'dynamic');

// Line 305 (final verify) — static
await safeLlmCall(verifyPrompt, false, 'static');
```

Also update `safeLlmCall` signature to pass `level` through:

```typescript
const safeLlmCall = async (promptText: string, jsonMode?: boolean, level?: LlmLevel, retries = 5) => {
  return await llmCall(promptText, jsonMode, level);
};
```

#### 6. `src/core/prompt.ts` — `parseTasksFromMessage` (~5 lines changed)

Currently does its own inline API calls (lines 33-63). Refactor to accept `llmCall` function:

```typescript
// Before: 7 params including apiProvider, geminiModel, etc.

// After: accepts llmCall function
export const parseTasksFromMessage = async (
  messageContent: string,
  llmCall: (prompt: string, jsonMode?: boolean, level?: LlmLevel) => Promise<string>
): Promise<{ title: string; description: string }[]> => {
  // ... same prompt ...
  const data = JSON.parse(await llmCall(prompt, true, 'dynamic'));
  return data.tasks || [];
};
```

**Callers to update**: `App.tsx:117`, `MailboxView.tsx:75`, `PreviewPane.tsx:41` — pass `host.llmCall` instead of 7 separate config params.

#### 7. `src/core/orchestrator.ts` (2 lines changed)

Lines 80, 193: Add levels to the two calls:

```typescript
// Line 80 (analyze tool) — global (needs reasoning)
summary = await this.config.llmCall(analysisPrompt, format === 'json', 'global');

// Line 193 (programmer codegen) — global (needs code quality)
const code = await this.config.llmCall(prompt, false, 'global');
```

#### 8. `src/modules/architect-codegen/Architect.ts` (1 line changed)

Line 16: Add level:

```typescript
await context.llmCall(prompt, true, 'global');
```

#### 9. `src/modules/process-project-manager/ProcessAgent.ts` (1 line changed)

Line 95: Add level:

```typescript
await context.llmCall(prompt, true, 'global');
```

### Test Changes

| Test Area | What to Test | Effort |
|---|---|---|
| `llm-router.ts` | Level escalation: static→dynamic→global. Mock each runtime. Verify correct level hit. | ~20 unit tests |
| `paw-runtime.ts` | IndexedDB read/write. WASM init. Inference with mock adapter. | ~10 unit tests |
| `webllm-runtime.ts` | WebGPU detect. Model load/cached. Inference. JSON mode. | ~10 unit tests |
| `llm-stats.ts` | Counter increment per tier. Stats aggregation. Persist/load. | ~5 unit tests |
| Integration | End-to-end: PAW missing → WebLLM fallback → API. Cold start. Model appears mid-session. | ~5 integration tests |
| Existing call sites | Each modified call site still returns correct results. Verify no regression. | ~8 regression tests |

**Testing strategy**: The level router is the critical path. Mock PAW/WebLLM as "available/unavailable", verify escalation. Real PAW/WebLLM inference tested separately in `paw-test.html`.

### Phased Rollout

#### Phase 1: Infrastructure (level router + PAW runtime) — 3 days

1. Create `src/core/llm-router.ts` with level escalation
2. Create `src/core/paw-runtime.ts` (IndexedDB + WASM wrapper)
3. Modify `src/core/types.ts` — add `level` to `llmCall` signature
4. Modify `src/core/host.ts` — route through `llm-router`
5. Modify `JulesPostman.ts` — use `llmCall('static')` instead of inline API
6. **Checkpoint**: All existing tests pass. JulesPostman uses PAW when available, API otherwise.

#### Phase 2: Level all call sites — 2 days

1. Add `level` parameter to `UserNegotiator.ts`, `JulesNegotiator.ts`, `orchestrator.ts`, `Architect.ts`, `ProcessAgent.ts`
2. Refactor `parseTasksFromMessage` to accept `llmCall` function
3. Update callers (`App.tsx`, `MailboxView.tsx`, `PreviewPane.tsx`)
4. **Checkpoint**: Every call site declares its level. All default to global → no behavior change.

#### Phase 3: WebLLM runtime — 5 days

1. Add `@mlc-ai/web-llm` dependency
2. Create `src/core/webllm-runtime.ts` (WebGPU detect, model load, JSON mode inference)
3. Wire into `llm-router.ts` as the `dynamic` tier
4. Background download on app load
5. **Checkpoint**: `dynamic` calls route to WebLLM when available.

#### Phase 4: Management panel + stats — 3 days

1. Create `src/core/llm-stats.ts` (hit counters, usage tracking)
2. Create `src/components/LLMSettingsPanel.tsx` (full UI)
3. Add to settings navigation
4. **Checkpoint**: Full visibility into all tiers, manual compile/download controls.

#### Phase 5: Production hardening — 2 days

1. Error boundaries for WebGPU OOM
2. Progressive model download (360M first, 1.5B in background)
3. IndexedDB GC for old PAW programs (30-day expiry)
4. Device capability detection and auto-tier selection

### Total Effort: ~15 days

| Phase | Days | Risk | Deliverable |
|---|---|---|---|
| 1. Infrastructure | 3 | Low | Level router + PAW runtime |
| 2. Level all sites | 2 | Low | Every site declares level |
| 3. WebLLM | 5 | Medium | Local inference for dynamic calls |
| 4. Management panel | 3 | Low | UI for all tiers |
| 5. Hardening | 2 | Low | Production-ready |

**Critical path**: Phase 1 (level router) must ship first. After that, phases 2-4 are independent and can be parallelized.

---

## 13. Technical Notes

- **WebLLM JSON Schema mode**: Uses `@mlc-ai/web-xgrammar` for grammar-constrained decoding. Guarantees valid JSON matching a schema — better than PAW's prompt-only approach.
- **Model caching**: WebLLM uses Cache API by default. Qwen2.5-1.5B (~828 MB) downloads once, loads in ~3s from cache on subsequent visits.
- **Cold start**: First WebLLM load after cache = ~3-5s for 1.5B model. Acceptable for background tasks (Jules polling, KB operations).
- **Concurrent inference**: WebLLM is single-threaded per engine. For parallel classifications, batch inputs or use separate engines.
- **Browser compatibility**: Chrome 113+, Edge 113+. Safari partial. Firefox none. ~85% of desktop users covered.
- **`core/llm.ts` modification**: All calls go through one function. Adding WebLLM as a provider means changing ~20 lines in one file, and every call site benefits automatically.
