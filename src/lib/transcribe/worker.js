import { SAMPLE_RATE, CHUNK_SECONDS, STRIDE_SECONDS, TRANSFORMERS_URL, modelForLanguage, processedSeconds, numberOfWindows } from './core.js';

/** Inference lives here, never on a server or the UI thread. */
let transcriber = null;
let loadedModel = null;
let runtime = null;
let running = false;

async function loadRuntime() {
  if (runtime) return runtime;
  runtime = await import(/* @vite-ignore */ TRANSFORMERS_URL);
  runtime.env.allowLocalModels = false;
  runtime.env.useBrowserCache = true;
  // WASM works without WebGPU and on ordinary static hosts. No COOP/COEP needed.
  runtime.env.backends.onnx.wasm.numThreads = self.crossOriginIsolated
    ? Math.min(4, self.navigator.hardwareConcurrency || 2) : 1;
  runtime.env.backends.onnx.wasm.proxy = false;
  return runtime;
}

self.addEventListener('message', async ({ data }) => {
  if (data?.type !== 'transcribe' || running) return;
  running = true;
  const { id, language, audio } = data;
  const send = (type, payload = {}) => self.postMessage({ id, type, ...payload });
  let stage = 'load';

  try {
    if (!(audio instanceof Float32Array) || !audio.length) throw new Error('No audio samples were received.');
    const modelId = modelForLanguage(language);
    send('status', { phase: 'loading', label: 'Loading transcription engine…' });
    const { pipeline, WhisperTextStreamer } = await loadRuntime();

    if (!transcriber || loadedModel !== modelId) {
      if (transcriber) await transcriber.dispose();
      transcriber = null;
      loadedModel = null;
      const files = new Map();
      send('status', { phase: 'loading', label: 'Loading Whisper tiny…' });
      transcriber = await pipeline('automatic-speech-recognition', modelId, {
        device: 'wasm',
        dtype: 'q8',
        progress_callback: progress => {
          // Only weight files contribute to this progress indicator. JSON files
          // and runtime initialization do not have predictable transfer sizes.
          if (!progress.file?.endsWith('.onnx')) return;
          const previous = files.get(progress.file) ?? { loaded: 0, total: 0, done: false };
          const next = {
            loaded: Number.isFinite(progress.loaded) ? progress.loaded : previous.loaded,
            total: Number.isFinite(progress.total) ? progress.total : previous.total,
            done: progress.status === 'done' || previous.done,
          };
          if (next.done && next.total) next.loaded = next.total;
          files.set(progress.file, next);
          const values = [...files.values()];
          const loaded = values.reduce((sum, file) => sum + file.loaded, 0);
          const totalsKnown = values.length >= 2 && values.every(file => file.total > 0);
          const total = totalsKnown ? values.reduce((sum, file) => sum + file.total, 0) : 0;
          send('download', { loaded, total, initializing: values.length >= 2 && values.every(file => file.done) });
        },
      });
      loadedModel = modelId;
    }

    stage = 'inference';
    const duration = audio.length / SAMPLE_RATE;
    let completed = 0;
    let draft = '';
    let lastDraftTime = 0;
    send('ready', { model: modelId });
    send('status', { phase: 'transcribing', label: 'Transcribing on your device…' });
    const streamer = new WhisperTextStreamer(transcriber.tokenizer, {
      skip_prompt: true,
      callback_function: text => {
        draft += text;
        const now = performance.now();
        if (now - lastDraftTime > 110) {
          // This is explicitly a preview of the CURRENT overlapping window,
          // not a finished transcript. The pipeline stitches final text itself.
          send('draft', { text: draft.slice(-650), window: completed + 1, windows: numberOfWindows(duration) });
          lastDraftTime = now;
        }
      },
      on_finalize: () => {
        completed += 1;
        if (draft) send('draft', { text: draft.slice(-650), window: completed, windows: numberOfWindows(duration) });
        send('progress', { processed: processedSeconds(completed, duration), duration });
        draft = '';
      },
    });

    const options = {
      chunk_length_s: CHUNK_SECONDS,
      stride_length_s: STRIDE_SECONDS,
      return_timestamps: true,
      do_sample: false,
      // Keep Whisper's full 448-token context rather than an arbitrary short
      // output cap, which would silently truncate fast speech.
      streamer,
    };
    // English-only models reject language/task, so do NOT send them for .en.
    if (language !== 'en') Object.assign(options, { language, task: 'transcribe' });
    const output = await transcriber(audio, options);
    send('complete', { output, duration });
  } catch (error) {
    // Do not log audio or transcript content. Main thread shows an actionable error.
    const detail = error instanceof Error ? error.message : String(error);
    send('error', { stage, detail });
    if (stage === 'load') {
      transcriber = null;
      loadedModel = null;
      runtime = null;
    }
  } finally {
    running = false;
  }
});
