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
import { memo, useMemo, useState } from "react";
import {
  CircleOff,
  CloudDownload,
  PackageCheck,
  Search,
  TerminalSquare,
  type LucideIcon,
} from "lucide-react";
import { useListLspServers, type ServerProbe, ServerProbeStatus } from "@/api/generated";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { IconTile, type IconTileTint } from "@/components/settings/IconTile";

interface StatusVisual {
  icon: LucideIcon;
  tint: IconTileTint;
  label: string;
}

function visualFor(server: ServerProbe): StatusVisual {
  switch (server.status) {
    case ServerProbeStatus.on_path:
      return { icon: TerminalSquare, tint: "green", label: "Installed (PATH)" };
    case ServerProbeStatus.managed:
      return { icon: PackageCheck, tint: "green", label: "Managed install" };
    case ServerProbeStatus.missing:
      return server.downloadable
        ? { icon: CloudDownload, tint: "orange", label: "Will auto-install on first use" }
        : { icon: CircleOff, tint: "muted", label: "Not installed" };
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
      <IconTile tint={visual.tint} size="sm" className="mt-0.5">
        <Icon className="size-4" aria-hidden />
      </IconTile>
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

/** Case-insensitive match against the lsp id, binary name, or any language id. */
function matchesQuery(server: ServerProbe, needle: string): boolean {
  if (server.lsp_id.toLowerCase().includes(needle)) return true;
  if (server.bin_name.toLowerCase().includes(needle)) return true;
  return server.language_ids.some((id) => id.toLowerCase().includes(needle));
}

/** @public */
export function LspServerList(): React.JSX.Element {
  const { data, isLoading, error } = useListLspServers({
    query: { refetchOnWindowFocus: false, staleTime: 30_000 },
  });
  const [query, setQuery] = useState("");

  const servers = useMemo(() => data?.servers ?? [], [data]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return servers;
    return servers.filter((server) => matchesQuery(server, needle));
  }, [servers, query]);

  return (
    <div className="space-y-3">
      {!isLoading && !error && servers.length > 0 && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by language or server name…"
            className="h-8 pl-8 text-sm"
            aria-label="Search language servers"
          />
        </div>
      )}
      {isLoading ? (
        // Skeleton matches the eventual row count loosely; per
        // `explicit-state.md` an async fetch must show progress.
        <div className="space-y-3" aria-live="polite" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-start gap-3 py-3">
              <div className="size-7 mt-0.5 rounded-md bg-muted animate-pulse" />
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
      ) : filtered.length === 0 ? (
        <p className="text-xs text-muted-foreground">No language servers match “{query.trim()}”.</p>
      ) : (
        // Bounded height keeps the catalog from pushing the rest of the
        // settings card off-screen; the list scrolls within this box.
        <div className="max-h-72 overflow-y-auto pr-1">
          {filtered.map((server) => (
            <ServerRow key={server.lsp_id} server={server} />
          ))}
        </div>
      )}
    </div>
  );
}
