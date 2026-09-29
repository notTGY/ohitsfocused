import ToolHelp from '@/components/ToolHelp';
import { Button } from '@/components/ui/button';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  Download,
  Pause,
  Play,
  Upload,
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
  const [showFrames, setShowFrames] = useState(false);
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
    if (!file || isExporting) {
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
    setShowFrames(false);
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
    setShowFrames(false);
    setMetadata(null);
    setCrops([null, null]);
    setDrawIndex(null);
    setCurrentTime(0);
    setIsPlaying(false);
    setErrorMessage('');
  }

  function defaultCrops(aspect = videoAspect): CropPair {
    return [0.3, 0.7].map(x => fitCropToRatio({ x: x - 0.15, y: 0.2, width: 0.3, height: 0.6 }, TOTAL_CROP_RATIO / 2, aspect)) as CropPair;
  }

  function resetCrops() {
    setNextCrops(defaultCrops());
    setDrawIndex(null);
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
      <section className="mx-auto flex min-h-[65svh] max-w-lg flex-col justify-center">
        <label
          htmlFor={fileInputId}
          className={cn(
            'flex min-h-72 cursor-pointer focus-within:ring-2 focus-within:ring-ring flex-col items-center justify-center rounded-lg border border-dashed px-6 py-12 text-center transition-colors',
            isDragActive
              ? 'border-foreground bg-accent text-accent-foreground'
              : 'border-border hover:bg-muted/30',
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
          <Upload className="mb-4 size-6 text-muted-foreground" />
          <span className="font-medium">Choose a video</span>
          <p className="mt-4 max-w-xs text-sm leading-6 text-muted-foreground">Pick two frames from a wide video. Stack them into a vertical edit.</p>
          <span className="mt-4 text-xs text-muted-foreground">or drop it here</span>
          {errorMessage ? <p className="mt-5 text-sm text-destructive">{errorMessage}</p> : null}
        </label>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <input ref={fileInputRef} id={fileInputId} className="hidden" type="file" accept="video/*" onChange={handleFileChange} disabled={isExporting} />
      <div role="toolbar" aria-label="Video controls" className="flex flex-wrap items-center gap-1">
        <Button variant="ghost" disabled={isExporting} onClick={() => fileInputRef.current?.click()}>Replace</Button>
        <Button variant="ghost" disabled={isExporting} aria-expanded={showFrames} aria-controls="frame-options" onClick={() => setShowFrames(!showFrames)}>Frames</Button>
        <div className="ml-auto flex items-center gap-1">
          <ToolHelp><p>Move the two boxes to frame your subjects. Drag a corner to resize. The vertical preview follows along.</p><p className="mt-2">Keyboard: Tab to a frame, arrow keys to move, + / − to resize. Shift moves faster. Reset frames restores both boxes.</p><p className="mt-2">720 × 1280, with audio. Export takes as long as the video; keep this tab visible. Your video stays on this device.</p><Button variant="ghost" className="mt-2 w-full" disabled={isExporting} onClick={resetTool}>Start over</Button></ToolHelp>
          {renderedUrl ? <Button asChild><a href={renderedUrl} download={downloadName}><Download />Save video</a></Button> : <Button disabled={!canExport} onClick={handleExport}>{isExporting ? `Exporting ${formatTime(exportProgress)}` : 'Export'}</Button>}
        </div>
      </div>
      {showFrames && <div id="frame-options" className="flex flex-wrap gap-2 border-y border-border py-3">
        <Button variant="ghost" disabled={isExporting} onClick={resetCrops}>Reset frames</Button>
        {crops.map((crop, index) => <Button key={index} variant="ghost" disabled={isExporting || (index === 1 && !crops[0])} onClick={() => {
          const next = cloneCrops(crops);
          next[index] = null;
          setNextCrops(next);
          setSelectedIndex(index as 0 | 1);
          setDrawIndex(index as 0 | 1);
        }}>Redraw {index === 0 ? 'top' : 'bottom'}</Button>)}
      </div>}
      <div className="grid items-start gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,280px)]">
        <section aria-label="Source video" className="min-w-0">
          <div
            className="relative overflow-hidden rounded-lg border border-border bg-black shadow-inner"
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
                setNextCrops(defaultCrops(video.videoWidth / video.videoHeight));
                setDrawIndex(null);
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
                    aria-label={`Frame ${cropIndex + 1}. Arrow keys move; plus and minus resize.`}
                    onKeyDown={(event) => {
                      if (isExporting || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-'].includes(event.key)) return;
                      event.preventDefault();
                      const next = cloneCrops(crops), step = event.shiftKey ? 0.05 : 0.01;
                      if (event.key.startsWith('Arrow')) {
                        next[cropIndex] = { ...crop,
                          x: clamp(crop.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0), 0, 1 - crop.width),
                          y: clamp(crop.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0), 0, 1 - crop.height) };
                      } else {
                        const scale = event.key === '-' ? 0.95 : 1.05;
                        const ratio = crop.height / crop.width;
                        const width = clamp(crop.width * scale, MIN_CROP_SIZE, Math.min(1, 1 / ratio));
                        const height = width * ratio;
                        next[cropIndex] = { x: clamp(crop.x + (crop.width - width) / 2, 0, 1 - width), y: clamp(crop.y + (crop.height - height) / 2, 0, 1 - height), width, height };
                      }
                      setSelectedIndex(cropIndex);
                      setNextCrops(next);
                    }}
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
                          'absolute h-6 w-6 rounded-full border-2 border-slate-950',
                          style.handle,
                          corner.includes('n') ? '-top-3' : '-bottom-3',
                          corner.includes('w') ? '-left-3' : '-right-3',
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
            <Button variant="outline"
              type="button"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background hover:bg-accent"
              aria-label={isPlaying ? 'Pause source video' : 'Play source video'}
              onClick={togglePlayback}
            >
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 fill-current" />}
            </Button>
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
        <section aria-label="Vertical result" className="mx-auto w-full max-w-[min(280px,45svh)]">
          <div className="relative aspect-[9/16] overflow-hidden rounded-lg bg-black">
            <canvas ref={previewCanvasRef} className={cn('h-full w-full', renderedUrl && 'hidden')} height={EXPORT_HEIGHT} width={EXPORT_WIDTH} />
            {renderedUrl ? <video aria-label="Exported vertical video" className="h-full w-full" controls playsInline src={renderedUrl} /> : !hasBothCrops && <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted-foreground">Draw both frames, or reset them.</p>}
          </div>
          {renderedUrl && <Button variant="ghost" className="mt-2 w-full" onClick={clearRenderedVideo}>Back to preview</Button>}
        </section>
      </div>
      {isExporting && <div role="status" className="space-y-2">
        <progress aria-label="Export progress" className="h-1 w-full accent-current" max={metadata?.duration || 1} value={exportProgress} />
        <p className="text-xs text-muted-foreground">Exporting. Keep this tab visible.</p>
      </div>}
      {errorMessage && <p role="alert" className="text-sm text-destructive">{errorMessage}</p>}
      <canvas ref={exportCanvasRef} className="hidden" aria-hidden="true" />
    </div>
  );
}
