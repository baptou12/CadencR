import plan from "./plan.md?raw";
import brainstorm from "./brainstorm.md?raw";
import prd from "./prd.md?raw";
import risk from "./risk.md?raw";
import review from "./review.md?raw";
import reviewFixer from "./review-fixer.md?raw";
import reviewFixerCompletionApproval from "./review-fixer-completion-approval.md?raw";
import reviewFixerCompletionAuto from "./review-fixer-completion-auto.md?raw";
import qaBase from "./qa-base.md?raw";
import qaCompletionApproval from "./qa-completion-approval.md?raw";
import qaCompletionAuto from "./qa-completion-auto.md?raw";
import executeBase from "./execute-base.md?raw";
import executeCompletionApproval from "./execute-completion-approval.md?raw";
import executeCompletionAuto from "./execute-completion-auto.md?raw";

export const prompts = {
  "plan.md": plan,
  "brainstorm.md": brainstorm,
  "prd.md": prd,
  "risk.md": risk,
  "review.md": review,
  "review-fixer.md": reviewFixer,
  "review-fixer-completion-approval.md": reviewFixerCompletionApproval,
  "review-fixer-completion-auto.md": reviewFixerCompletionAuto,
  "qa-base.md": qaBase,
  "qa-completion-approval.md": qaCompletionApproval,
  "qa-completion-auto.md": qaCompletionAuto,
  "execute-base.md": executeBase,
  "execute-completion-approval.md": executeCompletionApproval,
  "execute-completion-auto.md": executeCompletionAuto,
} as const;
