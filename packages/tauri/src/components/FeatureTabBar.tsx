import { useHotkeys } from "react-hotkeys-hook";
import { BotIcon, TerminalIcon, GitCompareArrowsIcon } from "lucide-react";
import { KbdShortcut } from "@/components/KbdShortcut";
import { cn } from "@/lib/utils";
import type { FeatureTab } from "@/hooks/useActiveTab";

interface FeatureTabBarProps {
  activeTab: FeatureTab;
  onTabChange: (tab: FeatureTab) => void;
  gitStats?: { insertions: number; deletions: number } | null;
  gitBranch?: string | null;
}

const TABS: { id: FeatureTab; label: string; icon: typeof BotIcon; keys: string[] }[] = [
  { id: "agent", label: "Agent", icon: BotIcon, keys: ["cmd", "shift", "A"] },
  { id: "terminal", label: "Terminal", icon: TerminalIcon, keys: ["cmd", "shift", "T"] },
  { id: "git", label: "Git", icon: GitCompareArrowsIcon, keys: ["cmd", "shift", "D"] },
];

export function FeatureTabBar({ activeTab, onTabChange, gitStats, gitBranch }: FeatureTabBarProps) {
  useHotkeys(
    "meta+shift+a",
    (e) => { e.preventDefault(); onTabChange("agent"); },
    { enableOnFormTags: true, enableOnContentEditable: true },
  );

  useHotkeys(
    "meta+shift+t",
    (e) => { e.preventDefault(); onTabChange("terminal"); },
    { enableOnFormTags: true, enableOnContentEditable: true },
  );

  useHotkeys(
    "meta+shift+d",
    (e) => { e.preventDefault(); onTabChange("git"); },
    { enableOnFormTags: true, enableOnContentEditable: true },
  );

  return (
    <div className="flex items-stretch border-b border-border">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onTabChange(tab.id)}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors",
            activeTab === tab.id
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
          )}
        >
          <tab.icon className="size-4" />
          {tab.label}
          {tab.id === "git" && gitBranch && (
            <span className="truncate max-w-[120px]">{gitBranch}</span>
          )}
          {tab.id === "git" && gitStats && gitStats.insertions > 0 && (
            <span className="text-green-500">+{gitStats.insertions}</span>
          )}
          {tab.id === "git" && gitStats && gitStats.deletions > 0 && (
            <span className="text-red-400">-{gitStats.deletions}</span>
          )}
          <span className="ml-1.5"><KbdShortcut keys={tab.keys} size="sm" /></span>
        </button>
      ))}
    </div>
  );
}
