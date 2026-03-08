import { memo } from "react";
import { trpc } from "@/trpc";

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
  const { data, isLoading } = trpc.usage.getUsage.useQuery(undefined, {
    refetchInterval: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    retry: false,
    staleTime: 5 * 60 * 1000,
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
        <div className="flex flex-row relative gap-1">
          <div className="bg-(--drac-purple)/10 h-auto text-xs flex flex-row w-full justify-around relative p-1">
            <div
              className="bg-(--drac-purple)/40 absolute top-0 left-0 bottom-0"
              style={{ width: `${fiveHour?.utilization || 0}%` }}
            />
            <span>{fiveHour?.utilization ?? 0}%</span>
            <span>
              {fiveHour?.resets_at &&
                formatTimeUntilReset(fiveHour?.resets_at, false)}
            </span>
          </div>
          <div className="bg-(--drac-cyan)/10 h-auto text-xs flex flex-row justify-around w-full relative p-1">
            <div
              className="bg-(--drac-cyan)/40 absolute top-0 left-0 bottom-0"
              style={{ width: `${sevenDay?.utilization || 0}%` }}
            />
            <span>{sevenDay?.utilization ?? 0}%</span>
            <span>
              {sevenDay?.resets_at &&
                formatTimeUntilReset(sevenDay?.resets_at, true)}
            </span>
          </div>
          <div className="bg-(--drac-comment)/10 h-auto text-xs flex flex-row justify-around w-full relative p-1">
            <div
              className="bg-(--drac-comment)/40 absolute top-0 left-0 bottom-0"
              style={{ width: `${sevenDaySonnet?.utilization || 0}%` }}
            />
            <span>{sevenDaySonnet?.utilization ?? 0}%</span>
            <span>
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
