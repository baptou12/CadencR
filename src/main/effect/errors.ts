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

// ---------------------------------------------------------------------------
// ToolPermissions errors
// ---------------------------------------------------------------------------

export class PermissionTimeoutError extends Data.TaggedError("PermissionTimeoutError")<{
  readonly subprocessId: string;
}> {}

export class QuestionTimeoutError extends Data.TaggedError("QuestionTimeoutError")<{
  readonly subprocessId: string;
}> {}

export class ApprovalTimeoutError extends Data.TaggedError("ApprovalTimeoutError")<{
  readonly subprocessId: string;
}> {}

// ---------------------------------------------------------------------------
// UsageService errors
// ---------------------------------------------------------------------------

export class UsageApiError extends Data.TaggedError("UsageApiError")<{
  readonly message: string;
  readonly statusCode?: number;
  readonly cause?: unknown;
}> {}

export class UsageRateLimitedError extends Data.TaggedError("UsageRateLimitedError")<{
  readonly retryAfter: number;
}> {}

export class KeychainError extends Data.TaggedError("KeychainError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ---------------------------------------------------------------------------
// SlashCommands errors
// ---------------------------------------------------------------------------

export class SlashCommandError extends Data.TaggedError("SlashCommandError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ---------------------------------------------------------------------------
// CliDiscovery errors
// ---------------------------------------------------------------------------

export class CliNotFoundError extends Data.TaggedError("CliNotFoundError")<{
  readonly searchedPaths: string[];
}> {}

export class CliDiscoveryError extends Data.TaggedError("CliDiscoveryError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}
