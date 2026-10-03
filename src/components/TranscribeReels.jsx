import ToolHelp from '@/components/ToolHelp';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Download, FileText, LoaderCircle, Pause, Play, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SAMPLE_RATE, MAX_DURATION_SECONDS, LANGUAGES, WHISPER_MODELS, modelForLanguage, languageLabel, formatTime, formatBytes, validateVideoFile, wordCount, normalizeSegments, markdownTranscript } from '@/lib/transcribe/core.js';

const button = 'min-h-11 inline-flex items-center justify-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40';
const panel = 'min-w-0';
const initial = { file: null, url: '', duration: 0, language: 'en', modelSize: 'tiny', supported: false, smart: false, smartSupport: 'Checking device compatibility…', busy: false, refining: false, loadedModel: '', label: '', detail: '', percent: null, draft: '', draftNote: '', error: '', note: '', raw: '', segments: [], clean: null, refined: false, resultLanguage: 'en', resultModelSize: '', done: false, copied: false };

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

function TranscriptEditor({ value, onChange, disabled, label, placeholder }) {
  const input = useRef(null);
  useEffect(() => {
    input.current.style.height = 'auto';
    input.current.style.height = `${input.current.scrollHeight}px`;
  }, [value]);
  return <Textarea ref={input} dir="auto" aria-label={label} value={value} onChange={onChange} disabled={disabled} placeholder={placeholder} rows={1}
    className="min-h-11 min-w-0 resize-none border-transparent leading-7 shadow-none hover:border-input/50 md:text-base dark:bg-transparent" />;
}

function TranscriptDemo({ paused }) {
  return <svg viewBox="0 0 420 176" aria-hidden="true" className="transcript-demo size-auto w-full max-w-[320px]" style={{ animationPlayState: paused ? 'paused' : 'running' }}>
    <style>{`
      .transcript-demo * { animation-play-state: inherit; }
      @media (prefers-reduced-motion: no-preference) {
        .transcript-demo .wave { transform-box: fill-box; transform-origin: center; animation: transcript-wave .8s ease-in-out infinite alternate; animation-play-state: inherit; }
        .transcript-demo .line { animation: transcript-line 7s ease-in-out infinite; animation-play-state: inherit; }
        @keyframes transcript-wave { to { transform: scaleY(.35); } }
        @keyframes transcript-line { 0%,12%,100% { opacity: 0; } 28%,85% { opacity: 1; } 95% { opacity: 0; } }
        @keyframes transcript-second { 0%,25%,100% { opacity: 0; } 42%,85% { opacity: 1; } 95% { opacity: 0; } }
        @keyframes transcript-rest { 0%,40%,100% { opacity: 0; } 56%,85% { opacity: 1; } 95% { opacity: 0; } }
      }
    `}</style>
    <g stroke="var(--border)" fill="var(--muted)" strokeWidth="1.5">
      <rect x="34" y="18" width="116" height="140" rx="5" />
      <rect x="242" y="18" width="144" height="140" rx="5" fill="var(--background)" />
    </g>
    <g fill="var(--muted-foreground)">
      <circle cx="92" cy="62" r="19" /><path d="M54 113v-11a38 30 0 0 1 76 0v11Z" />
      <path d="M74 50c3-18 33-22 38 2" fill="none" stroke="var(--foreground)" strokeWidth="2" strokeLinecap="round" />
    </g>
    <path d="M179 88h32m-7-7 7 7-7 7" fill="none" stroke="var(--muted-foreground)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <g stroke="var(--foreground)" strokeWidth="2" strokeLinecap="round">
      {[8, 16, 24, 12, 20, 28, 16, 8].map((height, index) => <path key={index} className="wave" d={`M${64 + index * 8} ${135 - height / 2}v${height}`} style={{ animationDelay: `${index * -.13}s` }} />)}
    </g>
    <g fill="var(--foreground)" fontFamily="system-ui, sans-serif" fontSize="14">
      <text className="line" x="258" y="63">A small idea.</text>
      <text className="line" x="258" y="88" style={{ animationName: 'transcript-second' }}>Worth keeping.</text>
    </g>
    <g stroke="var(--muted-foreground)" strokeOpacity=".4" strokeWidth="2" strokeLinecap="round">
      <path className="line" d="M258 113h106m-106 13h78" style={{ animationName: 'transcript-rest' }} />
    </g>
  </svg>;
}

