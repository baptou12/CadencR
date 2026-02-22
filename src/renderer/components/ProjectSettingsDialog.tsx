import { useState, useEffect } from "react";
import { trpc } from "@/trpc";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ModelSelector } from "./ModelSelector";
import { WorktreeList } from "./WorktreeList";

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
  const utils = trpc.useUtils();
  const { data: settings } = trpc.projects.getSettings.useQuery(
    { project_id: projectId },
    { enabled: open },
  );
  const setSettingMutation = trpc.projects.setSetting.useMutation({
    onSuccess: () => {
      void utils.projects.getSettings.invalidate({ project_id: projectId });
    },
  });

  const branchPrefix = settings?.branch_prefix ?? "";
  const agentAutonomy = settings?.agent_autonomy ?? "1";
  const [setupWorktree, setSetupWorktree] = useState(settings?.setup_worktree ?? "");
  const [qaPrompt, setQaPrompt] = useState(settings?.qa_prompt ?? "");
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
            <div>
              <h4 className="text-sm font-semibold">Model Configuration</h4>
              <p className="text-xs text-muted-foreground">
                Override models for this project
              </p>
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
                    project_id: projectId,
                    key: "branch_prefix",
                    value: e.target.value,
                  })
                }
                className="h-8 text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Prefix added to worktree branch names
              </p>
            </div>

            <div className="space-y-1">
              <span className="text-xs font-medium">Worktree Setup Commands</span>
              <Textarea
                placeholder={"e.g. pnpm install\ncp .env.example .env"}
                rows={3}
                value={setupWorktree}
                onChange={(e) => setSetupWorktree(e.target.value)}
                onBlur={() =>
                  setSettingMutation.mutate({
                    project_id: projectId,
                    key: "setup_worktree",
                    value: setupWorktree,
                  })
                }
                className="text-sm"
              />
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
                    project_id: projectId,
                    key: "agent_autonomy",
                    value,
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
                    project_id: projectId,
                    key: "qa_prompt",
                    value: qaPrompt,
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
