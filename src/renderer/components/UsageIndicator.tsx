import { trpc } from "@/trpc";

function formatTimeUntilReset(resetsAt: string | null): string {
  if (!resetsAt) return "";
  const now = Date.now();
  const reset = new Date(resetsAt).getTime();
  const diff = reset - now;
  if (diff <= 0) return "now";
  const hours = Math.floor(diff / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  return hours > 0 ? `${hours}h${minutes}m` : `${minutes}m`;
}

export function UsageIndicator() {
  const { data, isLoading, isError } = trpc.usage.getUsage.useQuery(undefined, {
    refetchInterval: 3 * 60 * 1000,
  });

  if (isLoading || isError || !data) {
    return <span className="text-xs text-muted-foreground">--</span>;
  }

  const fiveHour = data.five_hour;
  const sevenDay = data.seven_day;
  const resetTime = formatTimeUntilReset(fiveHour.resets_at);

  return (
    <span className="text-xs tabular-nums text-muted-foreground">
      {Math.round(fiveHour.utilization)}%{resetTime && ` · ${resetTime}`} · {Math.round(sevenDay.utilization)}%
    </span>
  );
}
