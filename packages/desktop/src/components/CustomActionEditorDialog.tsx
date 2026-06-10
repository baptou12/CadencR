import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { ImageIcon, Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getListCustomActionsQueryKey,
  useCreateCustomAction,
  useUpdateCustomAction,
  type CustomAction,
  type Scope as CustomActionScope,
} from "@/api/generated";
import { BashFrame } from "./BashFrame";
import { CustomActionIcon } from "./CustomActionIcon";

const ACCEPTED_MIME = ["image/png", "image/jpeg", "image/jpg", "image/svg+xml", "image/gif"];
const MAX_ICON_BYTES = 512 * 1024;

interface CustomActionEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  featureId: number;
  /** When provided, the dialog edits this action; otherwise it creates a new one. */
  action?: CustomAction;
}

interface FormState {
  name: string;
  command: string;
  scope: CustomActionScope;
  iconData: string | null;
  runInTerminal: boolean;
}

const EMPTY_STATE: FormState = {
  name: "",
  command: "",
  scope: "project",
  iconData: null,
  runInTerminal: false,
};

export function CustomActionEditorDialog({
  open,
  onOpenChange,
  projectId,
  featureId,
  action,
}: CustomActionEditorDialogProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_STATE);

  // Reset form whenever the dialog opens or the target action changes.
  useEffect(() => {
    if (!open) return;
    if (action) {
      setForm({
        name: action.name,
        command: action.command,
        scope: action.scope,
        iconData: action.icon_data ?? null,
        runInTerminal: action.run_in_terminal,
      });
    } else {
      setForm(EMPTY_STATE);
    }
  }, [open, action]);

  const detectedVars = useMemo(() => {
    const re = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
    const seen = new Set<string>();
    const out: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(form.command)) != null) {
      if (!seen.has(m[1])) {
        seen.add(m[1]);
        out.push(m[1]);
      }
    }
    return out;
  }, [form.command]);

  const createMutation = useCreateCustomAction({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getListCustomActionsQueryKey({ project_id: projectId, feature_id: featureId }),
        });
        onOpenChange(false);
        toast.success("Action created");
      },
      onError: (err) => toast.error(`Create failed: ${err.message}`),
    },
  });

  const updateMutation = useUpdateCustomAction({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getListCustomActionsQueryKey({ project_id: projectId, feature_id: featureId }),
        });
        onOpenChange(false);
        toast.success("Action updated");
      },
      onError: (err) => toast.error(`Update failed: ${err.message}`),
    },
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  function handleFile(file: File): void {
    if (!ACCEPTED_MIME.includes(file.type)) {
      toast.error("Unsupported file type. Use PNG, JPG, GIF or SVG.");
      return;
    }
    if (file.size > MAX_ICON_BYTES) {
      toast.error(`Image too large (${file.size} bytes). Max ${MAX_ICON_BYTES} bytes.`);
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => toast.error("Failed to read image file.");
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        setForm((f) => ({ ...f, iconData: result }));
      }
    };
    reader.readAsDataURL(file);
  }

  function submit(): void {
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }
    if (!form.command.trim()) {
      toast.error("Command is required");
      return;
    }
    if (action) {
      updateMutation.mutate({
        id: action.id,
        data: {
          name: form.name,
          command: form.command,
          scope: form.scope,
          project_id: form.scope === "global" ? null : projectId,
          icon_data: form.iconData ?? "",
          run_in_terminal: form.runInTerminal,
        },
      });
    } else {
      createMutation.mutate({
        data: {
          name: form.name,
          command: form.command,
          scope: form.scope,
          project_id: form.scope === "global" ? null : projectId,
          icon_data: form.iconData,
          run_in_terminal: form.runInTerminal,
        },
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{action ? "Edit custom action" : "New custom action"}</DialogTitle>
          <DialogDescription>
            Commands run in the feature&apos;s working directory. Use{" "}
            <code className="font-mono text-xs">${"{VAR_NAME}"}</code> placeholders to prompt for
            per-feature values.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Name</label>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Open in Zed"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium">Command</label>
            <BashFrame>
              <Textarea
                value={form.command}
                onChange={(e) => setForm((f) => ({ ...f, command: e.target.value }))}
                placeholder="gh pr view ${PR_ID} --json comments"
                className="min-h-[5rem] resize-none rounded-none border-0 bg-transparent font-mono text-xs text-[var(--block-bash-fg)] shadow-none placeholder:text-[var(--block-bash-muted-fg)] focus-visible:border-0 focus-visible:ring-0"
              />
            </BashFrame>
            {detectedVars.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Variables detected:{" "}
                {detectedVars.map((v) => (
                  <code key={v} className="font-mono mr-1.5">
                    ${"{"}
                    {v}
                    {"}"}
                  </code>
                ))}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Scope</label>
              <Select
                value={form.scope}
                onValueChange={(v) => setForm((f) => ({ ...f, scope: v as CustomActionScope }))}
              >
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="project">This project only</SelectItem>
                  <SelectItem value="global">Available on all projects</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium">Icon</label>
              <div className="flex items-center gap-2">
                <div className="flex size-9 items-center justify-center rounded border bg-muted/30">
                  <CustomActionIcon iconData={form.iconData} name={form.name || "icon"} />
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED_MIME.join(",")}
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFile(file);
                    e.target.value = "";
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <ImageIcon className="size-3.5" /> Upload
                </Button>
                {form.iconData && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 text-destructive"
                    title="Remove icon"
                    onClick={() => setForm((f) => ({ ...f, iconData: null }))}
                  >
                    <Trash2Icon className="size-3.5" />
                  </Button>
                )}
              </div>
            </div>
          </div>

          <label className="flex cursor-pointer items-start gap-2.5">
            <Checkbox
              checked={form.runInTerminal}
              onCheckedChange={(checked) =>
                setForm((f) => ({ ...f, runInTerminal: checked === true }))
              }
              className="mt-0.5"
            />
            <span className="space-y-0.5">
              <span className="block text-xs font-medium">Run in a dedicated terminal split</span>
              <span className="block text-xs text-muted-foreground">
                Spawn the command in a new terminal pane instead of the background. Best for
                long-running, interactive commands like dev servers.
              </span>
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={isPending}>
            {isPending ? "Saving…" : action ? "Save changes" : "Create action"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
