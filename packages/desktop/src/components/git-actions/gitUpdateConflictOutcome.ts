import { toast } from "sonner";

import { describeGitUpdateConflictFiles } from "./gitUpdateMessages";
import { recordGitUpdateConflicts, type RecordConflictInput } from "./gitUpdateRecoveryStore";

export function recordGitUpdateConflictOutcome(input: RecordConflictInput): void {
  recordGitUpdateConflicts(input);
  toast.warning("Update paused for conflicts", {
    description: describeGitUpdateConflictFiles(input.conflictFiles),
  });
}
