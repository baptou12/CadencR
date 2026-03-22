import { Layer, ManagedRuntime } from "effect";
import { DatabaseLive } from "./services/Database.js";
import { PtyManagerLive } from "./services/PtyManager.js";
import { DispatchLockLive } from "./services/DispatchLock.js";
import { UsageServiceLive } from "./services/UsageService.js";

// All agent subprocess services (SdkQueryRunner, SubprocessLifecycle,
// SessionPersistence, EventBroadcaster, CompletionActions, ToolPermissions,
// SlashCommands, BackgroundTaskRegistry, PlanApproval) have been removed —
// agent management is now handled by the Rust WebSocket backend.

export const AppLayer = Layer.mergeAll(
  DatabaseLive,
  PtyManagerLive,
  DispatchLockLive,
  UsageServiceLive,
);

export const AppRuntime = ManagedRuntime.make(AppLayer);
