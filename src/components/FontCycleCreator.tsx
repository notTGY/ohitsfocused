import ToolHelp from '@/components/ToolHelp';
import { Button } from '@/components/ui/button';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react';
import {
  Check,
  Download,
  ImagePlus,
  Pause,
  Play,
} from 'lucide-react';

import { cn } from '@/lib/utils';

const VIDEO_DURATION_SECONDS = 60;
const EXPORT_WIDTH = 720;
const EXPORT_HEIGHT = 1280;
const DEFAULT_TEXT = 'Same words. Different mood.';

const FONT_OPTIONS = [
  {
    id: 'inter',
    label: 'Inter',
    cssFamily: '"Inter", sans-serif',
    canvasFamily: '"Inter"',
  },
  {
    id: 'manrope',
    label: 'Manrope',
    cssFamily: '"Manrope", sans-serif',
    canvasFamily: '"Manrope"',
  },
  {
    id: 'space-grotesk',
    label: 'Space Grotesk',
    cssFamily: '"Space Grotesk", sans-serif',
    canvasFamily: '"Space Grotesk"',
  },
  {
    id: 'playfair',
    label: 'Playfair Display',
    cssFamily: '"Playfair Display", serif',
    canvasFamily: '"Playfair Display"',
  },
  {
    id: 'dm-serif',
    label: 'DM Serif Display',
    cssFamily: '"DM Serif Display", serif',
    canvasFamily: '"DM Serif Display"',
  },
  {
    id: 'ibm-plex-mono',
    label: 'IBM Plex Mono',
    cssFamily: '"IBM Plex Mono", monospace',
    canvasFamily: '"IBM Plex Mono"',
  },
] as const;

type FontOption = (typeof FONT_OPTIONS)[number];

function getSupportedMimeType() {
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];

  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? '';
}

function drawCoverImage(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
) {
  const canvasRatio = width / height;
  const imageRatio = image.width / image.height;

  let drawWidth = width;
  let drawHeight = height;
  let offsetX = 0;
  let offsetY = 0;

  if (imageRatio > canvasRatio) {
    drawWidth = height * imageRatio;
    offsetX = (width - drawWidth) / 2;
  } else {
    drawHeight = width / imageRatio;
    offsetY = (height - drawHeight) / 2;
  }

  context.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);
}

function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = [];
  const paragraphs = text.split('\n');

  for (const [index, paragraph] of paragraphs.entries()) {
    const trimmed = paragraph.trim();

    if (!trimmed) {
      lines.push('');
      continue;
    }

    const words = trimmed.split(/\s+/);
    let currentLine = words[0] ?? '';

    for (let wordIndex = 1; wordIndex < words.length; wordIndex += 1) {
      const candidate = `${currentLine} ${words[wordIndex]}`;

      if (context.measureText(candidate).width <= maxWidth) {
        currentLine = candidate;
      } else {
        lines.push(currentLine);
        currentLine = words[wordIndex] ?? '';
      }
    }

    lines.push(currentLine);

  }

  return lines;
}

function drawTextBlock(
  context: CanvasRenderingContext2D,
  text: string,
  font: FontOption,
  areaX: number,
  areaY: number,
  areaWidth: number,
  areaHeight: number,
) {
  const content = text.trim() || DEFAULT_TEXT;
  const horizontalPadding = 44;
  const verticalPadding = 36;
  const maxWidth = areaWidth - horizontalPadding * 2;
  const maxHeight = areaHeight - verticalPadding * 2;

  let fontSize = 78;
  let lines = [content];
  let lineHeight = fontSize * 1.12;

  while (fontSize >= 32) {
    context.font = `700 ${fontSize}px ${font.canvasFamily}`;
    lines = wrapText(context, content, maxWidth);
    lineHeight = fontSize * 1.12;

    if (lines.length * lineHeight <= maxHeight) {
      break;
    }

    fontSize -= 2;
  }

  context.save();
  context.font = `700 ${fontSize}px ${font.canvasFamily}`;
  context.textAlign = 'center';
  context.textBaseline = 'top';
  context.fillStyle = '#ffffff';
  context.shadowColor = 'rgba(0, 0, 0, 0.22)';
  context.shadowBlur = 24;
  context.shadowOffsetY = 10;

  const textStartY = areaY + (areaHeight - lines.length * lineHeight) / 2;

  lines.forEach((line, index) => {
    context.fillText(line, areaX + areaWidth / 2, textStartY + index * lineHeight);
  });

  context.restore();
}

