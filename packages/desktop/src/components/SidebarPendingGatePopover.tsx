import { memo, useMemo, type ReactElement } from "react";
import { Loader2Icon, MessageCircleQuestionIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { parseAskUserQuestions } from "@/components/AgentQuestionDrawer";
import { agentQuestionOptionValue } from "@/components/agent-question/types";
import {
  AGENT_OPTION_CARD_BASE,
  AGENT_OPTION_CARD_RESTING,
} from "@/components/agent-prompt-option-card";
import { useFeaturePendingGate } from "@/hooks/useFeaturePendingGate";
import { usePendingGatePopoverOpen } from "@/hooks/usePendingGatePopoverOpen";
import {
  FeaturePermissionAction,
  type FeatureGateDecision,
  type FeaturePendingGateResponse,
} from "@/api/generated";
import { asRecord } from "@/stores/ws-envelope-payload-primitives";
import { cn } from "@/lib/utils";

interface SidebarPendingGatePopoverProps {
  featureId: number;
  onOpenConversation: () => void;
}

interface PermissionOptionView {
  key: string;
  label: string;
  description?: string;
  decision: FeatureGateDecision;
}

/** ~10 lines of text-xs / leading-snug before the body scrolls. */
const TEXT_SCROLL_CLASS = "max-h-[10lh] overflow-y-auto";

/**
 * Anchored next to a sidebar conversation while it awaits the user.
 *
 * - Single agent: answering keeps the popover open so the next gate in the
 *   queue appears in place (status/`request_id` drive the body).
 * - Multiple agents: only the most-recent pending feature auto-opens; an
 *   older popover stays open while the pointer is over it.
 */
export const SidebarPendingGatePopover = memo(function SidebarPendingGatePopover({
  featureId,
  onOpenConversation,
}: SidebarPendingGatePopoverProps): ReactElement {
  const { open, setOpen, setHovered, hoveredFeatureId } = usePendingGatePopoverOpen(featureId);
  const { gate, isLoading, isError, errorMessage, isSubmitting, respond } = useFeaturePendingGate({
    featureId,
    enabled: open,
  });

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next && hoveredFeatureId === featureId) setHovered(null);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Pending user input"
          className={cn(
            "inline-flex size-5 shrink-0 items-center justify-center rounded-md",
            "text-amber-400 hover:bg-sidebar-accent",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          )}
          onClick={(event) => {
            event.stopPropagation();
            setOpen(!open);
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <MessageCircleQuestionIcon className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={10}
        className="w-96 max-w-[min(24rem,calc(100vw-2rem))] p-0"
        onClick={(event) => event.stopPropagation()}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onMouseEnter={() => setHovered(featureId)}
        onMouseLeave={() => {
          if (hoveredFeatureId === featureId) setHovered(null);
        }}
      >
        <PendingGateBody
          gate={gate}
          isLoading={isLoading}
          isError={isError}
          errorMessage={errorMessage}
          isSubmitting={isSubmitting}
          onRespond={respond}
          onOpenConversation={() => {
            setOpen(false);
            onOpenConversation();
          }}
        />
      </PopoverContent>
    </Popover>
  );
});

interface PendingGateBodyProps {
  gate: FeaturePendingGateResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  errorMessage: string | null;
  isSubmitting: boolean;
  onRespond: (decision: FeatureGateDecision) => void;
  onOpenConversation: () => void;
}

function PendingGateBody({
  gate,
  isLoading,
  isError,
  errorMessage,
  isSubmitting,
  onRespond,
  onOpenConversation,
}: PendingGateBodyProps): ReactElement {
  if (isLoading || (isSubmitting && !gate)) {
    return (
      <div className="flex flex-col gap-2.5 p-3.5">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }

  if (isError || !gate) {
    return (
      <div className="flex flex-col gap-2.5 p-3.5 text-xs">
        <p className="text-muted-foreground">{errorMessage ?? "No pending request found."}</p>
        <Button size="sm" variant="secondary" onClick={onOpenConversation}>
          Open conversation
        </Button>
      </div>
    );
  }

  if (gate.kind === "plan") {
    return (
      <div className="flex flex-col gap-2.5 p-3.5 text-xs">
        <p className="font-medium text-foreground">Plan ready</p>
        {gate.last_assistant_text ? (
          <p className={cn("whitespace-pre-wrap text-muted-foreground", TEXT_SCROLL_CLASS)}>
            {gate.last_assistant_text}
          </p>
        ) : null}
        <Button size="sm" onClick={onOpenConversation}>
          Open conversation
        </Button>
      </div>
    );
  }

  return (
    <GateOptionsBody
      gate={gate}
      isSubmitting={isSubmitting}
      onRespond={onRespond}
      onOpenConversation={onOpenConversation}
    />
  );
}

function GateOptionsBody({
  gate,
  isSubmitting,
  onRespond,
  onOpenConversation,
}: {
  gate: FeaturePendingGateResponse;
  isSubmitting: boolean;
  onRespond: (decision: FeatureGateDecision) => void;
  onOpenConversation: () => void;
}): ReactElement {
  const options = useMemo(() => buildOptions(gate), [gate]);
  const prompt = gatePrompt(gate);

  return (
    <div className="flex flex-col gap-2.5 p-3.5 text-xs">
      <div className="flex items-center gap-1.5 font-medium text-foreground">
        <MessageCircleQuestionIcon className="size-3.5 text-amber-400" />
        <span>{gate.kind === "question" ? "Question" : "Permission needed"}</span>
        {isSubmitting ? (
          <Loader2Icon className="size-3 animate-spin text-muted-foreground" />
        ) : null}
      </div>
      {gate.last_assistant_text ? (
        <p
          className={cn(
            "whitespace-pre-wrap rounded-md bg-muted/40 px-2.5 py-2 text-[11px] leading-snug text-muted-foreground",
            TEXT_SCROLL_CLASS,
          )}
        >
          {gate.last_assistant_text}
        </p>
      ) : null}
      {prompt ? (
        <p
          className={cn(
            "whitespace-pre-wrap font-medium leading-snug text-foreground",
            TEXT_SCROLL_CLASS,
          )}
        >
          {prompt}
        </p>
      ) : null}
      {options.length > 0 ? (
        <div className="flex max-h-[min(40vh,16rem)] flex-col gap-1.5 overflow-y-auto">
          {options.map((option) => (
            <button
              key={option.key}
              type="button"
              disabled={isSubmitting}
              className={cn(
                AGENT_OPTION_CARD_BASE,
                AGENT_OPTION_CARD_RESTING,
                "px-2.5 py-2 text-[12px] disabled:cursor-not-allowed disabled:opacity-50",
              )}
              onClick={() => onRespond(option.decision)}
            >
              <span className="block font-medium text-foreground">{option.label}</span>
              {option.description ? (
                <span className="mt-0.5 block text-[10px] text-muted-foreground">
                  {option.description}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : (
        <Button size="sm" variant="secondary" onClick={onOpenConversation}>
          Open conversation
        </Button>
      )}
    </div>
  );
}

function gatePrompt(gate: FeaturePendingGateResponse): string | null {
  const payload = asRecord(gate.payload);
  if (!payload) return null;
  if (typeof payload.description === "string" && payload.description.trim()) {
    return payload.description.trim();
  }
  if (typeof payload.tool_name === "string" && payload.tool_name !== "AskUserQuestion") {
    const preview = typeof payload.preview === "string" ? payload.preview.trim() : "";
    return preview ? `${payload.tool_name}: ${preview}` : payload.tool_name;
  }
  const toolInput = asRecord(payload.tool_input);
  if (toolInput) {
    const questions = parseAskUserQuestions(toolInput);
    if (questions[0]?.question) return questions[0].question;
  }
  return null;
}

function buildOptions(gate: FeaturePendingGateResponse): PermissionOptionView[] {
  const payload = asRecord(gate.payload);
  if (!payload) return [];

  if (gate.kind === "permission") {
    const rawOptions = Array.isArray(payload.options) ? payload.options : [];
    return rawOptions.flatMap((raw, index) => {
      const option = asRecord(raw);
      if (!option) return [];
      const decisionRaw = typeof option.decision === "string" ? option.decision : null;
      const action = permissionActionFromDecision(decisionRaw);
      if (!action) return [];
      const label =
        typeof option.label === "string" && option.label.trim()
          ? option.label.trim()
          : action.replaceAll("_", " ");
      return [
        {
          key: `${decisionRaw}-${index}`,
          label,
          description: typeof option.description === "string" ? option.description : undefined,
          decision: {
            type: "permission",
            action,
          },
        },
      ];
    });
  }

  if (gate.kind === "question") {
    const toolInput = asRecord(payload.tool_input) ?? {};
    const questions = parseAskUserQuestions(toolInput);
    // Sidebar only answers simple single-select questions; complex forms open the chat.
    if (questions.length !== 1 || questions[0]?.multiSelect || !questions[0]?.options?.length) {
      return [];
    }
    return questions[0].options.map((option, index) => {
      const value = agentQuestionOptionValue(option);
      return {
        key: `q-${index}-${value}`,
        label: option.label,
        description: option.description,
        decision: {
          type: "question",
          answers: [[value]],
        },
      };
    });
  }

  return [];
}

function permissionActionFromDecision(
  decision: string | null,
): (typeof FeaturePermissionAction)[keyof typeof FeaturePermissionAction] | null {
  if (decision === "allow_once") return FeaturePermissionAction.allow_once;
  if (decision === "allow_future") return FeaturePermissionAction.allow_always;
  if (decision === "deny") return FeaturePermissionAction.deny;
  return null;
}
