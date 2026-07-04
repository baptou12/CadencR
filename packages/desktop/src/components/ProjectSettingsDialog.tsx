import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetProjectSettings,
  useSetProjectSetting,
  getGetProjectSettingsQueryKey,
} from "../api/generated";
import { GitBranch, TerminalSquare } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ModelSelector } from "./ModelSelector";
import { WorktreeList } from "./WorktreeList";
import { ShellTerminalFrame } from "./ShellTerminalFrame";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { IconTile } from "@/components/settings/IconTile";
import { ProjectColorPicker } from "@/components/settings/ProjectColorPicker";
import { ProjectJsonSettings } from "@/components/settings/SettingsJsonControls";
import { ProjectEditorToolingSettings } from "@/components/settings/ProjectEditorToolingSettings";
import { useDebouncedCallback } from "@/hooks/useDebouncedCallback";
import { settingsArrayToMap } from "@/api/settings";

const PROJECT_SETTING_KEYS = {
  branchPrefix: "branch_prefix",
  color: "color",
  setupWorktree: "setup_worktree",
} as const;

type ProjectSettingKey = (typeof PROJECT_SETTING_KEYS)[keyof typeof PROJECT_SETTING_KEYS];

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
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const { data: settingsArray } = useGetProjectSettings(projectId, { query: { enabled: open } });
  const settings = useMemo(() => settingsArrayToMap(settingsArray), [settingsArray]);
  // Toast only the user-driven saves — the field-level autosave fires often
  // enough that a per-keystroke toast would be noise. We surface "Saved" on
  // explicit color picker clicks via the swatch's onChange.
  const setSettingMutation = useSetProjectSetting({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getGetProjectSettingsQueryKey(projectId) });
      },
      onError: (err: Error) => {
        toast.error(err.message);
      },
    },
  });

  const saveProjectSetting = useCallback(
    (key: ProjectSettingKey, value: string): void => {
      setSettingMutation.mutate({ id: projectId, data: { key, value } });
    },
    [projectId, setSettingMutation],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-[90vw] flex-col gap-0 p-0 sm:max-w-6xl">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle className="text-base font-semibold">
            Project settings — <span className="text-muted-foreground">{projectName}</span>
          </DialogTitle>
          <p className="text-[11px] text-muted-foreground">Changes save automatically.</p>
        </DialogHeader>

        <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-6 py-6">
          <ConfigurationSection projectId={projectId} enabled={open} />
          <IdentitySection
            projectId={projectId}
            color={settings[PROJECT_SETTING_KEYS.color]}
            saveProjectSetting={saveProjectSetting}
          />
          <EditorToolingSection projectId={projectId} enabled={open} />
          <RuntimeModelsSection projectId={projectId} />
          <GitAutomationSection
            projectId={projectId}
            branchPrefix={settings[PROJECT_SETTING_KEYS.branchPrefix]}
            setupWorktree={settings[PROJECT_SETTING_KEYS.setupWorktree]}
            saveProjectSetting={saveProjectSetting}
          />
          <WorktreesSection projectId={projectId} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface SyncedSettingInput {
  value: string;
  setValue: (value: string) => void;
}

function useSyncedSettingInput(
  remoteValue: string | undefined,
  resetKey: string,
): SyncedSettingInput {
  const [value, setStoredValue] = useState(remoteValue ?? "");
  const dirtyRef = useRef(false);
  const resetKeyRef = useRef(resetKey);

  useEffect((): void => {
    if (resetKeyRef.current !== resetKey) {
      resetKeyRef.current = resetKey;
      dirtyRef.current = false;
      setStoredValue(remoteValue ?? "");
      return;
    }
    if (remoteValue === undefined) return;
    if (dirtyRef.current && remoteValue !== value) return;
    dirtyRef.current = false;
    if (remoteValue !== value) setStoredValue(remoteValue);
  }, [remoteValue, resetKey, value]);

  const setValue = useCallback((next: string): void => {
    dirtyRef.current = true;
    setStoredValue(next);
  }, []);

  return useMemo(() => ({ value, setValue }), [value, setValue]);
}

function ConfigurationSection({
  projectId,
  enabled,
}: {
  projectId: number;
  enabled: boolean;
}): React.JSX.Element {
  return (
    <SettingsSection size="sm" title="Configuration" subtitle="Edit JSON · Copy path">
      <SettingsCard padded>
        <ProjectJsonSettings projectId={projectId} enabled={enabled} />
      </SettingsCard>
    </SettingsSection>
  );
}

function IdentitySection({
  projectId,
  color,
  saveProjectSetting,
}: {
  projectId: number;
  color: string | undefined;
  saveProjectSetting: (key: ProjectSettingKey, value: string) => void;
}): React.JSX.Element {
  const colorInput = useSyncedSettingInput(color, `${projectId}:color`);

  function commitColor(next: string): void {
    colorInput.setValue(next);
    if (next !== (color ?? "")) saveProjectSetting(PROJECT_SETTING_KEYS.color, next);
  }

  return (
    <SettingsSection size="sm" title="Identity" subtitle="Color · Display">
      <SettingsCard padded>
        <div className="space-y-2">
          <div className="text-sm font-medium">Project color</div>
          <p className="text-xs text-muted-foreground">
            Accent dot used for this project in the sidebar.
          </p>
          <ProjectColorPicker value={colorInput.value} onChange={commitColor} />
        </div>
      </SettingsCard>
    </SettingsSection>
  );
}

function EditorToolingSection({
  projectId,
  enabled,
}: {
  projectId: number;
  enabled: boolean;
}): React.JSX.Element {
  return (
    <SettingsSection
      size="sm"
      title="Editor Tooling"
      subtitle="Language servers · Formatter"
      description="Type checker, linter, and formatter for this project's editor. Each falls back to the global default when unset."
    >
      <SettingsCard padded>
        <ProjectEditorToolingSettings projectId={projectId} enabled={enabled} />
      </SettingsCard>
    </SettingsSection>
  );
}

function RuntimeModelsSection({ projectId }: { projectId: number }): React.JSX.Element {
  return (
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
  );
}

function GitAutomationSection({
  projectId,
  branchPrefix,
  setupWorktree,
  saveProjectSetting,
}: {
  projectId: number;
  branchPrefix: string | undefined;
  setupWorktree: string | undefined;
  saveProjectSetting: (key: ProjectSettingKey, value: string) => void;
}): React.JSX.Element {
  const branchPrefixInput = useSyncedSettingInput(branchPrefix, `${projectId}:branch_prefix`);
  const setupWorktreeInput = useSyncedSettingInput(setupWorktree, `${projectId}:setup_worktree`);

  const commitBranchPrefix = useDebouncedCallback((next: string): void => {
    if (next !== (branchPrefix ?? "")) saveProjectSetting(PROJECT_SETTING_KEYS.branchPrefix, next);
  }, 400);

  const commitSetupWorktree = useDebouncedCallback((next: string): void => {
    if (next !== (setupWorktree ?? ""))
      saveProjectSetting(PROJECT_SETTING_KEYS.setupWorktree, next);
  }, 600);

  return (
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
          <p className="text-xs text-muted-foreground">Prefix added to worktree branch names.</p>
          <div className="flex items-center gap-2">
            <IconTile tint="cyan">
              <GitBranch className="size-4" />
            </IconTile>
            <Input
              id="branch-prefix"
              placeholder="e.g. feature/"
              value={branchPrefixInput.value}
              onChange={(e) => {
                branchPrefixInput.setValue(e.target.value);
                commitBranchPrefix(e.target.value);
              }}
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
              placeholder={"pnpm install\ncp packages/service/.env.example packages/service/.env"}
              rows={4}
              value={setupWorktreeInput.value}
              onChange={(e) => {
                setupWorktreeInput.setValue(e.target.value);
                commitSetupWorktree(e.target.value);
              }}
              className="min-h-24 resize-y rounded-none border-0 bg-[var(--block-bash-body-bg)] font-mono text-xs leading-relaxed text-[var(--block-bash-fg)] placeholder:text-muted-foreground/60 focus-visible:ring-0 focus-visible:ring-offset-0"
            />
          </ShellTerminalFrame>
        </div>
      </SettingsCard>
    </SettingsSection>
  );
}

function WorktreesSection({ projectId }: { projectId: number }): React.JSX.Element {
  return (
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
  );
}
