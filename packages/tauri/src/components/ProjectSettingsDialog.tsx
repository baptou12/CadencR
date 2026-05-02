import { useState, useEffect } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetProjectSettings,
  useSetProjectSetting,
  getGetProjectSettingsQueryKey,
} from "../api/generated";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ModelSelector } from "./ModelSelector";
import { WorktreeList } from "./WorktreeList";
import { ShellTerminalFrame } from "./ShellTerminalFrame";
import { DEFAULT_PROJECT_COLOR } from "@/lib/project-colors";

export function ProjectSettingsDialog({
  projectId,
  projectName,
  open,
  onOpenChange,
}: {
  projectId: number;
  projectName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { data: settingsArray } = useGetProjectSettings(projectId, { query: { enabled: open } });
  // Convert array to record for easy key access
  const settings: Record<string, string> = {};
  if (settingsArray) {
    for (const s of settingsArray) {
      if (s.value != null) settings[s.key] = s.value;
    }
  }
  const setSettingMutation = useSetProjectSetting({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getGetProjectSettingsQueryKey(projectId) });
        toast.success("Settings saved");
      },
    },
  });

  const branchPrefix = settings?.branch_prefix ?? "";
  const agentAutonomy = settings?.agent_autonomy ?? "1";
  const [colorInput, setColorInput] = useState(settings?.color ?? "");
  const [setupWorktree, setSetupWorktree] = useState(settings?.setup_worktree ?? "");
  const [qaPrompt, setQaPrompt] = useState(settings?.qa_prompt ?? "");
  useEffect(() => {
    if (settings?.color != null) {
      setColorInput(settings.color);
    }
  }, [settings?.color]);
  useEffect(() => {
    if (settings?.qa_prompt != null) {
      setQaPrompt(settings.qa_prompt);
    }
  }, [settings?.qa_prompt]);
  useEffect(() => {
    if (settings?.setup_worktree != null) {
      setSetupWorktree(settings.setup_worktree);
    }
  }, [settings?.setup_worktree]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[900px] w-[90vw] max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Project Settings: {projectName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-5 overflow-y-auto flex-1 pr-1">
          <div className="space-y-3">
            <h4 className="text-sm font-semibold">Project Color</h4>
            <div className="flex items-center gap-3">
              <span
                className="size-6 shrink-0 rounded-full border border-border"
                style={{ backgroundColor: `#${colorInput || DEFAULT_PROJECT_COLOR}` }}
              />
              <Input
                placeholder="e.g. 3b82f6"
                value={colorInput}
                onChange={(e) =>
                  setColorInput(e.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 6))
                }
                onBlur={() =>
                  setSettingMutation.mutate({
                    id: projectId,
                    data: { key: "color", value: colorInput },
                  })
                }
                className="h-8 text-sm w-32 font-mono"
              />
              <p className="text-xs text-muted-foreground">Hex color code (no #)</p>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <h4 className="text-sm font-semibold">Model Configuration</h4>
              <p className="text-xs text-muted-foreground">Override models for this project</p>
            </div>
            <ModelSelector level="project" projectId={projectId} />
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-semibold">Git &amp; Automation</h4>

            <div className="space-y-1">
              <span className="text-xs font-medium">Branch Prefix</span>
              <Input
                placeholder="e.g. feature/"
                value={branchPrefix}
                onChange={(e) =>
                  setSettingMutation.mutate({
                    id: projectId,
                    data: { key: "branch_prefix", value: e.target.value },
                  })
                }
                className="h-8 text-sm"
              />
              <p className="text-xs text-muted-foreground">Prefix added to worktree branch names</p>
            </div>

            <div className="space-y-1">
              <span className="text-xs font-medium">Worktree Setup Commands</span>
              <ShellTerminalFrame subtitle="one command per line" bodyClassName="p-0">
                <Textarea
                  placeholder={
                    "pnpm install\ncp packages/service/.env.example packages/service/.env"
                  }
                  rows={4}
                  value={setupWorktree}
                  onChange={(e) => setSetupWorktree(e.target.value)}
                  onBlur={() =>
                    setSettingMutation.mutate({
                      id: projectId,
                      data: { key: "setup_worktree", value: setupWorktree },
                    })
                  }
                  className="min-h-24 resize-y rounded-none border-0 bg-[var(--code-bg)] font-mono text-xs leading-relaxed text-[var(--code-fg)] placeholder:text-muted-foreground/60 focus-visible:ring-0 focus-visible:ring-offset-0"
                />
              </ShellTerminalFrame>
              <p className="text-xs text-muted-foreground">
                Shell commands to run after creating a worktree (one per line)
              </p>
            </div>

            <div className="space-y-1">
              <span className="text-xs font-medium">Agent Autonomy</span>
              <Select
                value={agentAutonomy}
                onValueChange={(value) =>
                  setSettingMutation.mutate({
                    id: projectId,
                    data: { key: "agent_autonomy", value },
                  })
                }
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Low — ask before commit</SelectItem>
                  <SelectItem value="2">Medium — manual continue</SelectItem>
                  <SelectItem value="3">High — full auto</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Controls how much the execute agent does automatically
              </p>
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="project-parallel-execution"
                  checked={(settings?.parallel_execution ?? "true") === "true"}
                  onCheckedChange={(checked) =>
                    setSettingMutation.mutate({
                      id: projectId,
                      data: {
                        key: "parallel_execution",
                        value: checked ? "true" : "false",
                      },
                    })
                  }
                />
                <label
                  htmlFor="project-parallel-execution"
                  className="text-xs font-medium cursor-pointer"
                >
                  Enable parallel agent execution
                </label>
              </div>
              <p className="text-xs text-muted-foreground">
                Run multiple agents in parallel within each execution step
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-semibold">QA &amp; Testing</h4>

            <div className="space-y-1">
              <span className="text-xs font-medium">QA Testing Procedure</span>
              <Textarea
                placeholder={"e.g. pnpm test\npnpm run lint\nVerify the app starts with pnpm start"}
                rows={4}
                value={qaPrompt}
                onChange={(e) => setQaPrompt(e.target.value)}
                onBlur={() =>
                  setSettingMutation.mutate({
                    id: projectId,
                    data: { key: "qa_prompt", value: qaPrompt },
                  })
                }
                className="text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Commands and steps the QA agent will follow to verify implementations
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <h4 className="text-sm font-semibold">Worktrees</h4>
              <p className="text-xs text-muted-foreground">
                Git worktrees created for this project's features
              </p>
            </div>
            <WorktreeList projectId={projectId} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
