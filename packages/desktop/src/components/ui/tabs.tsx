import * as React from "react";
import { Tabs as TabsPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

/**
 * shadcn-flavoured Tabs (line variant).
 *
 * The line variant comes from a bottom-border on the list and a 2px primary
 * border on the active trigger — see https://ui.shadcn.com/docs/components/radix/tabs.
 * Consumers can still override className on every part to tweak spacing.
 */
function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root data-slot="tabs" className={cn("flex flex-col", className)} {...props} />
  );
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "inline-flex h-9 w-full items-stretch justify-start gap-1 border-b border-border bg-transparent p-0 text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        // Line variant: an always-rendered ::after sits at the very bottom of
        // the trigger, overlapping the strip's 1px gray border. It's
        // transparent by default and turns primary on active — yielding a
        // stable, full-width underline that doesn't depend on overflow or
        // negative-margin tricks (which were causing the "blink" before).
        "relative inline-flex items-center justify-center gap-1.5 whitespace-nowrap px-3 py-2 text-xs font-medium text-muted-foreground ring-offset-background transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-[3px] after:bg-transparent after:content-[''] data-[state=active]:after:bg-primary",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn(
        "min-h-0 flex-1 outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
