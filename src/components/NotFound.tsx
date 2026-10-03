import VideoPlayer from '@/components/VideoPlayer';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return <main className="mx-auto flex min-h-svh max-w-5xl items-center px-6 py-10 md:py-12">
    <div className="grid w-full items-center gap-8 md:grid-cols-[minmax(0,320px)_1fr] md:gap-16">
      <VideoPlayer srcWebm="/ohitsfocused.webm" srcMp4="/ohitsfocused.mp4" poster="/demo/focused-poster.jpg" />
      <div className="space-y-6">
        <blockquote className="space-y-2 text-lg leading-7"><h1 className="font-normal text-muted-foreground">“How would you say your mental focus is?”</h1><p>“Oh, it's focused.”</p></blockquote>
        <Button asChild className="rounded-full px-5"><a href="/">Back to the tools</a></Button>
        <nav aria-label="Try a tool" className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
          {[['font-cycle', 'Font cycle'], ['horizontal-to-vertical', 'Horizontal to vertical'], ['transcribe-reels', 'Video to text'], ['moodboard', 'Moodboard']].map(([route, name]) => <a key={route} href={`/tools/${route}/`} className="inline-flex min-h-11 items-center underline-offset-4 hover:text-foreground hover:underline">{name}</a>)}
        </nav>
        <details className="max-w-md text-sm text-muted-foreground"><summary className="inline-flex min-h-11 items-center underline underline-offset-4">Read the reel</summary><p className="pt-2 leading-7">How would you say your mental focus is? Oh, it's focused. Look, I have trouble even mentioning, even saying to myself in my own head the number of years. I no more think of myself as being as old as I am than fly. I mean, it's just not… I haven't observed anything in terms of… There's not things I don't do now that I did before, whether it's physical or mental or anything else.</p></details>
      </div>
    </div>
  </main>;
}
