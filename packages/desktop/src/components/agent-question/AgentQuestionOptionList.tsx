import { memo } from "react";
import { cn } from "@/lib/utils";
import { KbdShortcut } from "@/components/KbdShortcut";
import {
  AGENT_OPTION_CARD_BASE,
  AGENT_OPTION_CARD_RESTING,
  AGENT_OPTION_CARD_SELECTED,
  AGENT_OPTION_CARD_HIGHLIGHTED,
} from "@/components/agent-prompt-option-card";
import { agentQuestionOptionValue, type AgentQuestionOption } from "./types";

interface AgentQuestionOptionListProps {
  options: AgentQuestionOption[];
  selectedOptions: Set<string>;
  highlightedIndex: number | null;
  showOther: boolean;
  freeTextFocused: boolean;
  onOptionToggle: (option: string) => void;
  onOtherToggle: () => void;
}

/** Presentational option cards + "Other" toggle for the agent question drawer. */
function AgentQuestionOptionListComponent({
  options,
  selectedOptions,
  highlightedIndex,
  showOther,
  freeTextFocused,
  onOptionToggle,
  onOtherToggle,
}: AgentQuestionOptionListProps) {
  return (
    <div className="mb-2 flex flex-col gap-1.5">
      {options.map((option, optIdx) => {
        const value = agentQuestionOptionValue(option);
        return (
          <button
            key={value}
            type="button"
            className={cn(
              AGENT_OPTION_CARD_BASE,
              selectedOptions.has(value) ? AGENT_OPTION_CARD_SELECTED : AGENT_OPTION_CARD_RESTING,
              highlightedIndex === optIdx && AGENT_OPTION_CARD_HIGHLIGHTED,
            )}
            onClick={(e) => {
              onOptionToggle(value);
              // Blur so subsequent Enter is handled by the global hotkey (validate)
              // rather than re-triggering this button's click (which would re-toggle).
              e.currentTarget.blur();
            }}
          >
            <span className="text-sm font-medium text-foreground">
              <KbdShortcut
                keys={[String(optIdx + 1)]}
                variant="square"
                scope="agent"
                disabled={freeTextFocused}
              />
              {option.label}
            </span>
            {option.description && (
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {option.description}
              </span>
            )}
          </button>
        );
      })}
      {/* "Other" toggle */}
      <button
        type="button"
        className={cn(
          AGENT_OPTION_CARD_BASE,
          showOther ? AGENT_OPTION_CARD_SELECTED : AGENT_OPTION_CARD_RESTING,
          highlightedIndex === options.length && AGENT_OPTION_CARD_HIGHLIGHTED,
        )}
        onClick={(e) => {
          onOtherToggle();
          e.currentTarget.blur();
        }}
      >
        <span className="text-sm font-medium text-foreground">
          <KbdShortcut keys={["cmd", "O"]} variant="square" scope="agent" />
          Other...
        </span>
      </button>
    </div>
  );
}

export const AgentQuestionOptionList = memo(AgentQuestionOptionListComponent);
