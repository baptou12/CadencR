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
