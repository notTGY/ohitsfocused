import { SMART_TRANSFORMERS_URL, SMART_MODEL, SMART_REVISION, cleanupMessages, chunkForCleanup, cleanupOutput, tokenCount, sanitizeCleanupInput } from './core.js';

/** Optional second-stage inference. A separate worker keeps Whisper's runtime
 * unchanged and makes cancelling the larger WebGPU model deterministic. */
let normalizer = null;
let runtime = null;
let running = false;

async function loadNormalizer(send) {
  if (normalizer) return normalizer;
  // Probe IN the worker too: window support does not guarantee worker support.
  const adapter = await self.navigator?.gpu?.requestAdapter();
  if (!adapter?.features.has('shader-f16')) throw new Error('WebGPU with shader-f16 is required.');
  send('status', { label: 'Loading S1-mini by Superwhisper…' });
  runtime ??= await import(/* @vite-ignore */ SMART_TRANSFORMERS_URL);
  runtime.env.allowLocalModels = false;
  runtime.env.useBrowserCache = true;
  const files = new Map();
  let hasAggregate = false;
  normalizer = await runtime.pipeline('text-generation', SMART_MODEL, {
    revision: SMART_REVISION,
    device: 'webgpu',
    dtype: 'q4f16',
    progress_callback: event => {
      // Transformers.js 4 supplies aggregate progress, including .onnx_data.
      // Do not filter for .onnx only: nearly all S1 weights are external data.
      if (event.status === 'progress_total') {
        hasAggregate = true;
        send('download', { loaded: event.loaded || 0, total: event.total || 0, percent: Number.isFinite(event.progress) ? event.progress : null });
        return;
      }
      if (!event.file || hasAggregate) return;
      const previous = files.get(event.file) ?? { loaded: 0, total: 0 };
      const next = { loaded: event.loaded ?? previous.loaded, total: event.total ?? previous.total };
      if (event.status === 'done' && next.total) next.loaded = next.total;
      files.set(event.file, next);
      // Without an aggregate total, report bytes, never an invented percentage.
      if (event.status === 'progress' || event.status === 'done') {
        send('download', { loaded: [...files.values()].reduce((sum, file) => sum + file.loaded, 0), total: 0, percent: null });
      }
    },
  });
  send('ready', { model: SMART_MODEL });
  return normalizer;
}

self.addEventListener('message', async ({ data }) => {
  if (data?.type !== 'refine' || running) return;
  running = true;
  const send = (type, payload = {}) => self.postMessage({ id: data.id, type, ...payload });
  let stage = 'load';
  try {
    if (data.language !== 'en') throw new Error('S1-mini supports English only.');
    if (typeof data.text !== 'string' || !data.text.trim()) throw new Error('No transcript to refine.');
    const pipe = await loadNormalizer(send);
    stage = 'inference';
    const count = text => tokenCount(pipe.tokenizer, sanitizeCleanupInput(text));
    const chunks = chunkForCleanup(data.text, count);
    const cleaned = [];
    let preservedChunks = 0;
    for (let index = 0; index < chunks.length; index++) {
      send('progress', { completed: index, total: chunks.length });
      const raw = chunks[index];
      const maxNewTokens = Math.min(1024, Math.max(64, Math.ceil(count(raw) * 1.3) + 32));
      // Count emitted tokens, not re-tokenized text, to detect a length cutoff.
      let generatedTokens = 0, lastToken = null;
      const streamer = new runtime.TextStreamer(pipe.tokenizer, {
        skip_prompt: true,
        skip_special_tokens: true,
        callback_function: () => {},
        token_callback_function: tokens => {
          generatedTokens += tokens.length;
          if (tokens.length) lastToken = Number(tokens.at(-1));
        },
      });
      const result = await pipe(cleanupMessages(raw), {
        max_new_tokens: maxNewTokens,
        do_sample: false,
        streamer,
        // Required: S1-mini was trained in non-thinking mode.
        tokenizer_encode_kwargs: { enable_thinking: false },
      });
      let text = cleanupOutput(result);
      const configuredEOS = pipe.model?.generation_config?.eos_token_id ?? pipe.tokenizer.eos_token_id;
      const eos = Array.isArray(configuredEOS) ? configuredEOS.map(Number) : [Number(configuredEOS)];
      if (generatedTokens >= maxNewTokens && !eos.includes(lastToken)) {
        // Never silently replace a complete original with a cut-off rewrite.
        text = raw;
        preservedChunks += 1;
      }
      cleaned.push(text);
      send('progress', { completed: index + 1, total: chunks.length });
    }
    send('complete', { text: cleaned.filter(Boolean).join('\n\n'), preservedChunks });
  } catch (error) {
    send('error', { stage, detail: error instanceof Error ? error.message : String(error) });
    // The UI terminates this worker, releases the GPU and keeps the raw result.
  } finally {
    running = false;
  }
});
