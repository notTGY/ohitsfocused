import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
} from 'react';
import {
  Check,
  Clock3,
  Download,
  ImagePlus,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
} from 'lucide-react';

import { cn } from '@/lib/utils';

const VIDEO_DURATION_SECONDS = 60;
const EXPORT_WIDTH = 720;
const EXPORT_HEIGHT = 1280;
const DEFAULT_TEXT = 'Your words stay still. The voice keeps changing.';

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

interface ActionButtonProps {
  active?: boolean;
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick?: () => void;
}

function ActionButton({ active, children, disabled, label, onClick }: ActionButtonProps) {
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className={cn(
          'inline-flex h-11 w-11 items-center justify-center rounded-full border border-border bg-background text-foreground transition-colors',
          'hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          disabled && 'cursor-not-allowed opacity-40 hover:bg-background hover:text-foreground',
          active && 'border-foreground bg-foreground text-background hover:bg-foreground hover:text-background',
        )}
      >
        {children}
      </button>
      <span className="pointer-events-none absolute left-1/2 top-full z-10 mt-2 -translate-x-1/2 rounded-full border border-border bg-popover px-3 py-1 text-xs text-popover-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {label}
      </span>
    </div>
  );
}

export default function ReelsCreator() {
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const exportCanvasRef = useRef<HTMLCanvasElement>(null);
  const imageObjectUrlRef = useRef<string | null>(null);
  const videoObjectUrlRef = useRef<string | null>(null);
  const [imageUrl, setImageUrl] = useState('');
  const [imageName, setImageName] = useState('');
  const [text, setText] = useState(DEFAULT_TEXT);
  const [selectedFontIds, setSelectedFontIds] = useState<string[]>(['inter', 'space-grotesk', 'playfair']);
  const [changeIntervalSeconds, setChangeIntervalSeconds] = useState(0.8);
  const [isDragActive, setIsDragActive] = useState(false);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(true);
  const [currentFontIndex, setCurrentFontIndex] = useState(0);
  const [exportedVideoUrl, setExportedVideoUrl] = useState('');
  const [exportProgressSeconds, setExportProgressSeconds] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

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
    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      setErrorMessage('Upload a JPG, PNG, or another image file.');
      return;
    }

    setErrorMessage('');
    setImageName(file.name);
    clearRenderedVideo();
    setImageObjectUrl(URL.createObjectURL(file));
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
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
    setImageName('');
    setText(DEFAULT_TEXT);
    setSelectedFontIds(['inter', 'space-grotesk', 'playfair']);
    setChangeIntervalSeconds(0.8);
    setIsPreviewPlaying(true);
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

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(320px,420px)_minmax(0,1fr)] xl:items-start">
      <div className="space-y-4 xl:sticky xl:top-8">
        <div className="flex items-center justify-between rounded-3xl border border-border bg-card px-4 py-3 shadow-sm">
          <div>
            <p className="text-sm font-medium text-card-foreground">Preview</p>
            <p className="text-xs text-muted-foreground">Edit the headline directly on the image.</p>
          </div>

          <div className="flex items-center gap-2">
            <ActionButton label="Upload image" onClick={() => fileInputRef.current?.click()}>
              <ImagePlus className="h-4 w-4" />
            </ActionButton>
            <ActionButton
              active={isPreviewPlaying}
              label={isPreviewPlaying ? 'Pause preview' : 'Play preview'}
              onClick={() => setIsPreviewPlaying((isPlaying) => !isPlaying)}
            >
              {isPreviewPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </ActionButton>
            <ActionButton disabled={!canExport} label="Generate font cycle" onClick={handleExport}>
              <Sparkles className="h-4 w-4" />
            </ActionButton>
            <ActionButton label="Reset creator" onClick={resetCreator}>
              <RotateCcw className="h-4 w-4" />
            </ActionButton>
          </div>
        </div>

        <div className="rounded-[2rem] border border-border bg-card p-3 shadow-sm">
          <div className="relative mx-auto aspect-[9/16] w-full max-w-[360px] overflow-hidden rounded-[2rem] border border-border bg-muted">
            {imageUrl ? (
              <img alt="Uploaded background preview" className="h-full w-full object-cover" src={imageUrl} />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(24,24,27,0.08),_transparent_55%),linear-gradient(180deg,_rgba(24,24,27,0.08),_rgba(24,24,27,0.02))] px-8 text-center text-sm text-muted-foreground">
                Drop an image here to build the font cycle.
              </div>
            )}

            <div className="absolute inset-0 bg-gradient-to-b from-black/45 via-black/10 to-transparent" />

            <textarea
              aria-label="Overlay text"
              className="absolute left-1/2 top-[12%] h-[24%] w-[82%] -translate-x-1/2 resize-none border-none bg-transparent px-2 py-3 text-center text-2xl font-bold leading-tight text-white outline-none placeholder:text-white/60 md:text-[2rem]"
              maxLength={220}
              onChange={(event) => setText(event.target.value)}
              placeholder="Type directly on the image"
              spellCheck={false}
              style={{
                fontFamily: previewFont.cssFamily,
                textShadow: '0 10px 28px rgba(0, 0, 0, 0.35)',
              }}
              value={text}
            />

            <div className="absolute bottom-4 left-4 flex items-center gap-2 rounded-full border border-white/20 bg-black/20 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-white/90 backdrop-blur-sm">
              <span>{previewFont.label}</span>
            </div>

            <div className="absolute bottom-4 right-4 rounded-full border border-white/20 bg-black/20 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-white/90 backdrop-blur-sm">
              {text.length}/220
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 rounded-3xl border border-border bg-card p-4 text-center shadow-sm">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Length</p>
            <p className="mt-2 text-lg font-semibold text-card-foreground">60s</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Switch</p>
            <p className="mt-2 text-lg font-semibold text-card-foreground">{changeIntervalSeconds.toFixed(1)}s</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Fonts</p>
            <p className="mt-2 text-lg font-semibold text-card-foreground">{activeFonts.length}</p>
          </div>
        </div>

        {exportedVideoUrl ? (
          <div className="rounded-3xl border border-border bg-card p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-card-foreground">Rendered video</p>
                <p className="text-xs text-muted-foreground">Ready to preview or download.</p>
              </div>

              <a
                className="group relative inline-flex h-11 w-11 items-center justify-center rounded-full border border-border bg-background text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                download="font-cycle.webm"
                href={exportedVideoUrl}
              >
                <Download className="h-4 w-4" />
                <span className="pointer-events-none absolute left-1/2 top-full z-10 mt-2 -translate-x-1/2 rounded-full border border-border bg-popover px-3 py-1 text-xs text-popover-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                  Download video
                </span>
              </a>
            </div>

            <video className="aspect-[9/16] w-full rounded-[1.5rem] border border-border bg-black object-cover" controls loop src={exportedVideoUrl} />
          </div>
        ) : null}
      </div>

      <div className="space-y-6">
        <section className="rounded-[2rem] border border-border bg-card p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-3">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <ImagePlus className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-card-foreground">Background image</h2>
              <p className="text-sm text-muted-foreground">Drag, drop, or click to upload the still image.</p>
            </div>
          </div>

          <label
            htmlFor={fileInputId}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            className={cn(
              'flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-[1.5rem] border border-dashed px-6 py-8 text-center transition-colors',
              isDragActive
                ? 'border-foreground bg-accent text-accent-foreground'
                : 'border-border bg-muted/40 hover:bg-muted',
            )}
          >
            <input
              accept="image/*"
              className="sr-only"
              id={fileInputId}
              onChange={handleFileChange}
              ref={fileInputRef}
              type="file"
            />
            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full border border-border bg-background">
              <ImagePlus className="h-5 w-5" />
            </div>
            <p className="text-base font-medium text-card-foreground">
              {imageName || 'Drop a portrait image or tap to browse'}
            </p>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">
              A tall image works best because the export renders in a 9:16 vertical format.
            </p>
          </label>
        </section>

        <section className="rounded-[2rem] border border-border bg-card p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-3">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <Check className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-card-foreground">Font set</h2>
              <p className="text-sm text-muted-foreground">Pick the fonts to cycle through during the 60 second render.</p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {FONT_OPTIONS.map((font) => {
              const isSelected = selectedFontIds.includes(font.id);

              return (
                <button
                  key={font.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => toggleFont(font.id)}
                  className={cn(
                    'flex items-center justify-between rounded-[1.5rem] border px-4 py-4 text-left transition-colors',
                    isSelected
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border bg-background hover:bg-accent hover:text-accent-foreground',
                  )}
                >
                  <div>
                    <p className="text-lg font-semibold" style={{ fontFamily: font.cssFamily }}>
                      {font.label}
                    </p>
                    <p className={cn('text-sm', isSelected ? 'text-background/70' : 'text-muted-foreground')}>
                      Included in the font rotation.
                    </p>
                  </div>
                  <span
                    className={cn(
                      'inline-flex h-8 w-8 items-center justify-center rounded-full border',
                      isSelected ? 'border-background/20 bg-background/10' : 'border-border bg-muted',
                    )}
                  >
                    <Check className="h-4 w-4" />
                  </span>
                </button>
              );
            })}
          </div>

          <p className="mt-3 text-xs text-muted-foreground">
            The font cycle follows the order you choose the fonts.
          </p>
        </section>

        <section className="rounded-[2rem] border border-border bg-card p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-3">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <Clock3 className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-card-foreground">Timing</h2>
              <p className="text-sm text-muted-foreground">Set how often the font changes while the text stays in place.</p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_120px] md:items-center">
            <input
              className="w-full accent-foreground"
              max={2}
              min={0.1}
              onChange={(event) => setChangeIntervalSeconds(clampInterval(Number(event.target.value)))}
              step={0.1}
              type="range"
              value={changeIntervalSeconds}
            />
            <div className="rounded-[1.25rem] border border-input bg-background px-4 py-3 text-center">
              <span className="text-2xl font-semibold text-foreground">{changeIntervalSeconds.toFixed(1)}</span>
              <span className="ml-1 text-sm text-muted-foreground">sec</span>
            </div>
          </div>

          <div className="mt-4 grid gap-3 text-sm text-muted-foreground md:grid-cols-2">
            <p>Preview switches every {changeIntervalSeconds.toFixed(1)} seconds.</p>
            <p>Keep the tab visible while exporting. Rendering runs in real time for the full minute.</p>
          </div>
        </section>

        <section className="rounded-[2rem] border border-border bg-card p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-card-foreground">Export</h2>
              <p className="text-sm text-muted-foreground">Creates a 60 second WebM video directly in the browser.</p>
            </div>

            <button
              type="button"
              className={cn(
                'inline-flex items-center justify-center rounded-full px-5 py-3 text-sm font-medium transition-colors',
                canExport
                  ? 'bg-foreground text-background hover:bg-foreground/90'
                  : 'cursor-not-allowed bg-muted text-muted-foreground',
              )}
              disabled={!canExport}
              onClick={handleExport}
            >
              {isExporting ? `Rendering ${exportProgressSeconds}s / 60s` : 'Generate font cycle'}
            </button>
          </div>

          {errorMessage ? <p className="mt-4 text-sm text-destructive">{errorMessage}</p> : null}
          {!errorMessage ? (
            <p className="mt-4 text-sm text-muted-foreground">
              Upload an image, add your text, choose at least one font, then export.
            </p>
          ) : null}
        </section>
      </div>

      <canvas aria-hidden="true" className="hidden" ref={exportCanvasRef} />
    </div>
  );
}
