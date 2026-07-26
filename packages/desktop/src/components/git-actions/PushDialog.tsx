/**
 * Push dialog: streams `git push -u origin HEAD` through a backend PTY
 * and surfaces a passphrase / yes-no input whenever ssh prompts.
 *
 * Why a dialog at all (the previous push was a fire-and-forget mutation):
 *  - SSH-protected keys produce a real prompt the user has to answer.
 *    Without a UI surface the push hangs invisibly until the PTY's
 *    stdin times out — terrible failure mode.
 *  - Even on the happy path, seeing live `git push` output (delta
 *    compression, byte counts, `remote: …` messages) is useful
 *    transparency. The dialog auto-closes on success in ~milliseconds
 *    when nothing prompts.
 *
 * Per `error-handling.md`, stderr surfaces inline in the terminal pane
 * (no silent swallow). Per `no-optimistic-updates.md`, we don't
 * pre-invalidate after success — the WS `git.status` envelope drives
 * everything downstream.
 */
import {
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type ReactElement,
  type RefObject,
  type SetStateAction,
} from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KbdShortcut } from "@/components/KbdShortcut";
import { usePush, usePushInput } from "@/api/generated";
import {
  selectPushOutput,
  selectPushRunning,
  usePushOutputStore,
} from "@/stores/usePushOutputStore";
import { detectSshPrompt } from "./detectSshPrompt";
import { PushOutputPane } from "./PushOutputPane";
import { apiErrorMessage, toastError } from "@/lib/api-errors";
import { useDialogSubmitShortcut } from "./useDialogSubmitShortcut";

// Hoisted so the `keys` prop is reference-stable across re-renders (streaming
// buffer chunks re-render this dialog frequently).
const ESC_KEYS: string[] = ["esc"];

