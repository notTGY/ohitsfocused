import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Download, FileText, LoaderCircle, RefreshCw, ShieldCheck, Sparkles, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SAMPLE_RATE, MAX_DURATION_SECONDS, LANGUAGES, modelForLanguage, languageLabel, formatTime, formatBytes, validateVideoFile, wordCount, normalizeSegments, markdownTranscript } from '@/lib/transcribe/core.js';

const button = 'inline-flex items-center justify-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40';
const panel = 'min-w-0 rounded-3xl border border-border bg-card p-5 shadow-sm md:p-6';
const initial = { file: null, url: '', duration: 0, language: 'en', supported: false, smart: false, smartSupport: 'Checking device compatibility…', busy: false, refining: false, loadedModel: '', label: '', detail: '', percent: null, draft: '', draftNote: '', error: '', note: '', raw: '', segments: [], clean: null, refined: false, resultLanguage: 'en', done: false, copied: false };

async function readAudio(file, duration, signal) {
  const check = () => { if (signal.aborted) throw new DOMException('Cancelled', 'AbortError'); };
  check();
  if (duration > MAX_DURATION_SECONDS + 1) throw new Error('Choose a clip under 30 minutes.');
  const Context = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const decoder = new Context(1, 1, SAMPLE_RATE);
  const data = await file.arrayBuffer();
  check();
  let decoded;
  try { decoded = await decoder.decodeAudioData(data); }
  catch { throw new Error('Could not read the audio. Try an MP4 with AAC audio or a WebM with Opus audio, and make sure it has an audio track.'); }
  check();
  if (!decoded.length || !decoded.numberOfChannels) throw new Error('This video has no readable audio track.');
  if (decoded.duration > MAX_DURATION_SECONDS + 1) throw new Error('Choose a clip under 30 minutes.');
  if (decoded.sampleRate !== SAMPLE_RATE) throw new Error('This browser could not prepare the audio. Try another browser.');
  const audio = new Float32Array(decoded.length);
  const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
  let peak = 0;
  for (let offset = 0; offset < audio.length; offset += 262144) {
    check();
    for (let i = offset; i < Math.min(offset + 262144, audio.length); i++) {
      let value = 0;
      for (const channel of channels) value += channel[i] / channels.length;
      audio[i] = value;
      peak = Math.max(peak, Math.abs(value));
    }
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  check();
  if (peak < 0.00001) throw new Error('This audio track is silent. Choose a video with audible speech.');
  return audio;
}

export default function TranscribeReels() {
  const [state, setState] = useState(initial);
  const current = useRef(initial);
  const job = useRef({ id: 0, worker: null, smartWorker: null, abort: null, copyTimer: null });
  const input = useRef(null), video = useRef(null);
  const [time, setTime] = useState(0), [dragging, setDragging] = useState(false);
  const update = patch => { current.current = { ...current.current, ...patch }; setState(current.current); };
  const progress = (label, detail = '', percent = null) => update({ label, detail, percent });
  function terminate(key) {
    job.current[key]?.terminate();
    job.current[key] = null;
    if (key === 'worker') update({ loadedModel: '' });
  }

  useEffect(() => {
    let active = true;
    const supported = Boolean((window.OfflineAudioContext || window.webkitOfflineAudioContext) && window.Worker && window.WebAssembly);
    update({ supported, error: supported ? '' : 'This browser needs Web Audio, Web Workers, and WebAssembly for local transcription.' });
    void (async () => {
      let reason = '';
      try {
        if (!window.isSecureContext) throw new Error('Smart cleanup needs HTTPS or localhost.');
        if (!navigator.gpu) throw new Error('Smart cleanup needs a WebGPU-capable browser.');
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter?.features.has('shader-f16')) throw new Error('Smart cleanup needs a compatible WebGPU device with 16-bit support.');
      } catch (error) { reason = error.message || 'Smart cleanup is unavailable on this device.'; }
      if (active) update({ smartSupport: reason });
    })();
    const preventDrop = event => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); };
    const release = () => {
      job.current.id++;
      job.current.abort?.abort();
      job.current.worker?.terminate();
      job.current.smartWorker?.terminate();
      clearTimeout(job.current.copyTimer);
      if (current.current.url) URL.revokeObjectURL(current.current.url);
    };
    const pagehide = event => { if (!event.persisted) release(); };
    document.addEventListener('dragover', preventDrop);
    document.addEventListener('drop', preventDrop);
    window.addEventListener('pagehide', pagehide);
    return () => {
      active = false;
      release();
      document.removeEventListener('dragover', preventDrop);
      document.removeEventListener('drop', preventDrop);
      window.removeEventListener('pagehide', pagehide);
    };
  }, []);

  function chooseFile(file) {
    if (!file || current.current.busy) return;
    try { validateVideoFile(file); } catch (error) { update({ error: error.message }); return; }
    job.current.id++;
    job.current.abort?.abort();
    clearTimeout(job.current.copyTimer);
    video.current?.pause();
    if (current.current.url) URL.revokeObjectURL(current.current.url);
    setTime(0);
    update({ file, url: URL.createObjectURL(file), duration: 0, raw: '', segments: [], clean: null, refined: false, done: false, copied: false, error: '', note: '', draft: '' });
  }

  function failure(message, smart = false) {
    terminate(smart ? 'smartWorker' : 'worker');
    job.current.abort = null;
    update({ busy: false, refining: false, error: message, draft: '', refined: false, note: smart ? 'Your original transcript is ready to copy or save.' : '' });
  }

  function refine(raw, language, id) {
    terminate('worker');
    update({ busy: true, refining: true, error: '', note: 'Original ready. Refining a separate copy on your device.' });
    progress('Loading S1-mini by Superwhisper…');
    try {
      const worker = new Worker(new URL('../lib/transcribe/smart-worker.js', import.meta.url), { type: 'module', name: 'transcribe-reels-cleanup' });
      job.current.smartWorker = worker;
      const valid = () => job.current.id === id && job.current.smartWorker === worker && current.current.refining;
      worker.onmessage = ({ data }) => {
        if (!valid() || data.id !== id) return;
        switch (data.type) {
          case 'status': progress(data.label); break;
          case 'download': progress('Downloading S1-mini…', data.total > 0 ? `${formatBytes(data.loaded)} / ${formatBytes(data.total)}` : `${formatBytes(data.loaded)} loaded`, data.percent ?? null); break;
          case 'ready': progress('Preparing smart cleanup…'); break;
          case 'progress': progress('Refining on your device…', `${data.completed} / ${data.total} passes`, data.completed / data.total * 100); break;
          case 'complete':
            terminate('smartWorker');
            update({ clean: String(data.text ?? ''), refined: true, busy: false, refining: false, copied: false, note: data.preservedChunks ? 'Some passages stayed original because cleanup reached its length limit. Review the result.' : 'Refined locally. Review important details against the original.' });
            break;
          case 'error': failure(data.stage === 'load' ? 'Smart cleanup could not load. Check your connection and WebGPU support.' : 'Smart cleanup could not finish. Try a shorter clip or close heavy tabs.', true); break;
        }
      };
      worker.onerror = event => { event.preventDefault(); if (valid()) failure('Smart cleanup could not start on this device.', true); };
      worker.onmessageerror = () => { if (valid()) failure('Smart cleanup lost its connection. Try again.', true); };
      worker.postMessage({ type: 'refine', id, language, text: raw });
    } catch { failure('Smart cleanup could not start. Use HTTPS or localhost with a compatible WebGPU browser.', true); }
  }

  function getWorker() {
    if (job.current.worker) return job.current.worker;
    const worker = new Worker(new URL('../lib/transcribe/worker.js', import.meta.url), { type: 'module', name: 'transcribe-reels-whisper' });
    job.current.worker = worker;
    const valid = () => job.current.worker === worker && current.current.busy && !current.current.refining;
    worker.onmessage = ({ data }) => {
      if (!valid() || data.id !== job.current.id) return;
      switch (data.type) {
        case 'status': progress(data.label); break;
        case 'download': progress(data.initializing ? 'Preparing the model…' : 'Downloading Whisper tiny…', data.total > 0 ? `${formatBytes(data.loaded)} / ${formatBytes(data.total)}` : `${formatBytes(data.loaded)} loaded`, !data.initializing && data.total > 0 ? data.loaded / data.total * 100 : null); break;
        case 'ready': update({ loadedModel: data.model }); break;
        case 'draft': update({ draft: data.text, draftNote: data.windows > 1 ? `Live preview · Part ${data.window} of ${data.windows}` : 'Live preview · Finishing touches to follow' }); break;
        case 'progress': progress('Transcribing on your device…', `${formatTime(data.processed)} / ${formatTime(data.duration)}`, data.processed / data.duration * 100); break;
        case 'complete': {
          const result = normalizeSegments(data.output, data.duration);
          job.current.abort = null;
          update({ raw: result.text, segments: result.segments, busy: false, done: true, draft: '', note: result.text ? 'Transcript ready. Give it a read for any missed words.' : 'No speech detected. Try a clip with clear spoken audio.' });
          if (result.text && current.current.smart && current.current.resultLanguage === 'en') refine(result.text, 'en', data.id);
          break;
        }
        case 'error': failure(data.stage === 'load' ? 'Whisper could not load. Check your connection and allow downloads from Hugging Face and jsDelivr, then try again.' : 'This device could not finish transcription. Try a shorter clip, close heavy tabs, or use another browser.'); break;
      }
    };
    worker.onerror = event => { event.preventDefault(); if (valid()) failure('The local transcription engine could not start. Allow model downloads and try again.'); };
    worker.onmessageerror = () => { if (valid()) failure('The transcription engine lost its connection. Try again.'); };
    return worker;
  }

  async function start() {
    const s = current.current;
    if (s.busy) {
      job.current.id++;
      job.current.abort?.abort();
      job.current.abort = null;
      terminate('worker');
      terminate('smartWorker');
      update({ busy: false, refining: false, draft: '', error: '', refined: false, note: s.refining ? 'Cleanup stopped. Your original transcript is ready.' : 'Stopped. Your video is ready when you are.' });
      return;
    }
    if (!s.file || !s.supported) return;
    const id = ++job.current.id;
    if (s.smart && s.raw && s.clean === null && s.resultLanguage === 'en' && s.language === 'en') { refine(s.raw, s.resultLanguage, id); return; }
    const controller = new AbortController();
    job.current.abort = controller;
    clearTimeout(job.current.copyTimer);
    update({ busy: true, refining: false, raw: '', segments: [], clean: null, refined: false, done: false, copied: false, resultLanguage: s.language, error: '', note: '', draft: '', draftNote: 'You can keep watching while we work.' });
    progress('Preparing the audio…');
    try {
      modelForLanguage(s.language);
      const audio = await readAudio(s.file, s.duration, controller.signal);
      if (job.current.id !== id) return;
      update({ duration: audio.length / SAMPLE_RATE });
      progress('Loading Whisper tiny…');
      getWorker().postMessage({ type: 'transcribe', id, language: s.language, audio }, [audio.buffer]);
    } catch (error) { if (job.current.id === id && error.name !== 'AbortError') failure(error.message || 'The video could not be processed.'); }
  }

  const text = state.refined ? state.clean ?? '' : state.raw;
  const smartHint = state.language !== 'en' ? 'S1-mini currently supports English only.' : state.smartSupport || 'S1-mini by Superwhisper · about 365 MB plus runtime on first use.';
  const canRefine = state.smart && state.raw && state.clean === null && state.resultLanguage === 'en' && state.language === 'en';
  const modelReady = state.loadedModel === modelForLanguage(state.language);
  const activeSegment = state.segments.findIndex(segment => time >= segment.start && time < segment.end);

  async function copy() {
    const id = job.current.id;
    let copied = false;
    try { await navigator.clipboard.writeText(text); copied = true; }
    catch {
      const area = document.createElement('textarea'), previous = document.activeElement;
      area.value = text;
      area.readOnly = true;
      area.style.cssText = 'position:fixed;left:-9999px;top:0;';
      document.body.append(area);
      area.select();
      try { copied = document.execCommand('copy'); } catch { /* Manual selection remains available. */ }
      area.remove();
      previous?.focus({ preventScroll: true });
    }
    if (job.current.id !== id || text !== (current.current.refined ? current.current.clean : current.current.raw)) return;
    if (!copied) { update({ error: 'Clipboard access was blocked. Select the transcript text to copy it manually.' }); return; }
    update({ copied: true });
    clearTimeout(job.current.copyTimer);
    job.current.copyTimer = setTimeout(() => update({ copied: false }), 2000);
  }

  function download() {
    const url = URL.createObjectURL(new Blob([markdownTranscript(state.file.name, text)], { type: 'text/markdown;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${state.file.name.replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').slice(0, 180) || 'transcript'}.md`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <div className="space-y-5">
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
      <section className={cn(panel, 'space-y-5')} aria-labelledby="source-title"
        onDragOver={event => { event.preventDefault(); if (!state.busy) setDragging(true); }}
        onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); }}
        onDrop={event => {
          event.preventDefault(); setDragging(false);
          if (state.busy) return;
          if (event.dataTransfer.files.length > 1) update({ error: 'Choose one video at a time.' });
          else chooseFile(event.dataTransfer.files[0]);
        }}>
        <div className="flex items-center justify-between gap-3">
          <h2 id="source-title" className="text-lg font-semibold">Your video</h2>
          {state.file && <button className={button} disabled={state.busy} onClick={() => input.current.click()}><RefreshCw size={15} />Replace</button>}
        </div>
        <input ref={input} id="file-input" type="file" accept="video/*,.mp4,.mov,.webm,.m4v,.ogv,.mkv" className="hidden" disabled={state.busy} onChange={event => { chooseFile(event.target.files?.[0]); event.target.value = ''; }} />
        {state.file ? <div className={cn('space-y-3 rounded-2xl', dragging && 'ring-2 ring-ring')}>
          <video key={state.url} ref={video} src={state.url} controls playsInline preload="metadata" aria-label="Video preview" className="max-h-80 w-full rounded-2xl bg-black" onTimeUpdate={event => setTime(event.currentTarget.currentTime)}
            onLoadedMetadata={event => {
              const duration = Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0;
              update({ duration, ...(duration > MAX_DURATION_SECONDS + 1 ? { error: 'Choose a clip under 30 minutes.' } : {}) });
            }} onError={() => update({ error: 'This browser cannot play the preview. You can still try transcription, or choose MP4 with AAC audio or WebM with Opus audio.' })} />
          <div><p className="truncate text-sm font-medium" title={state.file.name}>{state.file.name}</p><p className="mt-1 text-xs text-muted-foreground">{formatBytes(state.file.size)}{state.duration > 0 && ` · ${formatTime(state.duration)}`}</p></div>
        </div> : <button className={cn('flex min-h-64 w-full flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border px-5 py-10 text-center transition-colors hover:bg-accent', dragging && 'bg-accent ring-2 ring-ring')} onClick={() => input.current.click()}>
          <span className="rounded-full bg-muted p-4"><Upload size={24} /></span><span className="font-medium">Choose a video or drop it here</span><span className="text-xs text-muted-foreground">MP4, MOV, WebM · Up to 250 MB / 30 minutes</span>
        </button>}
        <div className="space-y-2"><label htmlFor="transcribe-language" className="text-sm font-medium">Spoken language</label>
          <select id="transcribe-language" value={state.language} disabled={state.busy} onChange={event => update({ language: event.target.value, smart: event.target.value === 'en' && current.current.smart, error: '' })} className="w-full rounded-xl border border-input bg-background px-3 py-3 text-sm disabled:opacity-50">
            <option value="en">English</option>{LANGUAGES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select>
        </div>
        <div className="rounded-2xl border border-border p-4">
          <label className="flex items-center gap-3 text-sm font-medium"><input id="smart-checkbox" type="checkbox" checked={state.smart} disabled={state.busy || state.language !== 'en' || Boolean(state.smartSupport)} onChange={event => update({ smart: event.target.checked })} className="size-4 accent-current" /><Sparkles size={16} />Smart cleanup</label>
          <p id="smart-hint" className="mt-2 text-xs leading-5 text-muted-foreground">Remove fillers and tidy the wording. Keep the original alongside it.</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{smartHint}</p>
        </div>
        {state.busy ? <div className="space-y-2" role="status">
          <div className="flex items-center gap-2 text-sm"><LoaderCircle size={16} className="shrink-0 animate-spin" /><span>{state.label}</span></div>
          <progress aria-label={state.label} max={100} value={state.percent == null ? undefined : Math.max(0, Math.min(100, state.percent))} className="h-1.5 w-full accent-current" />
          <p className="text-xs text-muted-foreground">{state.detail}</p>
        </div> : <p className="flex justify-between gap-3 text-xs text-muted-foreground"><span>{state.language === 'en' ? 'Whisper tiny.en' : 'Whisper tiny · multilingual'}</span><span>{modelReady ? 'Ready on device' : '~41 MB'}</span></p>}
        <button id="transcribe-button" onClick={start} disabled={!state.busy && (!state.file || !state.supported)} className={cn(button, 'w-full bg-primary py-3 text-primary-foreground hover:bg-primary/90')}>
          {state.busy ? (state.refining ? 'Stop refining' : 'Cancel') : canRefine ? 'Refine transcript' : state.done ? 'Transcribe again' : 'Transcribe video'}
        </button>
        <p className="text-center text-xs leading-5 text-muted-foreground">{state.busy ? 'Keep this tab open. Everything happens on your device.' : canRefine ? 'Refine the existing transcript without transcribing again.' : 'First use downloads the model. Your video stays on your device.'}</p>
      </section>
      <section className={cn(panel, 'flex min-h-96 flex-col lg:min-h-[620px]')} aria-labelledby="transcript-title" aria-busy={state.busy}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <h2 id="transcript-title" className="text-lg font-semibold">Transcript</h2>
          {state.raw && <div className="flex gap-2"><button id="copy-button" className={button} disabled={!text} onClick={copy}>{state.copied ? <Check size={15} /> : <Copy size={15} />}{state.copied ? 'Copied' : 'Copy'}</button><button id="download-button" className={button} disabled={!text} onClick={download}><Download size={15} />Markdown</button></div>}
        </div>
        {state.clean !== null && <div className="flex items-center justify-between gap-3 pt-4 text-xs text-muted-foreground"><span>{state.refined ? 'Refined locally' : 'Whisper original'}</span><button id="version-button" className={button} onClick={() => update({ refined: !state.refined, copied: false })}>{state.refined ? 'Show original' : 'Show refined'}</button></div>}
        {state.raw ? <>
          <div id="transcript-text" className="my-5 max-h-[560px] flex-1 space-y-2 overflow-y-auto break-words">
            {state.refined ? <p dir="auto" className="whitespace-pre-wrap text-base leading-8">{text || 'No text after cleanup. Your original is still available.'}</p> : state.segments.map((segment, i) => <div key={i} className={cn('flex items-start gap-3 rounded-xl p-3 transition-colors', i === activeSegment && 'bg-accent')}>
              <button className="timestamp mt-1 shrink-0 font-mono text-xs text-muted-foreground hover:text-foreground" title="Approximate timestamp" aria-label={`Play video from ${formatTime(segment.start)}`} onClick={() => {
                try { video.current.currentTime = segment.start; void video.current.play().catch(() => {}); }
                catch { update({ error: 'This browser cannot seek in the preview. Try its playback controls.' }); }
              }}>{formatTime(segment.start)}</button><p dir="auto" className="min-w-0 text-base leading-7">{segment.text}</p>
            </div>)}
          </div>
          <div className="mt-auto flex flex-wrap justify-between gap-2 border-t border-border pt-4 text-xs text-muted-foreground"><span>{wordCount(text, state.resultLanguage).toLocaleString()} words · {languageLabel(state.resultLanguage)}</span>{!state.refined && <span>Click a timestamp to listen</span>}</div>
        </> : <div className="flex flex-1 flex-col items-center justify-center gap-4 px-2 py-14 text-center text-muted-foreground">
          {state.busy ? <LoaderCircle size={28} className="animate-spin" /> : <FileText size={28} strokeWidth={1.5} />}
          <p>{state.busy ? state.label : state.done ? 'No speech found in this video.' : 'Your words will appear here.'}</p>
          {state.draft ? <><p dir="auto" className="max-w-lg text-left text-base leading-7 text-foreground">{state.draft}</p><p className="text-xs">{state.draftNote}</p></> : <p className="max-w-sm text-sm leading-6">{state.busy ? 'You can keep watching while we work.' : 'Choose a video, select its language, and turn spoken words into text.'}</p>}
        </div>}
      </section>
    </div>
    {state.error && <p role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 px-5 py-4 text-sm text-destructive">{state.error}</p>}
    <p role="status" className="text-sm text-muted-foreground">{state.note}</p>
    <div className="flex flex-wrap items-center justify-between gap-3 text-xs leading-5 text-muted-foreground"><span className="inline-flex items-center gap-2"><ShieldCheck size={15} />Local processing. No video uploads or account needed.</span><a href="/licenses/S1-mini/LICENSE" className="underline underline-offset-4">S1-mini by Superwhisper · License</a></div>
  </div>;
}
