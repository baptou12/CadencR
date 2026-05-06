import { Files, MessageSquare, PanelLeft, Terminal } from "lucide-react";
import type { ReactNode } from "react";
import { OnboardingFooter } from "../OnboardingFooter";
import type { OnboardingStepProps } from "../OnboardingOverlay";

/**
 * Step 5 — quick map of the workspace UI plus the final CTA. Advancing
 * persists `step = "completed"` which causes `OnboardingGate` to unmount
 * the overlay so the user lands directly in the workspace.
 */
export function FirstPromptStep({ isPersisting, onAdvance, onBack }: OnboardingStepProps) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onAdvance();
      }}
      className="flex flex-col gap-6"
    >
      <header className="space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">You&apos;re ready</h2>
        <p className="text-sm text-muted-foreground">
          Here&apos;s what you&apos;ll see in the workspace. Open a feature, type a prompt in the
          input at the bottom, and the agent will start working.
        </p>
      </header>

      <ul className="space-y-3">
        <Tip icon={<PanelLeft className="size-4" />} title="Sidebar">
          Projects, features, and saved sessions live on the left.
        </Tip>
        <Tip icon={<MessageSquare className="size-4" />} title="Agent stream">
          The center panel streams the agent&apos;s reasoning, tool calls, and output.
        </Tip>
        <Tip icon={<Files className="size-4" />} title="Files & diffs">
          File tree and unified diffs sit on the right; review changes before committing.
        </Tip>
        <Tip icon={<Terminal className="size-4" />} title="Terminal">
          A terminal pane is one keyboard shortcut away — open it from the bottom bar.
        </Tip>
      </ul>

      <OnboardingFooter
        primaryLabel="Start using Cadencr"
        onPrimary={onAdvance}
        primaryDisabled={isPersisting}
        onBack={onBack}
      />
    </form>
  );
}

function Tip({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3 rounded-md border border-border bg-muted/20 px-3 py-2.5">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <div className="flex-1 min-w-0 text-sm">
        <div className="font-medium">{title}</div>
        <div className="text-muted-foreground">{children}</div>
      </div>
    </li>
  );
}
