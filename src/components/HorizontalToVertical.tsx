import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  Download,
  Film,
  Maximize2,
  Pause,
  Play,
  RotateCcw,
  Scissors,
  Upload,
  WandSparkles,
} from 'lucide-react';

import { cn } from '@/lib/utils';

const EXPORT_WIDTH = 720;
const EXPORT_HEIGHT = 1280;
const TOTAL_CROP_RATIO = EXPORT_HEIGHT / EXPORT_WIDTH;
const MIN_CROP_RATIO = 0.18;
const MIN_CROP_SIZE = 0.04;

interface Crop {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface VideoMetadata {
  duration: number;
  height: number;
  width: number;
}

type CropPair = [Crop | null, Crop | null];
type Corner = 'ne' | 'nw' | 'se' | 'sw';

interface Interaction {
  corner?: Corner;
  cropIndex: 0 | 1;
  mode: 'draw' | 'move' | 'resize';
  pointerId: number;
  startCrops: CropPair;
  startX: number;
  startY: number;
}

const FRAME_STYLES = [
  {
    border: 'border-cyan-400',
    button: 'bg-cyan-500 text-slate-950 hover:bg-cyan-400',
    fill: 'bg-cyan-400/10',
    handle: 'bg-cyan-300',
    label: 'bg-cyan-400 text-slate-950',
  },
  {
    border: 'border-amber-400',
    button: 'bg-amber-400 text-slate-950 hover:bg-amber-300',
    fill: 'bg-amber-400/10',
    handle: 'bg-amber-300',
    label: 'bg-amber-400 text-slate-950',
  },
] as const;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function cloneCrops(crops: CropPair): CropPair {
  return crops.map((crop) => (crop ? { ...crop } : null)) as CropPair;
}

function cropRatio(crop: Crop, videoAspect: number) {
  return (crop.height / crop.width) / videoAspect;
}

function fitCropToRatio(crop: Crop, ratio: number, videoAspect: number) {
  const normalizedRatio = ratio * videoAspect;
  const centerX = crop.x + crop.width / 2;
  const centerY = crop.y + crop.height / 2;
  const area = crop.width * crop.height;
  let width = Math.sqrt(area / normalizedRatio);
  let height = width * normalizedRatio;
  const maximumWidth = 2 * Math.min(centerX, 1 - centerX);
  const maximumHeight = 2 * Math.min(centerY, 1 - centerY);
  const scale = Math.min(1, maximumWidth / width, maximumHeight / height);

  width *= scale;
  height *= scale;

  return {
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height,
  };
}

function makeRatioCrop(
  crop: Crop,
  ratio: number,
  videoAspect: number,
  centerX = crop.x + crop.width / 2,
  centerY = crop.y + crop.height / 2,
) {
  return fitCropToRatio(
    {
      ...crop,
      x: clamp(centerX - crop.width / 2, 0, 1 - crop.width),
      y: clamp(centerY - crop.height / 2, 0, 1 - crop.height),
    },
    ratio,
    videoAspect,
  );
}

function drawVerticalFrame(
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  crops: CropPair,
) {
  const [topCrop, bottomCrop] = crops;
  const canvas = context.canvas;

  context.fillStyle = '#020617';
  context.fillRect(0, 0, canvas.width, canvas.height);

  if (!topCrop || !bottomCrop || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    return;
  }

  const topRatio = cropRatio(topCrop, video.videoWidth / video.videoHeight);
  const topHeight = clamp(canvas.width * topRatio, 1, canvas.height - 1);

  context.drawImage(
    video,
    topCrop.x * video.videoWidth,
    topCrop.y * video.videoHeight,
    topCrop.width * video.videoWidth,
    topCrop.height * video.videoHeight,
    0,
    0,
    canvas.width,
    topHeight,
  );
  context.drawImage(
    video,
    bottomCrop.x * video.videoWidth,
    bottomCrop.y * video.videoHeight,
    bottomCrop.width * video.videoWidth,
    bottomCrop.height * video.videoHeight,
    0,
    topHeight,
    canvas.width,
    canvas.height - topHeight,
  );
}

function getSupportedMimeType() {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4;codecs=h264,aac',
    'video/mp4',
  ];

  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? '';
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) {
    return '0:00';
  }

  const wholeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(wholeSeconds / 60);
  return `${minutes}:${String(wholeSeconds % 60).padStart(2, '0')}`;
}

