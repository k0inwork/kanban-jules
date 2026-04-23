import { Wllama } from 'https://esm.sh/gh/programasweights/wllama';
const WLLAMA_COMMIT = 'f8b7d6b28696d0f9575f82df7a54de3adc6ea49c';
const PAW_WASM_CDN_BASE = `https://cdn.jsdelivr.net/gh/programasweights/wllama@${WLLAMA_COMMIT}/esm`;
const WASM_PATHS = {
    'single-thread/wllama.wasm': `${PAW_WASM_CDN_BASE}/single-thread/wllama.wasm`,
    'multi-thread/wllama.wasm': `${PAW_WASM_CDN_BASE}/multi-thread/wllama.wasm`,
};
const MODEL_CACHE_NAME = 'paw-model-cache';
let sharedWllama = null;
let loadedRuntimeId = null;

async function getCachedBlob(url) {
    const cache = await caches.open(MODEL_CACHE_NAME);
    const cached = await cache.match(url);
    if (cached) return await cached.blob();
    return null;
}

async function setCachedBlob(url, blob) {
    const cache = await caches.open(MODEL_CACHE_NAME);
    await cache.put(url, new Response(blob));
}

async function getOrInitWllama(baseModelUrl, runtimeId, nCtx, onProgress) {
    if (sharedWllama && loadedRuntimeId === runtimeId) {
        return sharedWllama;
    }
    if (sharedWllama) {
        await sharedWllama.exit();
        sharedWllama = null;
        loadedRuntimeId = null;
    }
    const wllama = new Wllama(WASM_PATHS, {
        suppressNativeLog: true,
    });

    let blob = await getCachedBlob(baseModelUrl);
    if (blob) {
        if (onProgress) onProgress({ loaded: blob.size, total: blob.size, stage: 'base-model (cached)' });
    } else {
        const resp = await fetch(baseModelUrl);
        if (!resp.ok)
            throw new Error(`Base model download failed: ${resp.status}`);
        const total = parseInt(resp.headers.get('content-length') || '0');
        const reader = resp.body.getReader();
        const chunks = [];
        let loaded = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            chunks.push(value);
            loaded += value.byteLength;
            if (onProgress) {
                onProgress({ loaded, total, stage: 'base-model' });
            }
        }
        blob = new Blob(chunks);
        await setCachedBlob(baseModelUrl, blob);
    }

    await wllama.loadModel([blob], { n_ctx: nCtx });
    sharedWllama = wllama;
    loadedRuntimeId = runtimeId;
    return wllama;
}
export class PawFunction {
    constructor(assets, opts = {}) {
        this.wllama = null;
        this.adapterId = null;
        this.prefixTokenCount = 0;
        this.promptPrefix = '';
        this.promptSuffix = '';
        this.assets = assets;
        this.defaultMaxTokens = opts.maxTokens;
        this.temperature = opts.temperature ?? 0;
        this.scale = opts.scale ?? 1.0;
        const placeholder = '{INPUT_PLACEHOLDER}';
        const parts = assets.promptTemplate.split(placeholder);
        this.promptPrefix = parts[0];
        this.promptSuffix = parts.length > 1 ? parts[1] : '';
    }
    async init(onProgress) {
        this.wllama = await getOrInitWllama(this.assets.baseModelUrl, this.assets.runtime.runtime_id, this.assets.runtime.local_sdk.n_ctx ?? 2048, onProgress);
        this.adapterId = await this.wllama.loadLoraAdapter(this.assets.adapterUrl, {
            scale: this.scale,
        });
        try {
            if (this.assets.prefixCacheUrl && this.assets.prefixTokensUrl) {
                const [cacheResp, tokensResp] = await Promise.all([
                    fetch(this.assets.prefixCacheUrl),
                    fetch(this.assets.prefixTokensUrl),
                ]);
                if (cacheResp.ok && tokensResp.ok) {
                    const cacheBlob = await cacheResp.blob();
                    const prefixTokens = await tokensResp.json();
                    this.prefixTokenCount = await this.wllama.loadSession(cacheBlob, prefixTokens);
                }
            }
        }
        catch {
            this.prefixTokenCount = 0;
        }
    }
    async run(input, maxTokens) {
        if (!this.wllama) {
            throw new Error('PawFunction not initialized. Call init() first.');
        }
        if (this.prefixTokenCount > 0) {
            await this.wllama.kvRemove(this.prefixTokenCount, -1);
        }
        const limit = maxTokens ?? this.defaultMaxTokens ?? 2048;
        const fullPrompt = this.promptPrefix + input + this.promptSuffix;
        const output = await this.wllama.createCompletion(fullPrompt, {
            nPredict: limit,
            useCache: true,
            sampling: { temp: this.temperature },
        });
        return output.trim();
    }
    async free() {
        if (this.wllama && this.adapterId !== null) {
            await this.wllama.freeLoraAdapter(this.adapterId);
            this.adapterId = null;
        }
    }
    get spec() {
        return this.assets.meta.spec;
    }
    get programId() {
        return this.assets.meta.program_id;
    }
    get interpreter() {
        return this.assets.meta.interpreter;
    }
    get hasPrefixCache() {
        return this.prefixTokenCount > 0;
    }
}
//# sourceMappingURL=runtime.js.map