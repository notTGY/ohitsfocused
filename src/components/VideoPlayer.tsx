import { useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface VideoPlayerProps { srcWebm: string; srcMp4: string; poster?: string; }

export default function VideoPlayer({ srcWebm, srcMp4, poster }: VideoPlayerProps) {
  const video = useRef<HTMLVideoElement>(null), [playing, setPlaying] = useState(false), [error, setError] = useState('');
  return <div className="mx-auto w-full max-w-80">
    <div className="relative overflow-hidden rounded-2xl bg-black">
      <video ref={video} controls loop playsInline preload="metadata" poster={poster} width={480} height={854} aria-label="Oh it's focused reel" className="max-h-[70svh] w-full object-contain" onPlay={() => { setPlaying(true); setError(''); }} onPause={() => setPlaying(false)} onError={() => setError('This browser could not play the reel. You can read it beside the video.')}>
        <source src={srcWebm} type="video/webm" /><source src={srcMp4} type="video/mp4" />
      </video>
      {!playing && <Button size="icon" variant="secondary" aria-label="Play reel" className="absolute top-1/2 left-1/2 size-16 -translate-x-1/2 -translate-y-1/2 rounded-full bg-background/90" onClick={() => { void video.current?.play().catch(() => setError('Use the video controls to start the reel.')); }}><Play className="size-7 fill-current" /></Button>}
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-muted-foreground">{error}</p>}
  </div>;
}
