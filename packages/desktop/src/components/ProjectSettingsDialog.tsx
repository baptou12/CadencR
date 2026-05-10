import { useState, useEffect } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { GitBranch, GitFork, TerminalSquare } from "lucide-react";
import {
  useGetProjectSettings,
  useSetProjectSetting,
  getGetProjectSettingsQueryKey,
} from "../api/generated";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ModelSelector } from "./ModelSelector";
import { WorktreeList } from "./WorktreeList";
import { ShellTerminalFrame } from "./ShellTerminalFrame";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { SettingsSwitchRow } from "@/components/settings/SettingsSwitchRow";
import { IconTile } from "@/components/settings/IconTile";
import { AutonomyRadio } from "@/components/settings/AutonomyRadio";
import { parseAgentAutonomy } from "@/lib/agent-autonomy";
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
  const agentAutonomy = parseAgentAutonomy(settings?.agent_autonomy);
  const parallelExecution = (settings?.parallel_execution ?? "true") === "true";
  const [colorInput, setColorInput] = useState(settings?.color ?? "");
  const [setupWorktree, setSetupWorktree] = useState(settings?.setup_worktree ?? "");
  const [qaPrompt, setQaPrompt] = useState(settings?.qa_prompt ?? "");
  useEffect(() => {
    if (settings?.color != null) setColorInput(settings.color);
  }, [settings?.color]);
  useEffect(() => {
    if (settings?.qa_prompt != null) setQaPrompt(settings.qa_prompt);
  }, [settings?.qa_prompt]);
  useEffect(() => {
    if (settings?.setup_worktree != null) setSetupWorktree(settings.setup_worktree);
  }, [settings?.setup_worktree]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-[90vw] flex-col gap-0 p-0 sm:max-w-[860px]">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle className="text-base font-semibold">
            Project Settings: {projectName}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-6 py-6">
          <SettingsSection size="sm" title="Identity" subtitle="Color · Display">
            <SettingsCard padded>
              <SettingsRow
                icon={
                  <span
                    className="size-8 shrink-0 rounded-full border border-border"
                    style={{ backgroundColor: `#${colorInput || DEFAULT_PROJECT_COLOR}` }}
                  />
                }
                label="Project color"
                description="Hex color used for this project's accent dot in the sidebar."
                control={
                  <Input
                    placeholder="3b82f6"
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
                    className="h-8 w-28 font-mono text-sm"
                  />
                }
                className="!px-0 !py-0"
              />
            </SettingsCard>
          </SettingsSection>

          <SettingsSection
            size="sm"
            title="Runtime & Models"
            subtitle="Per-agent model picks"
            description="Override the runtime/model used for each agent inside this project."
          >
            <SettingsCard>
              <ModelSelector level="project" projectId={projectId} />
            </SettingsCard>
          </SettingsSection>

          <SettingsSection
            size="sm"
            title="Git & Automation"
            subtitle="Worktree defaults"
            description="Defaults applied to worktrees created for this project."
          >
            <SettingsCard padded className="space-y-5">
              <div className="space-y-2">
                <label htmlFor="branch-prefix" className="text-sm font-medium">
                  Branch prefix
                </label>
                <p className="text-xs text-muted-foreground">
                  Prefix added to worktree branch names.
                </p>
                <div className="flex items-center gap-2">
                  <IconTile tint="cyan">
                    <GitBranch className="size-4" />
                  </IconTile>
                  <Input
                    id="branch-prefix"
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
                </div>
              </div>

              <div className="border-t border-border" />

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <IconTile tint="green">
                    <TerminalSquare className="size-4" />
                  </IconTile>
                  <div>
                    <div className="text-sm font-medium">Worktree setup commands</div>
                    <p className="text-xs text-muted-foreground">
                      Shell commands to run after creating a worktree (one per line).
                    </p>
                  </div>
                </div>
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
                    className="min-h-24 resize-y rounded-none border-0 bg-[var(--block-bash-body-bg)] font-mono text-xs leading-relaxed text-[var(--block-bash-fg)] placeholder:text-muted-foreground/60 focus-visible:ring-0 focus-visible:ring-offset-0"
                  />
                </ShellTerminalFrame>
              </div>

              <div className="border-t border-border" />

              <div className="space-y-2">
                <div className="text-sm font-medium">Agent autonomy</div>
                <p className="text-xs text-muted-foreground">
                  How much automation the execute agent uses while building features in this
                  project.
                </p>
                <AutonomyRadio
                  value={agentAutonomy}
                  onChange={(value) =>
                    setSettingMutation.mutate({
                      id: projectId,
                      data: { key: "agent_autonomy", value },
                    })
                  }
                />
              </div>

              <div className="border-t border-border" />

              <SettingsSwitchRow
                icon={<GitFork className="size-4" />}
                iconTint="purple"
                label="Parallel agent execution"
                description="Run multiple agents in parallel within each execution step."
                checked={parallelExecution}
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
            </SettingsCard>
          </SettingsSection>

          <SettingsSection
            size="sm"
            title="QA & Testing"
            subtitle="Verification commands"
            description="Commands and steps the QA agent will follow to verify implementations."
          >
            <SettingsCard padded>
              <div className="space-y-2">
                <label htmlFor="qa-prompt" className="text-sm font-medium">
                  QA testing procedure
                </label>
                <Textarea
                  id="qa-prompt"
                  placeholder={
                    "e.g. pnpm test\npnpm run lint\nVerify the app starts with pnpm start"
                  }
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
              </div>
            </SettingsCard>
          </SettingsSection>

          <SettingsSection
            size="sm"
            title="Worktrees"
            subtitle="Active checkouts"
            description="Git worktrees created for this project's features."
          >
            <SettingsCard padded>
              <WorktreeList projectId={projectId} />
            </SettingsCard>
          </SettingsSection>
        </div>
      </DialogContent>
    </Dialog>
  );
}
