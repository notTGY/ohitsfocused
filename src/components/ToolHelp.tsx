import type { ReactNode } from 'react';
import { Popover } from 'radix-ui';
import { Button } from '@/components/ui/button';

export default function ToolHelp({ children }: { children: ReactNode }) {
  return <Popover.Root>
    <Popover.Trigger asChild><Button variant="ghost" className="size-11 shrink-0 rounded-full text-muted-foreground" aria-label="Help">?</Button></Popover.Trigger>
    <Popover.Portal><Popover.Content sideOffset={8} collisionPadding={16} align="end" aria-label="Tool help" className="z-50 w-72 max-w-[calc(100vw-2rem)] rounded-lg border bg-popover p-4 text-sm leading-6 text-popover-foreground shadow-md outline-none">
      {children}
      <Popover.Close asChild><Button variant="ghost" className="mt-2 w-full">Got it</Button></Popover.Close>
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}
