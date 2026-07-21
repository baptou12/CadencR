import { type ReactElement, type ReactNode } from "react";
import type { EditorView } from "@codemirror/view";
import { Loader2Icon, TriangleAlertIcon } from "lucide-react";
import {
  ConflictFallbackReason,
  ConflictUnavailableReason,
  useGetConflictContent,
} from "@/api/generated";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/api-errors";
import { useGitFileIndexActions } from "@/components/diff/useGitFileIndexActions";
import ConflictResultResolver from "./ConflictResultResolver";
import { textFromConflictContent } from "./ConflictResolverSurface";

interface ConflictResolverEditorProps {
  filePath: string;
  projectId: number;
  paneId: string;
  featureId: number;
  onEditorViewChange?: (paneId: string, view: EditorView | null) => void;
}

export default function ConflictResolverEditor(props: ConflictResolverEditorProps): ReactElement {
  const query = useGetConflictContent(
    { feature_id: props.featureId, file_path: props.filePath },
    { query: { refetchOnWindowFocus: false, refetchOnReconnect: false } },
  );
  const indexActions = useGitFileIndexActions(props.featureId);

  if (query.isLoading)
    return <ResolverMessage pending>Loading exact conflict content…</ResolverMessage>;
  if (query.isError) {
    return (
      <ResolverMessage
        error
        action={
          <Button
            size="sm"
            variant="outline"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {query.isFetching ? "Retrying…" : "Retry"}
          </Button>
        }
      >
        Could not load conflict content: {apiErrorMessage(query.error, "Unknown error")}
      </ResolverMessage>
    );
  }
  if (!query.data)
    return <ResolverMessage error>No conflict response was returned.</ResolverMessage>;
  if (query.data.outcome === "unavailable") {
    return (
      <UnavailableMessage
        reason={query.data.reason}
        isRetrying={query.isFetching}
        onRetry={() => void query.refetch()}
      />
    );
  }
  const resultText = textFromConflictContent(query.data.snapshot.result);
  if (resultText == null) {
    if (query.data.snapshot.presentation.mode === "modify_delete") {
      return (
        <StageGuidanceMessage
          filePath={props.filePath}
          message="The worktree result is deleted. Stage the deletion to mark this conflict resolved."
          stageDeletion
          indexActions={indexActions}
        />
      );
    }
    return (
      <GuidanceMessage
        filePath={props.filePath}
        reason={
          query.data.snapshot.presentation.mode === "guidance"
            ? query.data.snapshot.presentation.reason
            : ConflictFallbackReason.unavailable
        }
        indexActions={indexActions}
      />
    );
  }
  return <ConflictResultResolver {...props} snapshot={query.data.snapshot} />;
}

function ResolverMessage({
  children,
  error = false,
  pending = false,
  action,
}: {
  children: ReactNode;
  error?: boolean;
  pending?: boolean;
  action?: ReactNode;
}): ReactElement {
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm"
      role={error ? "alert" : "status"}
    >
      {pending ? (
        <Loader2Icon className="size-5 animate-spin" aria-hidden />
      ) : (
        <TriangleAlertIcon className="size-5 text-[var(--acc-orange)]" aria-hidden />
      )}
      <p>{children}</p>
      {action}
    </div>
  );
}

function UnavailableMessage({
  reason,
  isRetrying,
  onRetry,
}: {
  reason: ConflictUnavailableReason;
  isRetrying: boolean;
  onRetry: () => void;
}): ReactElement {
  const message = {
    [ConflictUnavailableReason.resolved]:
      "Git no longer reports this unmerged row. This tab will return to the normal editor once the status watcher confirms.",
    [ConflictUnavailableReason.stale]:
      "The conflict changed while its blobs were read. Reopen it after Git status refreshes.",
    [ConflictUnavailableReason.repository_unavailable]:
      "The repository is unavailable. No conflict bytes were assumed.",
  }[reason];
  const retryable = reason !== ConflictUnavailableReason.resolved;
  return (
    <ResolverMessage
      error
      action={
        retryable ? (
          <Button size="sm" variant="outline" disabled={isRetrying} onClick={onRetry}>
            {isRetrying ? "Retrying…" : "Retry"}
          </Button>
        ) : undefined
      }
    >
      {message}
    </ResolverMessage>
  );
}

function GuidanceMessage({
  filePath,
  reason,
  indexActions,
}: {
  filePath: string;
  reason: ConflictFallbackReason;
  indexActions: ReturnType<typeof useGitFileIndexActions>;
}): ReactElement {
  const message = {
    [ConflictFallbackReason.binary]:
      "Binary content cannot be resolved safely in the text editor. Choose the desired file externally, then stage it.",
    [ConflictFallbackReason.both_deleted]:
      "Both sides deleted this path. Stage the deletion to mark it resolved.",
    [ConflictFallbackReason.large]:
      "This conflict is too large for the merge resolver. Resolve it in a suitable editor, then stage it.",
    [ConflictFallbackReason.unavailable]:
      "A source is missing or unsupported. Inspect the repository before staging.",
  }[reason];
  return (
    <StageGuidanceMessage
      filePath={filePath}
      message={message}
      stageDeletion={reason === ConflictFallbackReason.both_deleted}
      indexActions={indexActions}
    />
  );
}

function StageGuidanceMessage({
  filePath,
  message,
  stageDeletion,
  indexActions,
}: {
  filePath: string;
  message: string;
  stageDeletion: boolean;
  indexActions: ReturnType<typeof useGitFileIndexActions>;
}): ReactElement {
  const pending = indexActions.pendingPath === filePath && indexActions.pendingAction === "stage";
  const stageError = indexActions.error?.filePath === filePath ? indexActions.error.message : null;
  return (
    <ResolverMessage
      error={stageError != null}
      action={
        <Button
          disabled={indexActions.isPending}
          aria-busy={pending}
          onClick={() => indexActions.stage(filePath)}
        >
          {pending ? "Staging…" : stageDeletion ? "Stage deletion" : "Stage"}
        </Button>
      }
    >
      {message}
      {stageError ? ` Stage failed: ${stageError}` : ""}
    </ResolverMessage>
  );
}
