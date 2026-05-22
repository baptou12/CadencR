/**
 * Inline error message rendered in the agent conversation stream.
 *
 * Surfaces backend `session.error` envelopes (any provider) as a distinct
 * block — separate from plain text + `isError` flag — so the user can clearly
 * tell apart a real error from agent output. Provider-neutral: every error
 * that flows through the conversation goes through this component.
 */
import { memo } from "react";
import { AlertTriangleIcon } from "lucide-react";
import { CopyButton } from "@/components/CopyButton";

interface ErrorBlockProps {
  content: string;
  /** Optional machine-readable code from the backend (e.g. "SDK_ERROR"). */
  code?: string;
}

export const ErrorBlock = memo(function ErrorBlock({ content, code }: ErrorBlockProps) {
  return (
    <div
      role="alert"
      className="my-1 flex gap-2 rounded-md border border-[var(--acc-red)]/40 bg-[var(--acc-red)]/10 px-3 py-2 text-xs"
    >
      <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0 text-[var(--acc-red)]" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-[var(--acc-red)]">Error</span>
          {code && (
            <span className="rounded bg-[var(--acc-red)]/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[var(--acc-red)]/90">
              {code}
            </span>
          )}
        </div>
        <p className="mt-1 whitespace-pre-wrap break-words text-foreground/90">{content}</p>
      </div>
      <CopyButton text={content} label="Copy error" className="h-fit self-start p-1" />
    </div>
  );
});
