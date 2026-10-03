import { useEffect, useRef, useState } from 'react';
import { Bike, Building2, Coffee, Croissant, Download, LoaderCircle, Minus, Pause, Play, Plus, Store, Sunset, Upload, Users, Utensils, Waves } from 'lucide-react';
import ToolHelp from '@/components/ToolHelp';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatTime, validateVideoFile } from '@/lib/transcribe/core.js';

const initial = { file: null, rows: 3, columns: 3, result: null, busy: false, captured: 0, error: '', note: '' };
const gap = 4, caption = 32;

function MoodboardDemo({ paused }) {
  const scenes = [Building2, Bike, Waves, Store, Coffee, Croissant, Users, Utensils, Sunset];
  return <svg viewBox="0 0 420 176" aria-hidden="true" className="moodboard-demo size-auto w-full max-w-[320px]" style={{ animationPlayState: paused ? 'paused' : 'running' }}>
    <style>{`
      .moodboard-demo * { animation-play-state: inherit; }
      @media (prefers-reduced-motion: no-preference) {
        .moodboard-demo .sample { animation: moodboard-sample 9s ease-in-out infinite; animation-play-state: inherit; }
        @keyframes moodboard-sample { 0%,5%,100% { opacity: .5; } 15%,75% { opacity: 1; } 95% { opacity: .5; } }
      }
    `}</style>
    <g stroke="var(--border)" fill="var(--muted)" strokeWidth="1.5"><rect x="18" y="30" width="126" height="100" rx="5" /><rect x="18" y="111" width="126" height="19" rx="3" /></g>
    <g stroke="var(--muted-foreground)" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="111" cy="51" r="8" fill="var(--muted-foreground)" stroke="none" /><path d="M24 102 56 68l24 26 19-17 39 25" /><path d="m29 117 0 7 6-3.5ZM42 120.5h91M174 87h32m-7-7 7 7-7 7M24 148h114" />
      {scenes.map((_, i) => <path key={i} d={`M${29 + i * 13} 144v8`} />)}
    </g>
    {scenes.map((Scene, i) => <g key={i} className="sample" style={{ animationDelay: `${i * .35}s` }} transform={`translate(${240 + i % 3 * 53} ${13 + Math.floor(i / 3) * 53})`}>
      <rect width="47" height="47" rx="3" fill="var(--muted)" stroke="var(--border)" />
      <Scene x="7" y="4" width="33" height="33" className="size-auto" stroke="var(--muted-foreground)" strokeWidth="1.8" />
      <path d="M5 42h10" stroke="var(--muted-foreground)" strokeWidth="1.3" />
    </g>)}
  </svg>;
}

export function frameTimes(duration, count) {
  return Array.from({ length: count }, (_, i) => duration * ((i + 0.5) / count));
}

export function boardSize(width, height, rows, columns) {
  const scale = Math.min(1, 640 / Math.max(width, height), (3072 - gap * (columns - 1)) / (width * columns), (3072 - caption * rows - gap * (rows - 1)) / (height * rows));
  const tileWidth = Math.max(1, Math.floor(width * scale)), tileHeight = Math.max(1, Math.floor(height * scale));
  return { tileWidth, tileHeight, width: tileWidth * columns + gap * (columns - 1), height: (tileHeight + caption) * rows + gap * (rows - 1) };
}

function waitForVideo(video, event, signal, action) {
  return new Promise((resolve, reject) => {
    const finish = error => {
      clearTimeout(timer);
      video.removeEventListener(event, ready);
      video.removeEventListener('error', failed);
      signal.removeEventListener('abort', aborted);
      error ? reject(error) : resolve();
    };
    const ready = () => finish();
    const failed = () => finish(new Error('This browser could not read the video. Try an MP4 with H.264 video or a WebM.'));
    const aborted = () => finish(new DOMException('Cancelled', 'AbortError'));
    const timer = setTimeout(failed, 20000);
    video.addEventListener(event, ready);
    video.addEventListener('error', failed);
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) { aborted(); return; }
    try { action(); } catch (error) { finish(error); }
  });
}

