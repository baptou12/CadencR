import { memo, useState, type ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AlertCircle, ArrowUp, Loader2, Pencil, X } from "lucide-react";
import type { QueuedPrompt } from "@/api/generated";
import { cn } from "@/lib/utils";
import { useComposerContext } from "./ComposerContext";
import { usePromptQueue, type PromptQueueApi } from "./usePromptQueue";

/**
 * Messages queued for after the agent's current turn, stacked on top of the
 * composer card. The server delivers the oldest one when the turn ends; until
 * then each can be sent right away (it steers the running turn), edited or
 * removed. A failed delivery stays here with its reason — nothing a user
 * queued is ever dropped silently.
 */
export const QueueRail = memo(function QueueRail(): ReactElement | null {
  const { sessionId, isRunning } = useComposerContext();
  const queue = usePromptQueue(sessionId);
  if (queue.items.length === 0) return null;
  return (
    <section
      aria-label="Queued messages"
      data-composer-queue
      className="mx-2 flex flex-col gap-1 rounded-t-lg border border-b-0 border-border/70 bg-muted/30 px-1.5 pt-1.5 pb-1.5"
    >
      <header className="flex items-center gap-2 px-1.5 text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground/80">Queued · {queue.items.length}</span>
        <span>
          {isRunning
            ? "Sends when the agent finishes this turn"
            : "Held: sends after the next turn, or send it now"}
        </span>
      </header>
      <ol className="flex flex-col gap-1">
        {queue.items.map((item, index) => (
          <QueueRow key={item.id} item={item} index={index} queue={queue} />
        ))}
      </ol>
    </section>
  );
});

function QueueRow({
  item,
  index,
  queue,
}: {
  item: QueuedPrompt;
  index: number;
  queue: PromptQueueApi;
}): ReactElement {
  const [editing, setEditing] = useState(false);
  const delivering = item.status === "delivering";
  const failed = item.status === "error";
  if (editing) {
    return <QueueRowEditor item={item} queue={queue} onDone={() => setEditing(false)} />;
  }
  return (
    <li
      className={cn(
        "group flex min-h-8 items-center gap-2 rounded-md bg-background/60 py-1 pr-1 pl-2 text-[13px]",
        failed && "ring-1 ring-destructive/40",
      )}
    >
      <span className="w-4 shrink-0 text-center font-mono text-[11px] text-muted-foreground">
        {delivering ? (
          <Loader2 className="mx-auto size-3 animate-spin" aria-label="Sending" />
        ) : (
          index + 1
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate" title={item.content}>
          {item.content}
        </span>
        {failed && (
          <span className="flex items-center gap-1 text-xs text-destructive">
            <AlertCircle className="size-3 shrink-0" />
            Not delivered: {item.error ?? "unknown error"}. Edit or send it again.
          </span>
        )}
      </span>
      {!delivering && (
        <span className="flex shrink-0 items-center gap-0.5 opacity-70 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <RowButton
            label="Send now"
            onClick={() => void queue.sendNow(item.id)}
            disabled={queue.busy}
          >
            <ArrowUp className="size-3.5" />
          </RowButton>
          <RowButton label="Edit" onClick={() => setEditing(true)}>
            <Pencil className="size-3.5" />
          </RowButton>
          <RowButton
            label="Remove"
            onClick={() => void queue.remove(item.id)}
            disabled={queue.busy}
          >
            <X className="size-3.5" />
          </RowButton>
        </span>
      )}
    </li>
  );
}

function QueueRowEditor({
  item,
  queue,
  onDone,
}: {
  item: QueuedPrompt;
  queue: PromptQueueApi;
  onDone: () => void;
}): ReactElement {
  const [value, setValue] = useState(item.content);
  const save = (): void => {
    const next = value.trim();
    if (!next) return;
    // A refusal is toasted by the hook; the editor stays open with the text.
    void queue.update(item.id, next).then((saved) => saved && onDone());
  };
  return (
    <li className="flex flex-col gap-1.5 rounded-md bg-background/80 p-1.5">
      <Textarea
        autoFocus
        aria-label="Edit queued message"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            save();
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onDone();
          }
        }}
        rows={Math.min(6, Math.max(2, value.split("\n").length))}
        className="min-h-0 resize-none px-2 py-1.5 text-[13px] shadow-none md:text-[13px]"
      />
      <span className="flex items-center justify-end gap-1.5 text-xs">
        <button
          type="button"
          className="composer-instrument text-muted-foreground"
          onClick={onDone}
        >
          Cancel
        </button>
        <button
          type="button"
          className="composer-instrument bg-primary/15 text-primary"
          onClick={save}
          disabled={queue.busy || value.trim().length === 0}
        >
          Save
        </button>
      </span>
    </li>
  );
}

function RowButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactElement;
}): ReactElement {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="size-7 text-muted-foreground"
    >
      {children}
    </Button>
  );
}
