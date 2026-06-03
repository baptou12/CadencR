import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { CheckIcon, CopyIcon, InfoIcon, TerminalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ProviderIcon } from "@/lib/provider-icons";
import { getProviderMetadata, PROVIDER_IDS } from "@/lib/providers";
import { buildResumeCommand } from "@/lib/provider-resume-command";
import { useClaudeCodeProfiles } from "@/api/agentRuntime";
import { cn } from "@/lib/utils";
import type { McpServerStatus } from "@/stores/ws-session-types";

interface SessionInfoChipProps {
  runtimeProvider: string | undefined;
  runtimeSessionId: string;
  projectPath: string | undefined;
  isRunning: boolean;
  onPause: () => void;
  chipClass: string;
}

const COPY_FEEDBACK_MS = 1500;
const McpServersContext = createContext<McpServerStatus[] | null>(null);

export function SessionInfoMcpServersProvider({
  mcpServers,
  children,
}: {
  mcpServers: McpServerStatus[] | null;
  children: ReactNode;
}): ReactElement {
  return <McpServersContext.Provider value={mcpServers}>{children}</McpServersContext.Provider>;
}

export function SessionInfoChip({
  runtimeProvider,
  runtimeSessionId,
  projectPath,
  isRunning,
  onPause,
  chipClass,
}: SessionInfoChipProps): ReactElement {
  const [copiedField, setCopiedField] = useState<"id" | "command" | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const mcpServers = useContext(McpServersContext);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    };
  }, []);

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
        <SessionInfoContent
          runtimeProvider={runtimeProvider}
          runtimeSessionId={runtimeSessionId}
          mcpServers={mcpServers}
          copiedField={copiedField}
          resumeSupported={resume.supported}
          isRunning={isRunning}
          onCopySessionId={copySessionId}
          onCopyLaunchCommand={copyLaunchCommand}
        />
      </PopoverContent>
    </Popover>
  );
}

interface SessionInfoContentProps {
  runtimeProvider: string | undefined;
  runtimeSessionId: string;
  mcpServers: McpServerStatus[] | null;
  copiedField: "id" | "command" | null;
  resumeSupported: boolean;
  isRunning: boolean;
  onCopySessionId: () => Promise<void>;
  onCopyLaunchCommand: () => Promise<void>;
}

function SessionInfoContent({
  runtimeProvider,
  runtimeSessionId,
  mcpServers,
  copiedField,
  resumeSupported,
  isRunning,
  onCopySessionId,
  onCopyLaunchCommand,
}: SessionInfoContentProps): ReactElement {
  const providerMeta = getProviderMetadata(runtimeProvider);
  return (
    <>
      <ProviderRow providerId={runtimeProvider} providerLabel={providerMeta?.label} />
      <McpServersRow servers={mcpServers} />
      {runtimeProvider === PROVIDER_IDS.CLAUDE_CODE && <ProfileRow />}
      <SessionIdRow
        runtimeSessionId={runtimeSessionId}
        copied={copiedField === "id"}
        onCopy={onCopySessionId}
      />
      <LaunchCommandRow
        copied={copiedField === "command"}
        supported={resumeSupported}
        isRunning={isRunning}
        onCopy={onCopyLaunchCommand}
      />
    </>
  );
}

function SessionIdRow({
  runtimeSessionId,
  copied,
  onCopy,
}: {
  runtimeSessionId: string;
  copied: boolean;
  onCopy: () => Promise<void>;
}): ReactElement {
  return (
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
          onClick={onCopy}
          title="Copy session ID"
          aria-label="Copy session ID"
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </Button>
      </div>
    </div>
  );
}

function LaunchCommandRow({
  copied,
  supported,
  isRunning,
  onCopy,
}: {
  copied: boolean;
  supported: boolean;
  isRunning: boolean;
  onCopy: () => Promise<void>;
}): ReactElement {
  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        onClick={onCopy}
        disabled={!supported}
      >
        {copied ? <CheckIcon /> : <TerminalIcon />}
        {copied ? "Copied" : "Copy launch command"}
      </Button>
      {!supported && (
        <p className="text-[11px] text-muted-foreground">Not supported for this provider.</p>
      )}
      {supported && isRunning && (
        <p className="text-[11px] text-muted-foreground">Copying will pause the running agent.</p>
      )}
    </div>
  );
}

interface ProviderRowProps {
  providerId: string | undefined;
  providerLabel: string | undefined;
}

function ProviderRow({ providerId, providerLabel }: ProviderRowProps): ReactElement | null {
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

interface McpServersRowProps {
  servers: McpServerStatus[] | null;
}

function McpServersRow({ servers }: McpServersRowProps): ReactElement {
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-medium text-muted-foreground">MCP servers</div>
      {servers === null && (
        <p className="text-[11px] text-muted-foreground">MCPs not reported yet</p>
      )}
      {servers !== null && servers.length === 0 && (
        <p className="text-[11px] text-muted-foreground">No MCP servers reported</p>
      )}
      {servers !== null && servers.length > 0 && (
        <div className="space-y-1">
          {servers.map((server) => (
            <McpServerRow key={server.name} server={server} />
          ))}
        </div>
      )}
    </div>
  );
}

function McpServerRow({ server }: { server: McpServerStatus }): ReactElement {
  return (
    <div className="flex items-center justify-between gap-2 rounded bg-muted/40 px-2 py-1">
      <span className="truncate font-mono text-[11px]">{server.name}</span>
      <span
        className={cn(
          "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize",
          mcpStatusClass(server.status),
        )}
      >
        {server.status}
      </span>
    </div>
  );
}

function mcpStatusClass(status: string): string {
  switch (status.toLowerCase()) {
    case "connected":
    case "ready":
      return "bg-[color:var(--acc-green)]/15 text-[color:var(--acc-green)]";
    case "unavailable":
    case "failed":
    case "error":
      return "bg-destructive/15 text-destructive";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function ProfileRow(): ReactElement {
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