function drawFrame(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  text: string,
  font: FontOption,
) {
  const width = context.canvas.width;
  const height = context.canvas.height;

  context.clearRect(0, 0, width, height);
  drawCoverImage(context, image, width, height);

  const topGradient = context.createLinearGradient(0, 0, 0, height * 0.7);
  topGradient.addColorStop(0, 'rgba(10, 10, 11, 0.5)');
  topGradient.addColorStop(0.5, 'rgba(10, 10, 11, 0.12)');
  topGradient.addColorStop(1, 'rgba(10, 10, 11, 0)');
  context.fillStyle = topGradient;
  context.fillRect(0, 0, width, height);

  const textAreaWidth = width * 0.82;
  const textAreaHeight = height * 0.24;
  const textAreaX = (width - textAreaWidth) / 2;
  const textAreaY = height * 0.12;

  drawTextBlock(context, text, font, textAreaX, textAreaY, textAreaWidth, textAreaHeight);
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load the selected image.'));
    image.src = source;
  });
}

function clampInterval(value: number) {
  return Math.min(2, Math.max(0.1, Math.round(value * 10) / 10));
}

function FontDemo({ id, paused }: { id: string; paused: boolean }) {
  return <svg viewBox="0 0 420 176" aria-hidden="true" className="font-demo w-full max-w-[320px]" style={{ animationPlayState: paused ? 'paused' : 'running' }}>
    <style>{`
      .font-demo * { animation-play-state: inherit; }
      .font-demo .type { opacity: 0; }
      .font-demo .type:first-of-type { opacity: 1; }
      @media (prefers-reduced-motion: no-preference) {
        .font-demo .type { animation: font-demo-cycle 6s step-end infinite; animation-play-state: inherit; }
        @keyframes font-demo-cycle { 0%,33.33%,100% { opacity: 1; } 33.34%,99.99% { opacity: 0; } }
      }
    `}</style>
    <defs><g id={id}>
      <rect width="100" height="156" rx="5" fill="var(--muted)" />
      <circle cx="71" cy="32" r="10" fill="var(--muted-foreground)" fillOpacity=".3" />
      <path d="m0 114 36-45 27 33 17-23 20 35v42H0Z" fill="var(--muted-foreground)" fillOpacity=".18" />
      <path d="m0 132 28-23 32 28 23-12 17 12" fill="none" stroke="var(--muted-foreground)" strokeOpacity=".4" />
      <rect width="100" height="156" rx="5" fill="none" stroke="var(--border)" />
    </g></defs>
    <use href={`#${id}`} x="66" y="10" />
    <path d="M188 88h32m-7-7 7 7-7 7" fill="none" stroke="var(--muted-foreground)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <use href={`#${id}`} x="244" y="10" />
    <g fill="var(--foreground)" textAnchor="middle" fontSize="19">
      {['Georgia, serif', 'system-ui, sans-serif', 'monospace'].map((font, index) => <text key={font} className="type" x="294" y="79" fontFamily={font} fontWeight={index === 1 ? 650 : 400} style={{ animationDelay: `${index * -2}s` }}><tspan x="294">Stay</tspan><tspan x="294" dy="25">curious.</tspan></text>)}
    </g>
  </svg>;
}

