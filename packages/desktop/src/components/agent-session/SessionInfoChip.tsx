import { useEffect, useRef, useState } from "react";
import { CheckIcon, CopyIcon, InfoIcon, TerminalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ProviderIcon } from "@/lib/provider-icons";
import { getProviderMetadata, PROVIDER_IDS } from "@/lib/providers";
import { buildResumeCommand } from "@/lib/provider-resume-command";
import { useClaudeCodeProfiles } from "@/api/agentRuntime";
import { cn } from "@/lib/utils";

interface SessionInfoChipProps {
  runtimeProvider: string | undefined;
  runtimeSessionId: string;
  projectPath: string | undefined;
  isRunning: boolean;
  onPause: () => void;
  chipClass: string;
}

const COPY_FEEDBACK_MS = 1500;

export function SessionInfoChip({
  runtimeProvider,
  runtimeSessionId,
  projectPath,
  isRunning,
  onPause,
  chipClass,
}: SessionInfoChipProps) {
  const [copiedField, setCopiedField] = useState<"id" | "command" | null>(null);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    };
  }, []);

  const providerMeta = getProviderMetadata(runtimeProvider);
  const resume = buildResumeCommand({
    providerId: runtimeProvider,
    sessionId: runtimeSessionId,
    cwd: projectPath,
  });

  const copy = async (field: "id" | "command", text: string): Promise<void> => {
    await navigator.clipboard.writeText(text);
    setCopiedField(field);
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => {
      setCopiedField((current) => (current === field ? null : current));
      timeoutRef.current = null;
    }, COPY_FEEDBACK_MS);
  };

  const copySessionId = (): Promise<void> => copy("id", runtimeSessionId);

  const copyLaunchCommand = async (): Promise<void> => {
    if (!resume.supported) return;
    if (isRunning) onPause();
    await copy("command", resume.command);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Session info"
          className={cn(chipClass, "bg-muted/60 text-foreground/90 hover:bg-muted")}
        >
          <InfoIcon className="size-3" />
          Info
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="w-80 space-y-3">
        <ProviderRow providerId={runtimeProvider} providerLabel={providerMeta?.label} />

        {runtimeProvider === PROVIDER_IDS.CLAUDE_CODE && <ProfileRow />}

        <div className="space-y-1">
          <div className="text-[11px] font-medium text-muted-foreground">Session ID</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 select-all truncate rounded bg-muted/60 px-2 py-1 font-mono text-[11px]">
              {runtimeSessionId}
            </code>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={copySessionId}
              title="Copy session ID"
              aria-label="Copy session ID"
            >
              {copiedField === "id" ? <CheckIcon /> : <CopyIcon />}
            </Button>
          </div>
        </div>

        <div className="space-y-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full"
            onClick={copyLaunchCommand}
            disabled={!resume.supported}
          >
            {copiedField === "command" ? <CheckIcon /> : <TerminalIcon />}
            {copiedField === "command" ? "Copied" : "Copy launch command"}
          </Button>
          {!resume.supported && (
            <p className="text-[11px] text-muted-foreground">Not supported for this provider.</p>
          )}
          {resume.supported && isRunning && (
            <p className="text-[11px] text-muted-foreground">
              Copying will pause the running agent.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface ProviderRowProps {
  providerId: string | undefined;
  providerLabel: string | undefined;
}

function ProviderRow({ providerId, providerLabel }: ProviderRowProps) {
  if (!providerId) return null;
  return (
    <div className="flex items-center gap-2">
      <ProviderIcon
        providerId={providerId}
        alt={providerLabel ?? providerId}
        className="size-4 rounded-sm"
      />
      <span className="text-xs font-medium">{providerLabel ?? providerId}</span>
    </div>
  );
}

function ProfileRow() {
  const { data, isLoading, isError } = useClaudeCodeProfiles();

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] font-medium text-muted-foreground">Active profile</span>
      {isLoading && <span className="h-3 w-16 animate-pulse rounded bg-muted/60" />}
      {isError && <span className="text-[11px] text-destructive">Failed to load</span>}
      {!isLoading && !isError && data && (
        <span className="font-mono text-[11px]">{data.active}</span>
      )}
    </div>
  );
}
