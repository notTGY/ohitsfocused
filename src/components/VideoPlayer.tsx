import { useState, useRef } from 'react';

interface VideoPlayerProps {
  srcWebm: string;
  srcMp4: string;
  poster?: string;
}

export default function VideoPlayer({ srcWebm, srcMp4, poster }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showControls, setShowControls] = useState(false);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      video.play();
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
  };

  return (
    <div
      className="relative group rounded-2xl overflow-hidden shadow-lg bg-muted mx-auto"
      style={{ maxWidth: '320px', maxHeight: '70vh' }}
      onMouseEnter={() => setShowControls(true)}
      onMouseLeave={() => {
        if (isPlaying) setShowControls(false);
      }}
    >
      <video
        ref={videoRef}
        className="w-full h-auto object-contain"
        style={{ maxHeight: '70vh' }}
        loop
        playsInline
        poster={poster}
        onClick={togglePlay}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
      >
        <source src={srcWebm} type="video/webm" />
        <source src={srcMp4} type="video/mp4" />
      </video>

      <button
        onClick={togglePlay}
        className={`
          absolute inset-0 flex items-center justify-center 
          bg-black/30 rounded-lg cursor-pointer
          transition-opacity duration-300
          ${showControls || !isPlaying ? 'opacity-100' : 'opacity-0'}
        `}
        aria-label={isPlaying ? 'Pause video' : 'Play video'}
      >
        <div className={`
          w-16 h-16 bg-white dark:bg-neutral-800 rounded-full flex items-center justify-center shadow-lg
          ${isPlaying ? 'hidden' : 'flex'}
        `}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="w-8 h-8 ml-1 text-neutral-900 dark:text-white"
          >
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
        </div>
        <div className={`
          w-16 h-16 bg-white dark:bg-neutral-800 rounded-full items-center justify-center shadow-lg
          ${isPlaying ? 'flex' : 'hidden'}
        `}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="w-8 h-8 text-neutral-900 dark:text-white"
          >
            <rect x="6" y="4" width="4" height="16" />
            <rect x="14" y="4" width="4" height="16" />
          </svg>
        </div>
      </button>
    </div>
  );
}
