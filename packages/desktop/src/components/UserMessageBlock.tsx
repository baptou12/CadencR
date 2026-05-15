import { Markdown } from "@/components/Markdown";
import { cn } from "@/lib/utils";
import { parseUserMessageContent } from "@/types/agent-types";

interface UserMessageBlockProps {
  content: string;
  deliveryState?: "pending_agent";
}

export function UserMessageBlock({ content, deliveryState }: UserMessageBlockProps) {
  const { text: textContent, images } = parseUserMessageContent(content);
  const isPendingDelivery = deliveryState === "pending_agent";

  return (
    <div className="my-1 flex flex-col items-end">
      <div
        data-testid="user-message-bubble"
        data-prompt-delivery-state={deliveryState}
        className={cn(
          "max-w-[80%] rounded-md border px-3 py-1.5 text-sm",
          isPendingDelivery
            ? "border-amber-500/50 bg-amber-500/10"
            : "border-primary/30 bg-primary/10",
        )}
      >
        <Markdown content={textContent} className="user-message-markdown" />
        {images.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {images.map((img, i) => (
              <img
                key={i}
                src={`data:${img.mediaType};base64,${img.data}`}
                alt={`Attachment ${i + 1}`}
                className="max-h-48 max-w-full rounded border border-border"
              />
            ))}
          </div>
        )}
      </div>
      {isPendingDelivery && (
        <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10.5px]">
          <span
            className="size-1.5 animate-pulse rounded-full bg-amber-400/90"
            aria-hidden="true"
          />
          <span className="text-amber-300">Not received by agent yet…</span>
        </div>
      )}
    </div>
  );
}