export default function FontCycleCreator() {
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const exportCanvasRef = useRef<HTMLCanvasElement>(null);
  const imageObjectUrlRef = useRef<string | null>(null);
  const videoObjectUrlRef = useRef<string | null>(null);
  const [imageUrl, setImageUrl] = useState('');
  const [text, setText] = useState(DEFAULT_TEXT);
  const [selectedFontIds, setSelectedFontIds] = useState<string[]>(['inter', 'space-grotesk', 'playfair']);
  const [changeIntervalSeconds, setChangeIntervalSeconds] = useState(0.8);
  const [isDragActive, setIsDragActive] = useState(false);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(true);
  const [currentFontIndex, setCurrentFontIndex] = useState(0);
  const [exportedVideoUrl, setExportedVideoUrl] = useState('');
  const [exportProgressSeconds, setExportProgressSeconds] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [showDemo, setShowDemo] = useState(false);
  const [demoPaused, setDemoPaused] = useState(false);
  const [isChoosingFile, setIsChoosingFile] = useState(false);

  useEffect(() => {
    setShowDemo(false);
    if (imageUrl || isChoosingFile || isDragActive) return;
    const timer = window.setTimeout(() => { setDemoPaused(false); setShowDemo(true); }, 3000);
    return () => window.clearTimeout(timer);
  }, [imageUrl, isChoosingFile, isDragActive]);

  const selectedFontsKey = selectedFontIds.join('|');
  const activeFonts = FONT_OPTIONS.filter((font) => selectedFontIds.includes(font.id));
  const previewFont = activeFonts[currentFontIndex % Math.max(activeFonts.length, 1)] ?? FONT_OPTIONS[0];
  const canExport = Boolean(imageUrl && text.trim() && activeFonts.length > 0 && !isExporting);

  function setImageObjectUrl(nextUrl: string | null) {
    if (imageObjectUrlRef.current) {
      URL.revokeObjectURL(imageObjectUrlRef.current);
    }

    imageObjectUrlRef.current = nextUrl;
    setImageUrl(nextUrl ?? '');
  }

  function setVideoObjectUrl(nextUrl: string | null) {
    if (videoObjectUrlRef.current) {
      URL.revokeObjectURL(videoObjectUrlRef.current);
    }

    videoObjectUrlRef.current = nextUrl;
    setExportedVideoUrl(nextUrl ?? '');
  }

  function clearRenderedVideo() {
    if (videoObjectUrlRef.current) {
      setVideoObjectUrl(null);
    }
  }

  function applyFile(file: File | null | undefined) {
    if (!file || isExporting) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      setErrorMessage('Upload a JPG, PNG, or another image file.');
      return;
    }

    setErrorMessage('');
    clearRenderedVideo();
    setImageObjectUrl(URL.createObjectURL(file));
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    setIsChoosingFile(false);
    applyFile(event.target.files?.[0]);
    event.target.value = '';
  }

  function handleDragOver(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragActive(true);
  }

  function handleDragLeave(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragActive(false);
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragActive(false);
    applyFile(event.dataTransfer.files?.[0]);
  }

  function toggleFont(fontId: string) {
    clearRenderedVideo();
    setSelectedFontIds((current) =>
      current.includes(fontId)
        ? current.filter((selectedFontId) => selectedFontId !== fontId)
        : [...current, fontId],
    );
  }

  function resetCreator() {
    setErrorMessage('');
    setShowSettings(false);
    setText(DEFAULT_TEXT);
    setSelectedFontIds(['inter', 'space-grotesk', 'playfair']);
    setChangeIntervalSeconds(0.8);
    setIsPreviewPlaying(!window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    setCurrentFontIndex(0);
    setExportProgressSeconds(0);
    setImageObjectUrl(null);
    setVideoObjectUrl(null);
  }

  async function handleExport() {
    if (!imageUrl || !text.trim() || activeFonts.length === 0) {
      setErrorMessage('Add text, upload an image, and keep at least one font selected.');
      return;
    }

    if (typeof MediaRecorder === 'undefined') {
      setErrorMessage('This browser cannot export the video with MediaRecorder.');
      return;
    }

    const canvas = exportCanvasRef.current;

    if (!canvas) {
      setErrorMessage('The export canvas is not available.');
      return;
    }

    let animationFrameId = 0;
    let stream: MediaStream | null = null;

    setErrorMessage('');
    clearRenderedVideo();
    setExportProgressSeconds(0);
    setIsExporting(true);

    try {
      const context = canvas.getContext('2d');

      if (!context) {
        throw new Error('Could not create the export canvas context.');
      }

      const image = await loadImage(imageUrl);

      canvas.width = EXPORT_WIDTH;
      canvas.height = EXPORT_HEIGHT;

      if ('fonts' in document) {
        await Promise.all(
          activeFonts.map((font) => document.fonts.load(`700 64px ${font.canvasFamily}`)),
        );
        await document.fonts.ready;
      }

      drawFrame(context, image, text, activeFonts[0] ?? FONT_OPTIONS[0]);

      stream = canvas.captureStream(30);

      const mimeType = getSupportedMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 })
        : new MediaRecorder(stream, { videoBitsPerSecond: 6_000_000 });
      const chunks: BlobPart[] = [];

      const recorderFinished = new Promise<void>((resolve, reject) => {
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            chunks.push(event.data);
          }
        };

        recorder.onerror = () => {
          reject(new Error('The browser stopped the recording.'));
        };

        recorder.onstop = () => {
          resolve();
        };
      });

      recorder.start();

      await new Promise<void>((resolve) => {
        const startTime = performance.now();
        let lastReportedSecond = -1;

        const step = (timestamp: number) => {
          const elapsed = Math.min(timestamp - startTime, VIDEO_DURATION_SECONDS * 1000);
          const elapsedSeconds = Math.floor(elapsed / 1000);

          if (elapsedSeconds !== lastReportedSecond) {
            lastReportedSecond = elapsedSeconds;
            setExportProgressSeconds(Math.min(elapsedSeconds, VIDEO_DURATION_SECONDS));
          }

          const fontIndex =
            Math.floor(elapsed / (changeIntervalSeconds * 1000)) % Math.max(activeFonts.length, 1);
          const currentFont = activeFonts[fontIndex] ?? FONT_OPTIONS[0];

          drawFrame(context, image, text, currentFont);

          if (elapsed >= VIDEO_DURATION_SECONDS * 1000) {
            setExportProgressSeconds(VIDEO_DURATION_SECONDS);
            resolve();
            return;
          }

          animationFrameId = window.requestAnimationFrame(step);
        };

        animationFrameId = window.requestAnimationFrame(step);
      });

      recorder.stop();
      await recorderFinished;

      const blob = new Blob(chunks, { type: mimeType || 'video/webm' });
      setVideoObjectUrl(URL.createObjectURL(blob));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not export the font cycle.';
      setErrorMessage(message);
    } finally {
      if (animationFrameId) {
        window.cancelAnimationFrame(animationFrameId);
      }

      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }

      setIsExporting(false);
    }
  }

  useEffect(() => {
    return () => {
      if (imageObjectUrlRef.current) {
        URL.revokeObjectURL(imageObjectUrlRef.current);
      }

      if (videoObjectUrlRef.current) {
        URL.revokeObjectURL(videoObjectUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => { if (preference.matches) setIsPreviewPlaying(false); };
    update();
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    setCurrentFontIndex(0);
  }, [selectedFontsKey, changeIntervalSeconds]);

  useEffect(() => {
    if (!isPreviewPlaying || activeFonts.length < 2) {
      return;
    }

    const timer = window.setInterval(() => {
      setCurrentFontIndex((currentIndex) => (currentIndex + 1) % activeFonts.length);
    }, changeIntervalSeconds * 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [activeFonts.length, changeIntervalSeconds, isPreviewPlaying, selectedFontsKey]);

  useEffect(() => {
    setExportProgressSeconds(0);
    setErrorMessage('');

    if (videoObjectUrlRef.current) {
      setVideoObjectUrl(null);
    }
  }, [changeIntervalSeconds, imageUrl, selectedFontsKey, text]);

  if (!imageUrl) return (
    <section className="mx-auto flex min-h-[65svh] max-w-lg flex-col justify-center">
      <label htmlFor={fileInputId} onDragLeave={handleDragLeave} onDragOver={handleDragOver} onDrop={handleDrop}
        className={cn('flex min-h-72 cursor-pointer flex-col items-center justify-center gap-4 rounded-lg border border-dashed px-6 py-10 text-center focus-within:ring-2 focus-within:ring-ring hover:bg-muted/30', isDragActive && 'bg-muted ring-2 ring-ring')}>
        <input id={fileInputId} ref={fileInputRef} type="file" accept="image/*" className="sr-only" onChange={handleFileChange} onClick={() => setIsChoosingFile(true)} onCancel={() => setIsChoosingFile(false)} />
        <span className="relative flex h-32 w-full items-center justify-center">
          <ImagePlus className={cn('size-6 text-muted-foreground transition-opacity motion-reduce:transition-none', showDemo && 'opacity-0')} />
          {showDemo && <span className="absolute inset-0 flex items-center justify-center animate-in fade-in duration-500 motion-reduce:animate-none"><FontDemo id={`${fileInputId}-demo`} paused={demoPaused} /></span>}
        </span>
        <span className="font-medium">Choose an image</span>
        <span className="max-w-xs text-sm leading-6 text-muted-foreground">Add your words. Turn them into a video with changing fonts.</span>
        <span className="text-xs text-muted-foreground">or drop it here</span>
      </label>
      <div className="flex h-10 justify-center motion-reduce:hidden">
        {showDemo && <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => setDemoPaused(!demoPaused)}>{demoPaused ? <Play className="size-3" /> : <Pause className="size-3" />}{demoPaused ? 'Play demo' : 'Pause demo'}</Button>}
      </div>
      {errorMessage && <p role="alert" className="mt-4 text-sm text-destructive">{errorMessage}</p>}
    </section>
  );

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <input id={fileInputId} ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} disabled={isExporting} />
      <div role="toolbar" aria-label="Font cycle controls" className="flex flex-wrap items-center gap-1">
        <Button variant="ghost" disabled={isExporting} onClick={() => fileInputRef.current?.click()}>Replace</Button>
        <Button variant="ghost" disabled={isExporting} aria-expanded={showSettings} aria-controls="font-settings" onClick={() => setShowSettings(!showSettings)}>Fonts & timing</Button>
        {!exportedVideoUrl && <Button variant="ghost" disabled={isExporting} aria-label={isPreviewPlaying ? 'Pause preview' : 'Play preview'} onClick={() => setIsPreviewPlaying(!isPreviewPlaying)}>{isPreviewPlaying ? <Pause /> : <Play />}</Button>}
        <div className="ml-auto flex items-center gap-1">
          <ToolHelp><p>Type directly on the image. The selected fonts change automatically.</p><p className="mt-2">Export makes a 60-second vertical WebM. Keep this tab visible for the minute it takes. Your image stays on this device.</p><Button variant="ghost" className="mt-2 w-full" disabled={isExporting} onClick={resetCreator}>Start over</Button></ToolHelp>
          {exportedVideoUrl ? <Button asChild><a href={exportedVideoUrl} download="font-cycle.webm"><Download />Save video</a></Button> : <Button disabled={!canExport} onClick={handleExport}>{isExporting ? `${exportProgressSeconds}s / 60s` : 'Export'}</Button>}
        </div>
      </div>
      {showSettings && <fieldset id="font-settings" disabled={isExporting} className="space-y-4 border-y border-border py-4">
        <legend className="sr-only">Fonts and timing</legend>
        <div className="flex flex-wrap gap-2">{FONT_OPTIONS.map(font => {
          const selected = selectedFontIds.includes(font.id);
          return <Button key={font.id} variant={selected ? 'secondary' : 'ghost'} aria-pressed={selected} onClick={() => toggleFont(font.id)} style={{ fontFamily: font.cssFamily }}>
            {selected && <Check className="size-3" />}{font.label}
          </Button>;
        })}</div>
        <label className="flex flex-wrap items-center gap-3 text-sm">Change every
          <input aria-label="Seconds between font changes" className="min-w-24 flex-1 accent-foreground" type="range" min={0.1} max={2} step={0.1} value={changeIntervalSeconds} onChange={event => setChangeIntervalSeconds(clampInterval(Number(event.target.value)))} />
          <span className="w-10 tabular-nums">{changeIntervalSeconds.toFixed(1)}s</span>
        </label>
        {!activeFonts.length && <p role="alert" className="text-sm text-muted-foreground">Choose at least one font.</p>}
      </fieldset>}
      <div className="mx-auto w-full max-w-[min(100%,360px,50svh)]">
        {exportedVideoUrl ? <>
          <video aria-label="Exported font cycle" className="aspect-[9/16] w-full rounded-lg bg-black" controls playsInline loop src={exportedVideoUrl} />
          <Button variant="ghost" className="mt-2 w-full" onClick={clearRenderedVideo}>Back to editing</Button>
        </> : <div className="relative aspect-[9/16] overflow-hidden rounded-lg bg-muted">
          <img alt="Your image" className="h-full w-full object-cover" src={imageUrl} />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/45 via-black/10 to-transparent" />
          <textarea aria-label="Your words" disabled={isExporting} className="absolute left-1/2 top-[12%] h-[36%] w-[82%] -translate-x-1/2 resize-none border-none bg-transparent px-2 py-3 text-center text-2xl font-bold leading-tight text-white placeholder:text-white/60"
            maxLength={220} onChange={event => setText(event.target.value)} placeholder="Your words here" spellCheck={false} style={{ fontFamily: previewFont.cssFamily, textShadow: '0 2px 12px rgb(0 0 0 / 35%)' }} value={text} />
        </div>}
      </div>
      {isExporting && <p role="status" className="text-center text-xs text-muted-foreground">Exporting. Keep this tab visible.</p>}
      {errorMessage && <p role="alert" className="text-sm text-destructive">{errorMessage}</p>}
      <canvas aria-hidden="true" className="hidden" ref={exportCanvasRef} />
    </div>
  );
}