export default function Moodboard() {
  const [state, setState] = useState(initial), [dragging, setDragging] = useState(false);
  const [showDemo, setShowDemo] = useState(false), [demoPaused, setDemoPaused] = useState(false), [isChoosingFile, setIsChoosingFile] = useState(false);
  const current = useRef(initial), job = useRef(null), input = useRef(null);
  const update = patch => { current.current = { ...current.current, ...patch }; setState(current.current); };
  useEffect(() => () => job.current?.abort(), []);
  useEffect(() => { const url = state.result?.url; return () => { if (url) URL.revokeObjectURL(url); }; }, [state.result?.url]);
  useEffect(() => {
    setShowDemo(false);
    if (state.file || isChoosingFile || dragging) return;
    const timer = window.setTimeout(() => { setDemoPaused(false); setShowDemo(true); }, 3000);
    return () => window.clearTimeout(timer);
  }, [state.file, isChoosingFile, dragging]);

  async function generate(file = current.current.file, rows = current.current.rows, columns = current.current.columns) {
    if (!file) return;
    const controller = new AbortController(), { signal } = controller;
    job.current?.abort();
    job.current = controller;
    update({ file, rows, columns, result: null, busy: true, captured: 0, error: '', note: '' });
    const video = document.createElement('video'), url = URL.createObjectURL(file);
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    try {
      await waitForVideo(video, 'loadedmetadata', signal, () => { video.src = url; video.load(); });
      if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.videoWidth || !video.videoHeight) throw new Error('This video has no readable duration or picture. Try another video export.');
      const size = boardSize(video.videoWidth, video.videoHeight, rows, columns), canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('This browser could not create the image. Try another browser.');
      context.fillStyle = '#171717';
      context.fillRect(0, 0, size.width, size.height);
      const times = frameTimes(video.duration, rows * columns);
      for (const [i, time] of times.entries()) {
        await waitForVideo(video, 'seeked', signal, () => { video.currentTime = time; });
        signal.throwIfAborted();
        const x = (i % columns) * (size.tileWidth + gap), y = Math.floor(i / columns) * (size.tileHeight + caption + gap);
        context.drawImage(video, x, y, size.tileWidth, size.tileHeight);
        context.fillStyle = '#d4d4d4';
        context.font = '16px ui-monospace, monospace';
        const stamp = `${formatTime(time)}.${Math.floor((time % 1) * 10)}`;
        context.fillText(`${String(i + 1).padStart(2, '0')} · ${stamp}`, x + 8, y + size.tileHeight + 21, Math.max(1, size.tileWidth - 16));
        update({ captured: i + 1 });
      }
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      signal.throwIfAborted();
      if (!blob) throw new Error('The image could not be saved. Try a smaller grid.');
      update({ result: { url: URL.createObjectURL(blob), ...size, rows, columns }, busy: false });
    } catch (error) {
      if (!signal.aborted) update({ busy: false, error: error.message || 'Could not create the moodboard. Try another video.' });
    } finally {
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
      if (job.current === controller) job.current = null;
    }
  }

  function chooseFile(file) {
    if (!file || current.current.busy) return;
    try { validateVideoFile(file); void generate(file); }
    catch (error) { update({ error: error.message }); }
  }

  function adjust(key, delta) {
    const next = { ...current.current, [key]: current.current[key] + delta };
    if (next.busy || next[key] < 1 || next[key] > 6) return;
    void generate(next.file, next.rows, next.columns);
  }

  function save() {
    const { file, result, busy } = current.current;
    if (!result || busy) return;
    const anchor = document.createElement('a');
    anchor.href = result.url;
    anchor.download = `${file.name.replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').slice(0, 160) || 'video'}-moodboard-${result.columns}x${result.rows}.png`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }

  return <div className="space-y-4">
    <input ref={input} type="file" accept="video/*,.mp4,.mov,.webm,.m4v,.ogv,.mkv" className="hidden" disabled={state.busy} onClick={() => setIsChoosingFile(true)} onCancel={() => setIsChoosingFile(false)} onChange={event => { setIsChoosingFile(false); chooseFile(event.target.files?.[0]); event.target.value = ''; }} />
    {!state.file ? <div className="mx-auto flex min-h-[65svh] max-w-lg items-center" onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => {
      event.preventDefault(); setDragging(false);
      if (event.dataTransfer.files.length > 1) update({ error: 'Choose one video at a time.' });
      else chooseFile(event.dataTransfer.files[0]);
    }}>
      <div className="w-full">
        <Button variant="outline" className={cn('min-h-72 w-full flex-col gap-4 whitespace-normal rounded-lg border-dashed px-5 py-10 text-center', dragging && 'bg-accent ring-2 ring-ring')} onClick={() => input.current.click()}>
          <span className="relative flex h-32 w-full items-center justify-center">
            <Upload className={cn('size-6 text-muted-foreground transition-opacity motion-reduce:transition-none', showDemo && 'opacity-0')} />
            {showDemo && <span className="absolute inset-0 flex items-center justify-center animate-in fade-in duration-500 motion-reduce:animate-none"><MoodboardDemo paused={demoPaused} /></span>}
          </span>
          <span>Choose a video</span><span className="text-sm font-normal text-muted-foreground">Turn evenly spaced frames into one reference image.</span>
        </Button>
        <div className="flex h-10 items-center justify-center motion-reduce:hidden">
          {showDemo && <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => setDemoPaused(!demoPaused)}>{demoPaused ? <Play className="size-3" /> : <Pause className="size-3" />}{demoPaused ? 'Play demo' : 'Pause demo'}</Button>}
        </div>
      </div>
    </div> : <>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" disabled={state.busy} onClick={() => input.current.click()}>Replace</Button>
        {['rows', 'columns'].map(key => <div key={key} className="flex items-center gap-2 text-sm"><span>{key === 'rows' ? 'Rows' : 'Columns'}</span><div role="group" aria-label={key === 'rows' ? 'Rows' : 'Columns'} className="flex items-center rounded-md border border-input">
          <Button variant="ghost" size="icon" className="size-11" aria-label={`Decrease ${key}`} disabled={state.busy || state[key] === 1} onClick={() => adjust(key, -1)}><Minus className="size-3.5" /></Button>
          <output aria-label={key} className="w-5 text-center tabular-nums">{state[key]}</output>
          <Button variant="ghost" size="icon" className="size-11" aria-label={`Increase ${key}`} disabled={state.busy || state[key] === 6} onClick={() => adjust(key, 1)}><Plus className="size-3.5" /></Button>
        </div></div>)}
        <span className="text-xs text-muted-foreground">{state.rows * state.columns} frames</span>
        <div className="ml-auto flex items-center gap-2">
          {state.busy ? <Button variant="outline" onClick={() => { job.current?.abort(); update({ busy: false, note: 'Stopped. Your video is ready when you are.' }); }}>Cancel</Button> : state.result ? <Button onClick={save}><Download className="size-4" />Save PNG</Button> : <Button onClick={() => void generate()}>Create moodboard</Button>}
          <ToolHelp><p>Frames are sampled from the middle of equal time intervals, in order from left to right, then top to bottom. Timestamps appear below each full frame.</p><p className="mt-2">Change rows or columns to rebuild the grid. Save a PNG, then pair it with a <a href="/tools/transcribe-reels/" className="underline underline-offset-4">transcript</a> when sharing a reference with an AI that accepts images.</p><p className="mt-2">Your video stays on this device. Up to 250 MB; the browser must support its video format. Frames are scaled to fit a maximum 3072-pixel image edge. Brief actions between samples may be missed.</p></ToolHelp>
        </div>
      </div>
      <section aria-label="Moodboard preview" aria-busy={state.busy}>
        {state.busy ? <div className="flex min-h-72 flex-col items-center justify-center gap-4 text-sm text-muted-foreground" role="status"><LoaderCircle className="size-6 animate-spin motion-reduce:animate-none" /><p>{state.captured ? `Captured ${state.captured} of ${state.rows * state.columns} frames` : 'Reading your video…'}</p><progress max={state.rows * state.columns} value={state.captured} aria-label="Frames captured" className="h-1.5 w-48 accent-foreground" /></div> : state.result && <figure className="space-y-3">
          <img src={state.result.url} alt={`Video moodboard with ${state.result.rows} rows and ${state.result.columns} columns of frames in chronological order, each labeled with its timestamp`} width={state.result.width} height={state.result.height} className="mx-auto max-h-[75svh] w-auto max-w-full rounded-md object-contain" />
          <figcaption className="text-center text-xs text-muted-foreground">{state.result.width} × {state.result.height} · PNG</figcaption>
        </figure>}
      </section>
    </>}
    {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
    {state.note && <p role="status" className="text-sm text-muted-foreground">{state.note}</p>}
  </div>;
}
