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

### Per-Call Fallback Logic

```typescript
async function smartLlmCall(callSite: string, prompt: string, jsonMode?: boolean) {
  // Tier 0: Rules (instant, no model)
  if (canHandleWithRules(callSite, prompt)) {
    return applyRules(callSite, prompt);
  }

  // Tier 1: PAW (if compiled, runs everywhere)
  const pawProgram = await getPawProgram(callSite);
  if (pawProgram) {
    try {
      const result = await runPaw(pawProgram, prompt);
      if (result.confidence > 0.85) return result.value;
      // Low confidence → fall through to next tier
    } catch { /* PAW failed, fall through */ }
  }

  // Tier 2: WebLLM (if downloaded, needs WebGPU)
  if (hasWebGPU() && await isWebLLMReady()) {
    try {
      return await runWebLLM(prompt, jsonMode);
    } catch { /* WebLLM failed, fall through */ }
  }

  // Tier 3: Cheap API (always available)
  if (cheapApiConfigured()) {
    return await callCheapApi(prompt, jsonMode);
  }

  // Tier 4: Full API (current behavior, never breaks)
  return await llmCall(currentConfig, prompt, jsonMode);
}
```

**Key principle**: The system always works. Local models are optimizations, not requirements. Every call has a guaranteed fallback to the current API.

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

## 10. Risk Assessment

| Risk | Severity | Mitigation |
|---|---|---|
| WebGPU not available (Safari, Firefox) | Medium | Auto-fallback to PAW or API |
| Model quality regression on edge cases | Medium | Confidence thresholds → API fallback |
| 828 MB download on first visit | Low | Progressive loading, background preload |
| Groq rate limits on free tier | Low | Multi-provider fallback |
| WebLLM breaking changes | Low | Pin version, test before upgrade |

---

## 11. Technical Notes

- **WebLLM JSON Schema mode**: Uses `@mlc-ai/web-xgrammar` for grammar-constrained decoding. Guarantees valid JSON matching a schema — better than PAW's prompt-only approach.
- **Model caching**: WebLLM uses Cache API by default. Qwen2.5-1.5B (~828 MB) downloads once, loads in ~3s from cache on subsequent visits.
- **Cold start**: First WebLLM load after cache = ~3-5s for 1.5B model. Acceptable for background tasks (Jules polling, KB operations).
- **Concurrent inference**: WebLLM is single-threaded per engine. For parallel classifications, batch inputs or use separate engines.
- **Browser compatibility**: Chrome 113+, Edge 113+. Safari partial. Firefox none. ~85% of desktop users covered.
- **`core/llm.ts` modification**: All calls go through one function. Adding WebLLM as a provider means changing ~20 lines in one file, and every call site benefits automatically.