function waitForVideo(video: HTMLVideoElement) {
  return new Promise<void>((resolve, reject) => {
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      resolve();
      return;
    }

    const handleReady = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error('The uploaded video could not be decoded for export.'));
    };
    const cleanup = () => {
      video.removeEventListener('loadeddata', handleReady);
      video.removeEventListener('error', handleError);
    };

    video.addEventListener('loadeddata', handleReady);
    video.addEventListener('error', handleError);
  });
}

interface ActionButtonProps {
  active?: boolean;
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}

function ActionButton({ active, children, disabled, label, onClick }: ActionButtonProps) {
  return (
    <div className="group relative">
      <button
        type="button"
        aria-label={label}
        className={cn(
          'inline-flex h-11 w-11 items-center justify-center rounded-full border border-border bg-background text-foreground transition-colors',
          'hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40',
          active && 'border-foreground bg-foreground text-background hover:bg-foreground/90',
        )}
        disabled={disabled}
        onClick={onClick}
      >
        {children}
      </button>
      <span className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 -translate-x-1/2 whitespace-nowrap rounded-full border border-border bg-popover px-3 py-1 text-xs text-popover-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {label}
      </span>
    </div>
  );
}

export default function HorizontalToVertical() {
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sourceVideoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const exportCanvasRef = useRef<HTMLCanvasElement>(null);
  const videoObjectUrlRef = useRef<string | null>(null);
  const renderedObjectUrlRef = useRef<string | null>(null);
  const interactionRef = useRef<Interaction | null>(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [videoName, setVideoName] = useState('');
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
  const [crops, setCrops] = useState<CropPair>([null, null]);
  const [drawIndex, setDrawIndex] = useState<0 | 1 | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<0 | 1>(0);
  const [isDragActive, setIsDragActive] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [renderedUrl, setRenderedUrl] = useState('');
  const [renderedMimeType, setRenderedMimeType] = useState('video/webm');
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');

  const videoAspect = metadata ? metadata.width / metadata.height : 16 / 9;
  const hasBothCrops = Boolean(crops[0] && crops[1]);
  const canExport = hasBothCrops && !isExporting;

  function clearRenderedVideo() {
    if (renderedObjectUrlRef.current) {
      URL.revokeObjectURL(renderedObjectUrlRef.current);
      renderedObjectUrlRef.current = null;
    }

    setRenderedUrl('');
    setExportProgress(0);
  }

  function setRenderedVideo(url: string, mimeType: string) {
    clearRenderedVideo();
    renderedObjectUrlRef.current = url;
    setRenderedUrl(url);
    setRenderedMimeType(mimeType);
  }

  function setNextCrops(nextCrops: CropPair) {
    clearRenderedVideo();
    setCrops(nextCrops);
  }

  function applyFile(file: File | null | undefined) {
    if (!file) {
      return;
    }

    if (!file.type.startsWith('video/')) {
      setErrorMessage('Upload a video file supported by your browser.');
      return;
    }

    if (videoObjectUrlRef.current) {
      URL.revokeObjectURL(videoObjectUrlRef.current);
    }

    const nextUrl = URL.createObjectURL(file);
    videoObjectUrlRef.current = nextUrl;
    clearRenderedVideo();
    setVideoUrl(nextUrl);
    setVideoName(file.name);
    setMetadata(null);
    setCrops([null, null]);
    setDrawIndex(0);
    setSelectedIndex(0);
    setCurrentTime(0);
    setIsPlaying(false);
    setErrorMessage('');
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

  function resetTool() {
    sourceVideoRef.current?.pause();

    if (videoObjectUrlRef.current) {
      URL.revokeObjectURL(videoObjectUrlRef.current);
      videoObjectUrlRef.current = null;
    }

    clearRenderedVideo();
    setVideoUrl('');
    setVideoName('');
    setMetadata(null);
    setCrops([null, null]);
    setDrawIndex(null);
    setCurrentTime(0);
    setIsPlaying(false);
    setErrorMessage('');
  }

  function resetCrops() {
    setNextCrops([null, null]);
    setDrawIndex(0);
    setSelectedIndex(0);
    setErrorMessage('');
  }

  function getPointerPosition(event: ReactPointerEvent<HTMLDivElement>) {
    const bounds = overlayRef.current?.getBoundingClientRect();

    if (!bounds) {
      return null;
    }

    return {
      x: clamp((event.clientX - bounds.left) / bounds.width, 0, 1),
      y: clamp((event.clientY - bounds.top) / bounds.height, 0, 1),
    };
  }

  function beginDraw(event: ReactPointerEvent<HTMLDivElement>) {
    if (drawIndex === null || !metadata || isExporting) {
      return;
    }

    const point = getPointerPosition(event);

    if (!point) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    interactionRef.current = {
      cropIndex: drawIndex,
      mode: 'draw',
      pointerId: event.pointerId,
      startCrops: cloneCrops(crops),
      startX: point.x,
      startY: point.y,
    };
  }

  function beginCropInteraction(
    event: ReactPointerEvent<HTMLDivElement>,
    cropIndex: 0 | 1,
    mode: 'move' | 'resize',
    corner?: Corner,
  ) {
    if (drawIndex !== null || isExporting) {
      return;
    }

    const point = getPointerPosition(event);

    if (!point) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    overlayRef.current?.setPointerCapture(event.pointerId);
    setSelectedIndex(cropIndex);
    interactionRef.current = {
      corner,
      cropIndex,
      mode,
      pointerId: event.pointerId,
      startCrops: cloneCrops(crops),
      startX: point.x,
      startY: point.y,
    };
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const interaction = interactionRef.current;

    if (!interaction || interaction.pointerId !== event.pointerId) {
      return;
    }

    const point = getPointerPosition(event);

    if (!point) {
      return;
    }

    const nextCrops = cloneCrops(interaction.startCrops);
    const cropIndex = interaction.cropIndex;
    const otherIndex = cropIndex === 0 ? 1 : 0;
    const startCrop = interaction.startCrops[cropIndex];

    if (interaction.mode === 'draw') {
      const minimumPointerSize = 0.002;
      const directionX = point.x < interaction.startX ? -1 : 1;
      const directionY = point.y < interaction.startY ? -1 : 1;
      let width = Math.max(Math.abs(point.x - interaction.startX), minimumPointerSize);
      let height = Math.max(Math.abs(point.y - interaction.startY), minimumPointerSize);
      const otherCrop = nextCrops[otherIndex];

      if (otherCrop) {
        const targetRatio = TOTAL_CROP_RATIO - cropRatio(otherCrop, videoAspect);
        const normalizedRatio = targetRatio * videoAspect;

        if (height / width > normalizedRatio) {
          width = height / normalizedRatio;
        } else {
          height = width * normalizedRatio;
        }
      }

      const maximumWidth = directionX > 0 ? 1 - interaction.startX : interaction.startX;
      const maximumHeight = directionY > 0 ? 1 - interaction.startY : interaction.startY;
      const scale = Math.min(1, maximumWidth / width, maximumHeight / height);
      width *= scale;
      height *= scale;

      nextCrops[cropIndex] = {
        x: directionX > 0 ? interaction.startX : interaction.startX - width,
        y: directionY > 0 ? interaction.startY : interaction.startY - height,
        width,
        height,
      };
    } else if (startCrop && interaction.mode === 'move') {
      const deltaX = point.x - interaction.startX;
      const deltaY = point.y - interaction.startY;
      nextCrops[cropIndex] = {
        ...startCrop,
        x: clamp(startCrop.x + deltaX, 0, 1 - startCrop.width),
        y: clamp(startCrop.y + deltaY, 0, 1 - startCrop.height),
      };
    } else if (startCrop && interaction.corner) {
      const deltaX = point.x - interaction.startX;
      const deltaY = point.y - interaction.startY;
      const movesWest = interaction.corner.endsWith('w');
      const movesNorth = interaction.corner.startsWith('n');
      const fixedX = movesWest ? startCrop.x + startCrop.width : startCrop.x;
      const fixedY = movesNorth ? startCrop.y + startCrop.height : startCrop.y;
      const movingX = clamp((movesWest ? startCrop.x : startCrop.x + startCrop.width) + deltaX, 0, 1);
      const movingY = clamp((movesNorth ? startCrop.y : startCrop.y + startCrop.height) + deltaY, 0, 1);
      const width = Math.max(Math.abs(fixedX - movingX), MIN_CROP_SIZE);
      const height = Math.max(Math.abs(fixedY - movingY), MIN_CROP_SIZE);
      let resizedCrop: Crop = {
        x: clamp(Math.min(fixedX, movingX), 0, 1 - MIN_CROP_SIZE),
        y: clamp(Math.min(fixedY, movingY), 0, 1 - MIN_CROP_SIZE),
        width: Math.min(width, 1 - Math.min(fixedX, movingX)),
        height: Math.min(height, 1 - Math.min(fixedY, movingY)),
      };
      const ratio = clamp(
        cropRatio(resizedCrop, videoAspect),
        MIN_CROP_RATIO,
        TOTAL_CROP_RATIO - MIN_CROP_RATIO,
      );

      resizedCrop = fitCropToRatio(resizedCrop, ratio, videoAspect);
      nextCrops[cropIndex] = resizedCrop;

      const otherCrop = nextCrops[otherIndex];

      if (otherCrop) {
        nextCrops[otherIndex] = makeRatioCrop(
          otherCrop,
          TOTAL_CROP_RATIO - ratio,
          videoAspect,
        );
      }
    }

    setNextCrops(nextCrops);
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const interaction = interactionRef.current;

    if (!interaction || interaction.pointerId !== event.pointerId) {
      return;
    }

    const crop = crops[interaction.cropIndex];

    if (interaction.mode === 'draw') {
      const isValidCrop = Boolean(
        crop && crop.width >= MIN_CROP_SIZE && crop.height >= MIN_CROP_SIZE,
      );
      const otherIndex = interaction.cropIndex === 0 ? 1 : 0;
      const otherCrop = crops[otherIndex];

      if (!isValidCrop) {
        const nextCrops = cloneCrops(crops);
        nextCrops[interaction.cropIndex] = null;
        setNextCrops(nextCrops);
      } else if (crop && !otherCrop) {
        const ratio = clamp(
          cropRatio(crop, videoAspect),
          MIN_CROP_RATIO,
          TOTAL_CROP_RATIO - MIN_CROP_RATIO,
        );
        const nextCrops = cloneCrops(crops);
        nextCrops[interaction.cropIndex] = fitCropToRatio(crop, ratio, videoAspect);
        setNextCrops(nextCrops);
      }

      if (!isValidCrop) {
        setDrawIndex(interaction.cropIndex);
      } else if (interaction.cropIndex === 0 && !otherCrop) {
        setDrawIndex(1);
        setSelectedIndex(1);
      } else {
        setDrawIndex(null);
        setSelectedIndex(interaction.cropIndex);
      }
    }

    if (overlayRef.current?.hasPointerCapture(event.pointerId)) {
      overlayRef.current.releasePointerCapture(event.pointerId);
    }

    interactionRef.current = null;
  }

  async function togglePlayback() {
    const video = sourceVideoRef.current;

    if (!video) {
      return;
    }

    if (video.paused) {
      try {
        await video.play();
      } catch {
        setErrorMessage('The browser blocked video playback. Try pressing play again.');
      }
    } else {
      video.pause();
    }
  }

  function seekVideo(nextTime: number) {
    const video = sourceVideoRef.current;

    if (!video) {
      return;
    }

    video.currentTime = nextTime;
    setCurrentTime(nextTime);
  }

  async function handleExport() {
    const completeCrops = crops as [Crop, Crop];

    if (!hasBothCrops || !videoUrl || !metadata) {
      setErrorMessage('Draw both crop frames before exporting.');
      return;
    }

    if (typeof MediaRecorder === 'undefined') {
      setErrorMessage('This browser does not support in-browser video export.');
      return;
    }

    const canvas = exportCanvasRef.current;

    if (!canvas || typeof canvas.captureStream !== 'function') {
      setErrorMessage('This browser cannot record a canvas video.');
      return;
    }

    let animationFrameId = 0;
    let canvasStream: MediaStream | null = null;
    let outputStream: MediaStream | null = null;
    let audioContext: AudioContext | null = null;
    let recorder: MediaRecorder | null = null;
    const exportVideo = document.createElement('video');

    clearRenderedVideo();
    setErrorMessage('');
    setIsExporting(true);

    try {
      exportVideo.src = videoUrl;
      exportVideo.preload = 'auto';
      exportVideo.playsInline = true;
      await waitForVideo(exportVideo);

      const context = canvas.getContext('2d');

      if (!context) {
        throw new Error('Could not create the export canvas.');
      }

      canvas.width = EXPORT_WIDTH;
      canvas.height = EXPORT_HEIGHT;
      drawVerticalFrame(context, exportVideo, completeCrops);

      canvasStream = canvas.captureStream(30);
      audioContext = new AudioContext();
      const audioSource = audioContext.createMediaElementSource(exportVideo);
      const audioDestination = audioContext.createMediaStreamDestination();
      audioSource.connect(audioDestination);

      outputStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...audioDestination.stream.getAudioTracks(),
      ]);

      const mimeType = getSupportedMimeType();
      recorder = mimeType
        ? new MediaRecorder(outputStream, { mimeType, videoBitsPerSecond: 8_000_000 })
        : new MediaRecorder(outputStream, { videoBitsPerSecond: 8_000_000 });
      const chunks: BlobPart[] = [];
      const recorderFinished = new Promise<void>((resolve, reject) => {
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            chunks.push(event.data);
          }
        };
        recorder.onerror = () => reject(new Error('The browser stopped the video recording.'));
        recorder.onstop = () => resolve();
      });

      const videoFinished = new Promise<void>((resolve, reject) => {
        exportVideo.onended = () => resolve();
        exportVideo.onerror = () => reject(new Error('The source video stopped during export.'));
      });

      await audioContext.resume();
      recorder.start(1000);
      await exportVideo.play();

      const renderFrame = () => {
        drawVerticalFrame(context, exportVideo, completeCrops);
        setExportProgress(exportVideo.currentTime);

        if (!exportVideo.ended) {
          animationFrameId = window.requestAnimationFrame(renderFrame);
        }
      };

      animationFrameId = window.requestAnimationFrame(renderFrame);
      await videoFinished;
      drawVerticalFrame(context, exportVideo, completeCrops);
      setExportProgress(metadata.duration);
      recorder.stop();
      await recorderFinished;

      const actualMimeType = recorder.mimeType || mimeType || 'video/webm';
      const blob = new Blob(chunks, { type: actualMimeType });
      setRenderedVideo(URL.createObjectURL(blob), actualMimeType);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not export the vertical video.';
      setErrorMessage(message);
    } finally {
      exportVideo.pause();
      exportVideo.removeAttribute('src');
      exportVideo.load();

      if (animationFrameId) {
        window.cancelAnimationFrame(animationFrameId);
      }

      if (recorder?.state === 'recording') {
        recorder.stop();
      }

      outputStream?.getTracks().forEach((track) => track.stop());
      canvasStream?.getTracks().forEach((track) => track.stop());

      if (audioContext) {
        await audioContext.close();
      }

      setIsExporting(false);
    }
  }

  useEffect(() => {
    const video = sourceVideoRef.current;
    const canvas = previewCanvasRef.current;

    if (!video || !canvas) {
      return;
    }

    const context = canvas.getContext('2d');

    if (!context) {
      return;
    }

    let animationFrameId = 0;
    const render = () => {
      drawVerticalFrame(context, video, crops);
      animationFrameId = window.requestAnimationFrame(render);
    };

    render();

    return () => window.cancelAnimationFrame(animationFrameId);
  }, [crops, videoUrl]);

  useEffect(() => {
    return () => {
      if (videoObjectUrlRef.current) {
        URL.revokeObjectURL(videoObjectUrlRef.current);
      }

      if (renderedObjectUrlRef.current) {
        URL.revokeObjectURL(renderedObjectUrlRef.current);
      }
    };
  }, []);

  const extension = renderedMimeType.includes('mp4') ? 'mp4' : 'webm';
  const downloadName = `${videoName.replace(/\.[^.]+$/, '') || 'video'}-vertical.${extension}`;

  if (!videoUrl) {
    return (
      <section className="mx-auto max-w-4xl rounded-[2rem] border border-border bg-card p-4 shadow-sm md:p-8">
        <label
          htmlFor={fileInputId}
          className={cn(
            'flex min-h-[420px] cursor-pointer flex-col items-center justify-center rounded-[1.5rem] border border-dashed px-6 py-12 text-center transition-colors',
            isDragActive
              ? 'border-foreground bg-accent text-accent-foreground'
              : 'border-border bg-muted/30 hover:bg-muted/60',
          )}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <input
            ref={fileInputRef}
            id={fileInputId}
            className="sr-only"
            type="file"
            accept="video/*"
            onChange={handleFileChange}
          />
          <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-background shadow-sm">
            <Upload className="h-7 w-7" />
          </div>
          <h2 className="text-2xl font-semibold text-card-foreground">Drop a horizontal video here</h2>
          <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
            Your video stays in the browser. Draw two crops for the speaker and the action, then export a reel-ready 9:16 edit.
          </p>
          <span className="mt-7 inline-flex rounded-full bg-foreground px-5 py-3 text-sm font-medium text-background">
            Choose video
          </span>
          {errorMessage ? <p className="mt-5 text-sm text-destructive">{errorMessage}</p> : null}
        </label>
      </section>
    );
  }

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(300px,380px)] xl:items-start">
      <div className="space-y-6">
        <section className="rounded-[2rem] border border-border bg-card p-4 shadow-sm md:p-6">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">Source video</p>
              <h2 className="mt-1 max-w-lg truncate text-lg font-semibold text-card-foreground">{videoName}</h2>
            </div>
            <div className="flex items-center gap-2">
              <ActionButton disabled={isExporting} label="Replace video" onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-4 w-4" />
              </ActionButton>
              <ActionButton disabled={isExporting} label="Start over" onClick={resetTool}>
                <RotateCcw className="h-4 w-4" />
              </ActionButton>
            </div>
            <input
              ref={fileInputRef}
              id={fileInputId}
              className="sr-only"
              type="file"
              accept="video/*"
              onChange={handleFileChange}
            />
          </div>

          <div
            className="relative overflow-hidden rounded-[1.5rem] border border-border bg-black shadow-inner"
            style={{ aspectRatio: metadata ? `${metadata.width} / ${metadata.height}` : '16 / 9' }}
          >
            <video
              ref={sourceVideoRef}
              className="block h-full w-full"
              playsInline
              preload="metadata"
              src={videoUrl}
              onEnded={() => setIsPlaying(false)}
              onLoadedMetadata={(event) => {
                const video = event.currentTarget;
                setMetadata({
                  duration: video.duration,
                  height: video.videoHeight,
                  width: video.videoWidth,
                });
              }}
              onPause={() => setIsPlaying(false)}
              onPlay={() => setIsPlaying(true)}
              onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
            />

            <div
              ref={overlayRef}
              className={cn(
                'absolute inset-0 touch-none select-none',
                drawIndex === null ? 'cursor-default' : 'cursor-crosshair',
                isExporting && 'pointer-events-none',
              )}
              onPointerDown={beginDraw}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            >
              {crops.map((crop, index) => {
                if (!crop) {
                  return null;
                }

                const cropIndex = index as 0 | 1;
                const style = FRAME_STYLES[cropIndex];
                const isSelected = drawIndex === null && selectedIndex === cropIndex;

                return (
                  <div
                    key={cropIndex}
                    role="button"
                    tabIndex={0}
                    aria-label={`Move frame ${cropIndex + 1}`}
                    className={cn(
                      'absolute border-2 shadow-[0_0_0_9999px_rgba(2,6,23,0.16)]',
                      style.border,
                      style.fill,
                      drawIndex === null && 'cursor-move',
                      isSelected && 'z-10 shadow-[0_0_0_1px_rgba(255,255,255,0.75),0_0_0_9999px_rgba(2,6,23,0.12)]',
                    )}
                    style={{
                      height: `${crop.height * 100}%`,
                      left: `${crop.x * 100}%`,
                      top: `${crop.y * 100}%`,
                      width: `${crop.width * 100}%`,
                    }}
                    onPointerDown={(event) => beginCropInteraction(event, cropIndex, 'move')}
                  >
                    <span className={cn('absolute left-0 top-0 px-2 py-1 text-[10px] font-bold uppercase tracking-wider', style.label)}>
                      {cropIndex === 0 ? '1 · Top' : '2 · Bottom'}
                    </span>
                    {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
                      <span
                        key={corner}
                        className={cn(
                          'absolute h-4 w-4 rounded-full border-2 border-slate-950 shadow-sm',
                          style.handle,
                          corner.includes('n') ? '-top-2' : '-bottom-2',
                          corner.includes('w') ? '-left-2' : '-right-2',
                          corner === 'nw' || corner === 'se' ? 'cursor-nwse-resize' : 'cursor-nesw-resize',
                        )}
                        onPointerDown={(event) => beginCropInteraction(event, cropIndex, 'resize', corner)}
                      />
                    ))}
                  </div>
                );
              })}

              {drawIndex !== null ? (
                <div className="pointer-events-none absolute inset-x-4 top-4 flex justify-center">
                  <p className="rounded-full border border-white/15 bg-slate-950/80 px-4 py-2 text-xs font-medium text-white shadow-lg backdrop-blur">
                    Drag to draw frame {drawIndex + 1}
                  </p>
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-background hover:bg-accent"
              aria-label={isPlaying ? 'Pause source video' : 'Play source video'}
              onClick={togglePlayback}
            >
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 fill-current" />}
            </button>
            <span className="w-11 text-right text-xs tabular-nums text-muted-foreground">{formatTime(currentTime)}</span>
            <input
              aria-label="Video position"
              className="min-w-0 flex-1 accent-foreground"
              max={metadata?.duration || 0}
              min={0}
              step={0.01}
              type="range"
              value={currentTime}
              onChange={(event) => seekVideo(Number(event.target.value))}
            />
            <span className="w-11 text-xs tabular-nums text-muted-foreground">{formatTime(metadata?.duration || 0)}</span>
          </div>
        </section>

        <section className="rounded-[2rem] border border-border bg-card p-5 shadow-sm md:p-6">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="max-w-xl">
              <div className="flex items-center gap-3">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                  <Scissors className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="font-semibold text-card-foreground">Crop frames</h2>
                  <p className="text-sm text-muted-foreground">Move a box or drag its corner to reframe.</p>
                </div>
              </div>
              <p className="mt-4 text-sm leading-6 text-muted-foreground">
                Resizing one frame automatically reshapes the other. Their aspect ratios always add up to 16:9, so the vertical result has no gaps or stretched pixels.
              </p>
            </div>

            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2.5 text-sm font-medium transition-colors hover:bg-accent"
              disabled={isExporting}
              onClick={resetCrops}
            >
              <RotateCcw className="h-4 w-4" />
              Redraw both
            </button>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {crops.map((crop, index) => {
              const cropIndex = index as 0 | 1;
              const ratio = crop ? cropRatio(crop, videoAspect) : null;
              const style = FRAME_STYLES[cropIndex];

              return (
                <button
                  key={cropIndex}
                  type="button"
                  disabled={isExporting || (cropIndex === 1 && !crops[0])}
                  className={cn(
                    'flex items-center justify-between rounded-[1.25rem] border border-border bg-background p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45',
                    selectedIndex === cropIndex && crop && 'border-foreground',
                  )}
                  onClick={() => {
                    const nextCrops = cloneCrops(crops);
                    nextCrops[cropIndex] = null;
                    setNextCrops(nextCrops);
                    setSelectedIndex(cropIndex);
                    setDrawIndex(cropIndex);
                  }}
                >
                  <span>
                    <span className="block text-sm font-semibold text-card-foreground">Frame {cropIndex + 1} · {cropIndex === 0 ? 'Top' : 'Bottom'}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {ratio ? `${ratio.toFixed(3)} height / width` : cropIndex === drawIndex ? 'Draw on the video' : 'Not drawn yet'}
                    </span>
                  </span>
                  <span className={cn('rounded-full px-3 py-1 text-xs font-semibold', style.button)}>
                    {crop ? 'Redraw' : 'Draw'}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      </div>

      <aside className="space-y-5 xl:sticky xl:top-8">
        <section className="rounded-[2rem] border border-border bg-card p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-4 px-1">
            <div>
              <p className="text-sm font-semibold text-card-foreground">Vertical preview</p>
              <p className="text-xs text-muted-foreground">720 × 1280 · 9:16</p>
            </div>
            <Maximize2 className="h-4 w-4 text-muted-foreground" />
          </div>

          <div className="relative mx-auto aspect-[9/16] w-full max-w-[320px] overflow-hidden rounded-[1.5rem] border border-border bg-slate-950">
            <canvas ref={previewCanvasRef} className="h-full w-full" height={EXPORT_HEIGHT} width={EXPORT_WIDTH} />
            {!hasBothCrops ? (
              <div className="absolute inset-0 flex items-center justify-center px-8 text-center text-sm leading-6 text-slate-400">
                Draw both frames to see the final composition.
              </div>
            ) : null}
          </div>
        </section>

        <section className="rounded-[2rem] border border-border bg-card p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <Film className="h-4 w-4" />
            </div>
            <div>
              <h2 className="font-semibold text-card-foreground">Export reel</h2>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">Keeps the source audio and renders locally in real time.</p>
            </div>
          </div>

          <button
            type="button"
            className={cn(
              'mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-medium transition-colors',
              canExport
                ? 'bg-foreground text-background hover:bg-foreground/90'
                : 'cursor-not-allowed bg-muted text-muted-foreground',
            )}
            disabled={!canExport}
            onClick={handleExport}
          >
            <WandSparkles className="h-4 w-4" />
            {isExporting
              ? `Rendering ${formatTime(exportProgress)} / ${formatTime(metadata?.duration || 0)}`
              : 'Generate vertical video'}
          </button>

          {isExporting && metadata ? (
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-foreground transition-[width]"
                style={{ width: `${clamp((exportProgress / metadata.duration) * 100, 0, 100)}%` }}
              />
            </div>
          ) : null}

          {errorMessage ? <p className="mt-4 text-sm text-destructive">{errorMessage}</p> : null}
          {!errorMessage ? (
            <p className="mt-4 text-xs leading-5 text-muted-foreground">Keep this tab visible until the export finishes.</p>
          ) : null}
        </section>

        {renderedUrl ? (
          <section className="rounded-[2rem] border border-border bg-card p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-4 px-1">
              <div>
                <p className="text-sm font-semibold text-card-foreground">Your reel is ready</p>
                <p className="text-xs text-muted-foreground">Preview or download the result.</p>
              </div>
              <a
                className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-foreground text-background transition-colors hover:bg-foreground/90"
                download={downloadName}
                href={renderedUrl}
                aria-label="Download vertical video"
              >
                <Download className="h-4 w-4" />
              </a>
            </div>
            <video className="aspect-[9/16] w-full rounded-[1.5rem] bg-black" controls playsInline src={renderedUrl} />
          </section>
        ) : null}
      </aside>

      <canvas ref={exportCanvasRef} className="hidden" aria-hidden="true" />
    </div>
  );
}
