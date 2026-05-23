/**
 * Settings → Editor → "Language servers". Lists every entry in the backend
 * LSP catalog with its current installation state.
 *
 * Read-only: we deliberately don't expose an "Install" button here. The
 * managed downloader runs the first time the user opens a file in a given
 * language, so this view's only job is to answer "what's installed and
 * where". A future iteration can add a manual install trigger if the
 * lazy install proves confusing.
 *
 * Provider-neutral: rows are rendered from the backend probe response,
 * never a hardcoded `["typescript", "rust", …]` list on the frontend.
 */
import { memo, useMemo } from "react";
import { CircleCheck, CircleSlash, Download, HardDrive, type LucideIcon } from "lucide-react";
import { useListLspServers, type ServerProbe, ServerProbeStatus } from "@/api/generated";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface StatusVisual {
  icon: LucideIcon;
  tone: string;
  label: string;
}

function visualFor(server: ServerProbe): StatusVisual {
  switch (server.status) {
    case ServerProbeStatus.on_path:
      return { icon: CircleCheck, tone: "text-emerald-500", label: "Installed (PATH)" };
    case ServerProbeStatus.managed:
      return { icon: HardDrive, tone: "text-emerald-500", label: "Managed install" };
    case ServerProbeStatus.missing:
      return server.downloadable
        ? { icon: Download, tone: "text-amber-500", label: "Will auto-install on first use" }
        : { icon: CircleSlash, tone: "text-muted-foreground", label: "Not installed" };
  }
}

interface ServerRowProps {
  server: ServerProbe;
}

const ServerRow = memo(function ServerRow({ server }: ServerRowProps) {
  const visual = visualFor(server);
  const Icon = visual.icon;
  return (
    <div className="flex items-start gap-3 py-3 first:pt-0 last:pb-0 border-t border-border first:border-t-0">
      <Icon className={cn("size-4 mt-0.5 shrink-0", visual.tone)} aria-hidden />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">{server.lsp_id}</span>
          {server.version && (
            <Badge variant="secondary" className="text-[10px] py-0 px-1.5 h-4">
              v{server.version}
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">{visual.label}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{server.language_ids.join(", ")}</p>
        {server.path && (
          <p className="text-[11px] text-muted-foreground/80 font-mono mt-1 break-all">
            {server.path}
          </p>
        )}
      </div>
    </div>
  );
});

/** @public */
export function LspServerList(): React.JSX.Element {
  const { data, isLoading, error } = useListLspServers({
    query: { refetchOnWindowFocus: false, staleTime: 30_000 },
  });

  const servers = useMemo(() => data?.servers ?? [], [data]);

  return (
    <div className="space-y-3">
      <div>
        <div className="text-sm font-medium">Language servers</div>
        <p className="text-xs text-muted-foreground">
          Cmd-click and F12 jump-to-definition use these. Servers are launched on demand the first
          time you open a matching file.
        </p>
      </div>
      {isLoading ? (
        // Skeleton matches the eventual row count loosely; per
        // `explicit-state.md` an async fetch must show progress.
        <div className="space-y-3" aria-live="polite" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-start gap-3 py-3">
              <div className="size-4 mt-0.5 rounded-full bg-muted animate-pulse" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3.5 w-40 rounded bg-muted animate-pulse" />
                <div className="h-3 w-64 rounded bg-muted/70 animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <p className="text-xs text-destructive">
          {error instanceof Error ? error.message : "Failed to load language servers"}
        </p>
      ) : servers.length === 0 ? (
        <p className="text-xs text-muted-foreground">No language servers in the catalog.</p>
      ) : (
        <div>
          {servers.map((server) => (
            <ServerRow key={server.lsp_id} server={server} />
          ))}
        </div>
      )}
    </div>
  );
}
