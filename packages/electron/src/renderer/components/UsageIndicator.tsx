import { memo } from "react";
import { useGetUsageHandler } from "@/api/generated";

function formatTimeUntilReset(
  resetsAt: string | null | undefined,
  isSevenDay: boolean,
): string {
  if (!resetsAt) return "";
  const reset = new Date(resetsAt).getTime();
  if (Number.isNaN(reset)) return "";
  const diff = reset - Date.now();
  if (diff <= 0) return "now";
  const hours = Math.floor(diff / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  if (isSevenDay) {
    return `${Math.floor(hours / 24)}d${Math.floor(hours % 24)}h`;
  }
  return hours > 0 ? `${hours}h${minutes}m` : `${minutes}m`;
}

export const UsageIndicator = memo(function UsageIndicator() {
  const { data, isLoading } = useGetUsageHandler({
    query: {
      refetchInterval: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: false,
      retry: false,
      staleTime: 5 * 60 * 1000,
    },
  });

  if (isLoading) {
    return <span className="text-xs text-muted-foreground">--</span>;
  }

  const fiveHour = data?.five_hour;
  const sevenDay = data?.seven_day;
  const sevenDaySonnet = data?.seven_day_sonnet;
  const hasBuckets = fiveHour || sevenDay || sevenDaySonnet;

  return (
    <div className="flex flex-col gap-0.5">
      {hasBuckets ? (
        <div className="flex flex-row px-2 pb-2">
          {/* 5-hour bucket — lightest */}
          <div className="flex flex-1 items-center justify-center gap-1.5 rounded-l-full bg-(--drac-comment)/20 px-2.5 py-1 text-[11px] font-medium text-zinc-300">
            <span>{fiveHour?.utilization ?? 0}%</span>
            <span className="opacity-60">
              {fiveHour?.resets_at &&
                formatTimeUntilReset(fiveHour?.resets_at, false)}
            </span>
          </div>
          {/* 7-day bucket — medium */}
          <div className="flex flex-1 items-center justify-center gap-1.5 bg-(--drac-comment)/30 px-2.5 py-1 text-[11px] font-medium text-zinc-300">
            <span>{sevenDay?.utilization ?? 0}%</span>
            <span className="opacity-60">
              {sevenDay?.resets_at &&
                formatTimeUntilReset(sevenDay?.resets_at, true)}
            </span>
          </div>
          {/* 7-day Sonnet bucket — darkest */}
          <div className="flex flex-1 items-center justify-center gap-1.5 rounded-r-full bg-(--drac-comment)/15 px-2.5 py-1 text-[11px] font-medium text-zinc-300">
            <span>{sevenDaySonnet?.utilization ?? 0}%</span>
            <span className="opacity-60">
              {sevenDaySonnet?.resets_at &&
                formatTimeUntilReset(sevenDaySonnet?.resets_at, true)}
            </span>
          </div>
        </div>
      ) : (
        <span className="text-xs text-muted-foreground px-1">--</span>
      )}
    </div>
  );
});