export default function TranscribeReels() {
  const [state, setState] = useState(initial);
  const current = useRef(initial);
  const job = useRef({ id: 0, worker: null, smartWorker: null, abort: null, copyTimer: null });
  const input = useRef(null), video = useRef(null);
  const [time, setTime] = useState(0), [dragging, setDragging] = useState(false);
  const [showDemo, setShowDemo] = useState(false), [demoPaused, setDemoPaused] = useState(false), [isChoosingFile, setIsChoosingFile] = useState(false);
  useEffect(() => {
    setShowDemo(false);
    if (state.file || isChoosingFile || dragging) return;
    const timer = window.setTimeout(() => { setDemoPaused(false); setShowDemo(true); }, 3000);
    return () => window.clearTimeout(timer);
  }, [state.file, isChoosingFile, dragging]);
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
    update({ file, url: URL.createObjectURL(file), duration: 0, raw: '', segments: [], clean: null, refined: false, resultModelSize: '', done: false, copied: false, error: '', note: '', draft: '' });
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
        case 'download': progress(data.initializing ? 'Preparing the model…' : `Downloading Whisper ${current.current.modelSize}…`, data.total > 0 ? `${formatBytes(data.loaded)} / ${formatBytes(data.total)}` : `${formatBytes(data.loaded)} loaded`, !data.initializing && data.total > 0 ? data.loaded / data.total * 100 : null); break;
        case 'ready': update({ loadedModel: data.model }); break;
        case 'draft': update({ draft: data.text, draftNote: data.windows > 1 ? `Live preview · Part ${data.window} of ${data.windows}` : 'Live preview · Finishing touches to follow' }); break;
        case 'progress': progress('Transcribing on your device…', `${formatTime(data.processed)} / ${formatTime(data.duration)}`, data.processed / data.duration * 100); break;
        case 'complete': {
          const result = normalizeSegments(data.output, data.duration);
          job.current.abort = null;
          update({ raw: result.text, segments: result.segments, busy: false, done: true, draft: '', note: result.text ? 'Transcript ready. Edit any missed words before copying or saving.' : 'No speech detected. Try a clip with clear spoken audio.' });
          if (result.text && current.current.smart && current.current.resultLanguage === 'en') refine(result.text, 'en', data.id);
          break;
        }
        case 'error': failure(data.stage === 'load' ? 'Whisper could not load. Try a smaller model, or check your connection and allow downloads from Hugging Face and jsDelivr.' : 'This device could not finish transcription. Try a smaller model or shorter clip, close heavy tabs, or use another browser.'); break;
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
    if (s.smart && s.raw && s.clean === null && s.resultLanguage === 'en' && s.language === 'en' && s.resultModelSize === s.modelSize) { refine(s.raw, s.resultLanguage, id); return; }
    const controller = new AbortController();
    job.current.abort = controller;
    clearTimeout(job.current.copyTimer);
    update({ busy: true, refining: false, raw: '', segments: [], clean: null, refined: false, done: false, copied: false, resultLanguage: s.language, resultModelSize: s.modelSize, error: '', note: '', draft: '', draftNote: 'You can keep watching while we work.' });
    progress('Preparing the audio…');
    try {
      modelForLanguage(s.language, s.modelSize);
      const audio = await readAudio(s.file, s.duration, controller.signal);
      if (job.current.id !== id) return;
      update({ duration: audio.length / SAMPLE_RATE });
      progress(`Loading Whisper ${s.modelSize}…`);
      getWorker().postMessage({ type: 'transcribe', id, language: s.language, modelSize: s.modelSize, audio }, [audio.buffer]);
    } catch (error) { if (job.current.id === id && error.name !== 'AbortError') failure(error.message || 'The video could not be processed.'); }
  }

  const text = state.refined ? state.clean ?? '' : state.raw;
  const smartHint = state.language !== 'en' ? 'S1-mini currently supports English only.' : state.smartSupport || 'S1-mini by Superwhisper · about 365 MB plus runtime on first use.';
  const quality = WHISPER_MODELS.find(model => model.id === state.modelSize);
  const canRefine = state.smart && state.raw && state.clean === null && state.resultLanguage === 'en' && state.language === 'en' && state.resultModelSize === state.modelSize;
  const activeSegment = state.segments.findIndex(segment => time >= segment.start && time < segment.end);

  function editTranscript(value, index) {
    if (current.current.busy) return;
    clearTimeout(job.current.copyTimer);
    if (current.current.refined) update({ clean: value, copied: false });
    else {
      const segments = current.current.segments.map((segment, i) => i === index ? { ...segment, text: value } : segment);
      update({ segments, raw: segments.map(segment => segment.text.trim()).filter(Boolean).join(' '), copied: false });
    }
  }

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
    <div className={cn("grid items-start gap-6", state.file ? (state.busy || state.done || state.raw ? "lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]" : "mx-auto w-full max-w-lg") : "mx-auto flex min-h-[65svh] w-full max-w-lg flex-col justify-center")}>
      <section className={cn(panel, 'space-y-5', !state.file && 'w-full')} aria-label="Your video"
        onDragOver={event => { event.preventDefault(); if (!state.busy) setDragging(true); }}
        onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); }}
        onDrop={event => {
          event.preventDefault(); setDragging(false);
          if (state.busy) return;
          if (event.dataTransfer.files.length > 1) update({ error: 'Choose one video at a time.' });
          else chooseFile(event.dataTransfer.files[0]);
        }}>
        {state.file && <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" disabled={state.busy} onClick={() => input.current.click()}>Replace</Button>
          <ToolHelp><p>Choose the spoken language and quality, then transcribe. Select a timestamp to listen and edit the text to correct missed words. Copy or save includes your edits. Original and refined versions can be edited separately.</p><p className="mt-2">Your video stays on this device. Models download when transcription starts and are cached by your browser when space allows. Larger models generally improve accuracy but use more memory and take longer. Download sizes exclude the browser runtime. Clips can be up to 250 MB or 30 minutes.</p>
            <div className="mt-4 border-t pt-3">
              <label className="flex min-h-11 items-center gap-2"><input id="smart-checkbox" type="checkbox" aria-describedby="smart-hint" checked={state.smart} disabled={state.busy || state.language !== 'en' || Boolean(state.smartSupport)} onChange={event => update({ smart: event.target.checked })} />Clean up wording</label>
              <p id="smart-hint" className="text-xs text-muted-foreground">Remove fillers. Keep the original. {smartHint}</p>
              <a href="/licenses/S1-mini/LICENSE" className="mt-2 inline-block text-xs underline underline-offset-4">Cleanup model license</a>
            </div>
          </ToolHelp>
        </div>}
        <input ref={input} id="file-input" type="file" accept="video/*,.mp4,.mov,.webm,.m4v,.ogv,.mkv" className="hidden" disabled={state.busy} onClick={() => setIsChoosingFile(true)} onCancel={() => setIsChoosingFile(false)} onChange={event => { setIsChoosingFile(false); chooseFile(event.target.files?.[0]); event.target.value = ''; }} />
        {state.file ? <div className={cn('space-y-3 rounded-lg', dragging && 'ring-2 ring-ring')}>
          <video key={state.url} ref={video} src={state.url} controls playsInline preload="metadata" aria-label="Video preview" className="max-h-80 w-full rounded-lg bg-black" onTimeUpdate={event => setTime(event.currentTarget.currentTime)}
            onLoadedMetadata={event => {
              const duration = Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0;
              update({ duration, ...(duration > MAX_DURATION_SECONDS + 1 ? { error: 'Choose a clip under 30 minutes.' } : {}) });
            }} onError={() => update({ error: 'This browser cannot play the preview. You can still try transcription, or choose MP4 with AAC audio or WebM with Opus audio.' })} />

        </div> : <Button variant="outline" className={cn('flex min-h-72 w-full whitespace-normal flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-5 py-10 text-center transition-colors hover:bg-accent', dragging && 'bg-accent ring-2 ring-ring')} onClick={() => input.current.click()}>
          <span className="relative flex h-32 w-full items-center justify-center">
            <Upload size={24} className={cn('text-muted-foreground transition-opacity motion-reduce:transition-none', showDemo && 'opacity-0')} />
            {showDemo && <span className="absolute inset-0 flex items-center justify-center animate-in fade-in duration-500 motion-reduce:animate-none"><TranscriptDemo paused={demoPaused} /></span>}
          </span>
          <span className="font-medium">Choose a video</span><span className="text-sm font-normal text-muted-foreground">Turn speech into text you can copy or save.</span><span className="text-xs font-normal text-muted-foreground">or drop it here · up to 250 MB / 30 min</span>
        </Button>}
        {!state.file && <div className="flex h-10 justify-center motion-reduce:hidden">
          {showDemo && <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => setDemoPaused(!demoPaused)}>{demoPaused ? <Play className="size-3" /> : <Pause className="size-3" />}{demoPaused ? 'Play demo' : 'Pause demo'}</Button>}
        </div>}
        {state.file && <>
        <div className="space-y-2"><label htmlFor="transcribe-language" className="text-sm font-medium">Spoken language</label>
          <select id="transcribe-language" value={state.language} disabled={state.busy} onChange={event => update({ language: event.target.value, smart: event.target.value === 'en' && current.current.smart, error: '' })} className="w-full rounded-xl border border-input bg-background px-3 py-3 text-sm disabled:opacity-50">
            <option value="en">English</option>{LANGUAGES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2 text-sm"><label htmlFor="transcribe-quality" className="font-medium">Quality</label><span>{quality.label} · ~{quality.mb >= 1000 ? `${(quality.mb / 1000).toFixed(2)} GB` : `${quality.mb} MB`}</span></div>
          <input id="transcribe-quality" type="range" min={0} max={WHISPER_MODELS.length - 1} step={1} value={WHISPER_MODELS.indexOf(quality)} disabled={state.busy} aria-valuetext={quality.label} aria-describedby="transcribe-quality-hint" onChange={event => update({ modelSize: WHISPER_MODELS[Number(event.target.value)].id, error: '' })} className="min-h-11 w-full accent-foreground disabled:opacity-50" />
          <div aria-hidden="true" className="flex justify-between text-xs text-muted-foreground">{WHISPER_MODELS.map(model => <span key={model.id}>{model.label}</span>)}</div>
          <p id="transcribe-quality-hint" className="pt-1 text-xs leading-5 text-muted-foreground">{quality.overview} {state.loadedModel === modelForLanguage(state.language, state.modelSize) ? 'Loaded on this device.' : 'Model download on first use, plus browser runtime.'}</p>
        </div>
        {state.busy ? <div className="space-y-2" role="status">
          <div className="flex items-center gap-2 text-sm"><LoaderCircle size={16} className="shrink-0 animate-spin" /><span>{state.label}</span></div>
          <progress aria-label={state.label} max={100} value={state.percent == null ? undefined : Math.max(0, Math.min(100, state.percent))} className="h-1.5 w-full accent-current" />
          <p className="text-xs text-muted-foreground">{state.detail}</p>
        </div> : null}
        <Button variant="default" id="transcribe-button" onClick={start} disabled={!state.busy && (!state.file || !state.supported)} className={cn(button, 'w-full bg-primary py-3 text-primary-foreground hover:bg-primary/90')}>
          {state.busy ? (state.refining ? 'Stop refining' : 'Cancel') : canRefine ? 'Refine transcript' : state.done ? 'Transcribe again' : 'Transcribe video'}
        </Button>
        </>}
      </section>
      {(state.busy || state.done || state.raw) && <section className={cn(panel, 'flex min-h-96 flex-col lg:min-h-[620px]')} aria-labelledby="transcript-title" aria-busy={state.busy}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <h2 id="transcript-title" className="text-base font-medium">Transcript</h2>
          {state.segments.length > 0 && <div className="flex gap-2"><Button variant="outline" id="copy-button" className={button} disabled={!text.trim()} onClick={copy}>{state.copied ? <Check size={15} /> : <Copy size={15} />}{state.copied ? 'Copied' : 'Copy'}</Button><Button variant="outline" id="download-button" className={button} disabled={!text.trim()} onClick={download}><Download size={15} />Markdown</Button></div>}
        </div>
        {state.clean !== null && <div className="flex items-center justify-between gap-3 pt-4 text-xs text-muted-foreground"><span>{state.refined ? 'Refined locally' : 'Whisper original'}</span><Button variant="outline" id="version-button" className={button} onClick={() => update({ refined: !state.refined, copied: false })}>{state.refined ? 'Show original' : 'Show refined'}</Button></div>}
        {state.segments.length > 0 ? <>
          <div id="transcript-text" className="my-5 max-h-[560px] flex-1 space-y-2 overflow-y-auto break-words">
            {state.refined ? <TranscriptEditor value={text} label="Edit refined transcript" placeholder="No text after cleanup. Type here or show the original." disabled={state.busy} onChange={event => editTranscript(event.target.value)} /> : state.segments.map((segment, i) => <div key={i} className={cn('flex items-start gap-3 rounded-xl p-3 transition-colors', i === activeSegment && 'bg-accent')}>
              <Button variant="ghost" className="timestamp mt-1 shrink-0 font-mono text-xs text-muted-foreground hover:text-foreground" title="Approximate timestamp" aria-label={`Play video from ${formatTime(segment.start)}`} onClick={() => {
                try { video.current.currentTime = segment.start; void video.current.play().catch(() => {}); }
                catch { update({ error: 'This browser cannot seek in the preview. Try its playback controls.' }); }
              }}>{formatTime(segment.start)}</Button><TranscriptEditor value={segment.text} label={`Edit transcript at ${formatTime(segment.start)}`} disabled={state.busy} onChange={event => editTranscript(event.target.value, i)} />
            </div>)}
          </div>
          <div className="mt-auto flex flex-wrap justify-between gap-2 border-t border-border pt-4 text-xs text-muted-foreground"><span>{wordCount(text, state.resultLanguage).toLocaleString()} words · {languageLabel(state.resultLanguage)}</span>{!state.refined && <span>Click a timestamp to listen</span>}</div>
        </> : <div className="flex flex-1 flex-col items-center justify-center gap-4 px-2 py-14 text-center text-muted-foreground">
          {state.busy ? <LoaderCircle size={28} className="animate-spin" /> : <FileText size={28} strokeWidth={1.5} />}
          <p>{state.busy ? state.label : state.done ? 'No speech found in this video.' : 'Your words will appear here.'}</p>
          {state.draft ? <><p dir="auto" className="max-w-lg text-left text-base leading-7 text-foreground">{state.draft}</p><p className="text-xs">{state.draftNote}</p></> : <p className="max-w-sm text-sm leading-6">{state.busy ? 'You can keep watching while we work.' : 'Choose a video, select its language, and turn spoken words into text.'}</p>}
        </div>}
      </section>}
    </div>
    {state.error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-5 py-4 text-sm text-destructive">{state.error}</p>}
    {state.note && <p role="status" className="text-sm text-muted-foreground">{state.note}</p>}

  </div>;
}
