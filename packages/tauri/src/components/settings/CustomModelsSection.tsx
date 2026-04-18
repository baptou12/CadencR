import { useMemo, useState } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  useClaudeCodeCustomModels,
  useDeleteClaudeCodeCustomModel,
  useUpsertClaudeCodeCustomModel,
  type RuntimeModelOption,
} from "@/api/agentRuntime";
import { ErrorRow, LoadingRow, toastCallbacks } from "./SettingsStateRows";

export function CustomModelsSection() {
  const modelsQuery = useClaudeCodeCustomModels();
  const deleteModel = useDeleteClaudeCodeCustomModel();
  const [editing, setEditing] = useState<
    { mode: "create" } | { mode: "edit"; model: RuntimeModelOption } | null
  >(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const models = modelsQuery.data?.models ?? [];

  const handleConfirmDelete = () => {
    if (!pendingDelete) return;
    const modelId = pendingDelete;
    deleteModel.mutate(
      { modelId },
      toastCallbacks(`Custom model "${modelId}" deleted`, "Failed to delete model"),
    );
  };

  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Custom Claude Code models</h2>
          <p className="text-sm text-muted-foreground">
            Additional model IDs merged into the Claude Code catalog — e.g. older aliases, Bedrock
            ARNs, or gateway names.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setEditing({ mode: "create" })}>
          <Plus className="size-3.5" /> New model
        </Button>
      </div>

      {modelsQuery.isLoading ? (
        <LoadingRow label="Loading custom models…" />
      ) : modelsQuery.isError ? (
        <ErrorRow label="Failed to load custom models." />
      ) : models.length === 0 ? (
        <div className="rounded-md border border-border px-4 py-6 text-sm text-muted-foreground">
          No custom models yet.
        </div>
      ) : (
        <div className="rounded-md border border-border overflow-hidden">
          {models.map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between gap-4 px-4 py-2.5 border-t border-border first:border-t-0"
            >
              <div className="flex flex-col min-w-0">
                <span className="font-medium text-sm truncate">{m.label}</span>
                <span className="text-xs text-muted-foreground font-mono truncate">{m.id}</span>
                {m.description && (
                  <span className="text-xs text-muted-foreground truncate">{m.description}</span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setEditing({ mode: "edit", model: m })}
                  aria-label={`Edit ${m.id}`}
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setPendingDelete(m.id)}
                  aria-label={`Delete ${m.id}`}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <CustomModelEditor
          initial={editing.mode === "edit" ? editing.model : undefined}
          existingIds={models.map((m) => m.id)}
          onClose={() => setEditing(null)}
        />
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
        title={`Delete custom model "${pendingDelete}"?`}
        description="The model will no longer appear in the model picker."
        confirmText="Delete"
        variant="destructive"
        onConfirm={handleConfirmDelete}
      />
    </section>
  );
}

function CustomModelEditor({
  initial,
  existingIds,
  onClose,
}: {
  initial?: RuntimeModelOption;
  existingIds: string[];
  onClose: () => void;
}) {
  const upsert = useUpsertClaudeCodeCustomModel();
  const [modelId, setModelId] = useState(initial?.id ?? "");
  const [label, setLabel] = useState(initial?.label ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");

  const isEdit = !!initial;
  const trimmedId = modelId.trim();
  const trimmedLabel = label.trim();
  const idError = useMemo(() => {
    if (!trimmedId) return "Model ID is required";
    if (!isEdit && existingIds.includes(trimmedId)) return "A model with this ID already exists";
    return null;
  }, [trimmedId, existingIds, isEdit]);
  const labelError = !trimmedLabel ? "Label is required" : null;

  const canSave = !idError && !labelError && !upsert.isPending;

  const handleSave = () => {
    if (!canSave) return;
    upsert.mutate(
      {
        modelId: trimmedId,
        label: trimmedLabel,
        description: description.trim() || undefined,
      },
      toastCallbacks(`Custom model "${trimmedId}" saved`, "Failed to save custom model", onClose),
    );
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit "${initial!.id}"` : "New custom model"}</DialogTitle>
          <DialogDescription>
            The model ID is passed to the Claude CLI via <code>--model</code>. Use any value your
            active profile's backend understands.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Model ID</label>
            <Input
              className="font-mono text-xs"
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              placeholder="claude-sonnet-3-5-20241022"
              disabled={isEdit}
              aria-invalid={!!idError}
            />
            {idError && <p className="text-xs text-destructive">{idError}</p>}
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Label</label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Sonnet 3.5 (legacy)"
              aria-invalid={!!labelError}
            />
            {labelError && <p className="text-xs text-destructive">{labelError}</p>}
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Description</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Older model via Bedrock"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!canSave} onClick={handleSave}>
            {upsert.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Save model
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
