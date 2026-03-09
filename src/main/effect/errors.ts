import { Data } from "effect";

export class DatabaseError extends Data.TaggedError("DatabaseError")<{
  operation: string;
  cause: unknown;
}> {}

export class PtyError extends Data.TaggedError("PtyError")<{
  message: string;
  cause?: unknown;
}> {}

export class PtyNotFound extends Data.TaggedError("PtyNotFound")<{
  id: string;
}> {}

export class SdkError extends Data.TaggedError("SdkError")<{
  message: string;
  cause?: unknown;
  isResumable?: boolean;
}> {}

// ---------------------------------------------------------------------------
// Domain-specific typed errors
// ---------------------------------------------------------------------------

export class SessionNotFoundError extends Data.TaggedError("SessionNotFoundError")<{
  readonly sessionId: number;
}> {}

export class SubprocessAlreadyRunningError extends Data.TaggedError("SubprocessAlreadyRunningError")<{
  readonly subprocessId: string;
}> {}

export class InvalidStateTransitionError extends Data.TaggedError("InvalidStateTransitionError")<{
  readonly sessionId: number;
  readonly currentStatus: string;
  readonly targetStatus: string;
}> {}

export class DispatchConflictError extends Data.TaggedError("DispatchConflictError")<{
  readonly featureId: number;
}> {}

export class PhaseNotFoundError extends Data.TaggedError("PhaseNotFoundError")<{
  readonly phaseId: number;
}> {}

export class PlanNotFoundError extends Data.TaggedError("PlanNotFoundError")<{
  readonly planId: number;
}> {}