interface PushDialogProps {
  featureId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface PushLifecycleArgs {
  featureId: number;
  open: boolean;
  runPush: () => Promise<void>;
  setFailed: Dispatch<SetStateAction<boolean>>;
  setAnsweredOffset: Dispatch<SetStateAction<number>>;
  setInputValue: Dispatch<SetStateAction<string>>;
}

function usePushDialogLifecycle({
  featureId,
  open,
  runPush,
  setFailed,
  setAnsweredOffset,
  setInputValue,
}: PushLifecycleArgs): void {
  const pushStartedRef = useRef(false);
  useEffect(() => {
    if (!open || pushStartedRef.current) return;
    pushStartedRef.current = true;
    setFailed(false);
    setAnsweredOffset(-1);
    const store = usePushOutputStore.getState();
    store.reset(featureId);
    store.start(featureId);
    void runPush();
    // The dialog is keyed by feature; only opening it should start a push.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (open) return;
    pushStartedRef.current = false;
    setFailed(false);
    setAnsweredOffset(-1);
    setInputValue("");
    usePushOutputStore.getState().reset(featureId);
  }, [featureId, open, setAnsweredOffset, setFailed, setInputValue]);
}

function useActivePushPrompt(
  buffer: string,
  answeredOffset: number,
  inputRef: RefObject<HTMLInputElement | null>,
) {
  const activePrompt = useMemo(() => {
    const detected = detectSshPrompt(buffer);
    return detected && detected.offset > answeredOffset ? detected : null;
  }, [answeredOffset, buffer]);
  useEffect(() => {
    if (activePrompt) inputRef.current?.focus();
  }, [activePrompt, inputRef]);
  return activePrompt;
}

function usePushRunner(
  featureId: number,
  onOpenChange: (open: boolean) => void,
  setFailed: Dispatch<SetStateAction<boolean>>,
) {
  const push = usePush();
  const showError = useCallback(
    (detail: string): void => {
      usePushOutputStore.getState().fail(featureId, detail);
      setFailed(true);
    },
    [featureId, setFailed],
  );
  const runPush = useCallback(async (): Promise<void> => {
    try {
      const result = await push.mutateAsync({ data: { feature_id: featureId } });
      if (!result.success) {
        showError(result.error ?? "Push failed.");
        return;
      }
      toast.success("Pushed");
      onOpenChange(false);
    } catch (error) {
      showError(apiErrorMessage(error, "Push failed."));
    }
  }, [featureId, onOpenChange, push, showError]);
  return useMemo(() => ({ push, runPush }), [push, runPush]);
}

interface PushDialogViewProps {
  featureId: number;
  open: boolean;
  failed: boolean;
  submitting: boolean;
  pushPending: boolean;
  inputPending: boolean;
  inputValue: string;
  activePrompt: ReturnType<typeof detectSshPrompt>;
  inputRef: RefObject<HTMLInputElement | null>;
  onOpenChange: (open: boolean) => void;
  onInputChange: (value: string) => void;
  onPromptSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}

function PushDialogView({
  featureId,
  open,
  failed,
  submitting,
  pushPending,
  inputPending,
  inputValue,
  activePrompt,
  inputRef,
  onOpenChange,
  onInputChange,
  onPromptSubmit,
}: PushDialogViewProps): ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!w-[min(90vw,48rem)] !max-w-[min(90vw,48rem)] sm:!max-w-[min(90vw,48rem)]">
        <DialogHeader>
          <DialogTitle>Push to remote</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 min-w-0">
          <PushOutputPane
            featureId={featureId}
            isMutationPending={pushPending}
            hasFailed={failed}
          />
          {activePrompt && (
            <form onSubmit={onPromptSubmit} className="space-y-1.5">
              <label
                htmlFor="push-prompt-input"
                className="block text-xs font-mono text-muted-foreground"
              >
                {activePrompt.text}
              </label>
              <div className="flex gap-2">
                <Input
                  id="push-prompt-input"
                  ref={inputRef}
                  type={activePrompt.kind === "password" ? "password" : "text"}
                  value={inputValue}
                  onChange={(event) => onInputChange(event.target.value)}
                  autoComplete="off"
                  data-1p-ignore
                  spellCheck={false}
                  disabled={inputPending}
                />
                <Button type="submit" disabled={inputPending}>
                  {inputPending && <Loader2 className="size-3.5 animate-spin mr-2" />}
                  Send
                </Button>
              </div>
            </form>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            title={submitting ? "Push is running — wait for it to finish." : "Close this dialog"}
          >
            {submitting ? "Running…" : "Close"}
            <KbdShortcut keys={ESC_KEYS} variant="hint" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PushDialog({
  featureId,
  open,
  onOpenChange,
}: PushDialogProps): ReactElement {
  const [failed, setFailed] = useState(false);
  // Offset of the last prompt the user has already answered. Compared to
  // `detectSshPrompt`'s output: a NEW prompt at a strictly larger offset
  // re-shows the input. Storing offsets (rather than a boolean "answered")
  // is what lets us tell apart "same prompt still on screen" from "ssh is
  // asking another question further down".
  const [answeredOffset, setAnsweredOffset] = useState<number>(-1);
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Buffer + lifecycle from the streaming store (narrow selectors so this
  // dialog re-renders only on its feature's chunks).
  const buffer = usePushOutputStore(selectPushOutput(featureId));
  const wsRunning = usePushOutputStore(selectPushRunning(featureId));

  const runner = usePushRunner(featureId, onOpenChange, setFailed);
  const sendInput = usePushInput();
  const submitting = runner.push.isPending || wsRunning;

  const activePrompt = useActivePushPrompt(buffer, answeredOffset, inputRef);
  usePushDialogLifecycle({
    featureId,
    open,
    runPush: runner.runPush,
    setFailed,
    setAnsweredOffset,
    setInputValue,
  });

  async function handlePromptSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!activePrompt) return;
    const text = inputValue;
    const offset = activePrompt.offset;
    // Don't mark the prompt as answered until the POST resolves — if the
    // call throws (network drop, backend rejected the input) we want the
    // input to stay visible so the user can retry. The Send button
    // disables itself via `sendInput.isPending`, which prevents double
    // submits while the request is inflight.
    try {
      await sendInput.mutateAsync({
        data: { feature_id: featureId, text },
      });
      // Success: hide the input and clear the typed value. Backend
      // acknowledged the answer, no retry needed.
      setAnsweredOffset(offset);
      setInputValue("");
    } catch (err) {
      // Do NOT call showError here — the push itself is still running and
      // may yet succeed (e.g. agent answered the same prompt). A toast
      // explains the partial failure without polluting the terminal pane.
      // Leave `answeredOffset` and `inputValue` untouched so the prompt
      // stays visible with the typed value preserved for retry.
      toastError(err, "Failed to send input.");
    }
  }

  // Cmd/Ctrl+Enter closes the dialog when push is finished — same shortcut
  // convention as commit. During a running push we unregister the shortcut so
  // it doesn't fight the prompt input's own Enter.
  useDialogSubmitShortcut({
    open,
    enabled: !submitting,
    onSubmit: () => onOpenChange(false),
  });

  return (
    <PushDialogView
      featureId={featureId}
      open={open}
      failed={failed}
      submitting={submitting}
      pushPending={runner.push.isPending}
      inputPending={sendInput.isPending}
      inputValue={inputValue}
      activePrompt={activePrompt}
      inputRef={inputRef}
      onOpenChange={onOpenChange}
      onInputChange={setInputValue}
      onPromptSubmit={handlePromptSubmit}
    />
  );
}
