import { Layer, ManagedRuntime } from "effect";
import { DatabaseLive } from "./services/Database.js";
import { PtyManagerLive } from "./services/PtyManager.js";
import { SessionPersistenceLive } from "./services/SessionPersistence.js";
import { EventBroadcasterLive } from "./services/EventBroadcaster.js";
import { CompletionActionsLive } from "./services/CompletionActions.js";
import { SdkQueryRunnerLive } from "./services/SdkQueryRunner.js";
import { SubprocessLifecycleLive } from "./services/SubprocessLifecycle.js";
import { BackgroundTaskRegistryLive } from "./services/BackgroundTaskRegistry.js";
import { DispatchLockLive } from "./services/DispatchLock.js";
import { ToolPermissionsLive } from "./services/ToolPermissions.js";
import { PlanApprovalLive } from "./services/PlanApproval.js";
import { UsageServiceLive } from "./services/UsageService.js";
import { SlashCommandsLive } from "./services/SlashCommands.js";

// Build up the app layer incrementally using Layer.provideMerge.
// Pattern: Layer.provideMerge(newService, accumulatedLayer)
// The accumulated layer (second arg) provides its services to the new service
// (first arg), and the result exposes both — so each step adds one service
// without repeating dependency lists.

// Services with no cross-service dependencies
const BaseLayer = Layer.mergeAll(
  DatabaseLive,
  PtyManagerLive,
  BackgroundTaskRegistryLive,
  DispatchLockLive,
  ToolPermissionsLive,
  UsageServiceLive,
  SlashCommandsLive,
);

// SessionPersistence depends on Database (provided by BaseLayer)
const WithSessionPersistence = Layer.provideMerge(SessionPersistenceLive, BaseLayer);

// EventBroadcaster depends on SessionPersistence
const WithEventBroadcaster = Layer.provideMerge(EventBroadcasterLive, WithSessionPersistence);

// CompletionActions depends on Database, SessionPersistence, EventBroadcaster
const WithCompletionActions = Layer.provideMerge(CompletionActionsLive, WithEventBroadcaster);

// PlanApproval depends on Database, SessionPersistence, EventBroadcaster
const WithPlanApproval = Layer.provideMerge(PlanApprovalLive, WithCompletionActions);

// SdkQueryRunner depends on Database, SessionPersistence, EventBroadcaster, CompletionActions, BackgroundTaskRegistry
const WithSdkQueryRunner = Layer.provideMerge(SdkQueryRunnerLive, WithPlanApproval);

// SubprocessLifecycle depends on Database, SessionPersistence, EventBroadcaster, SdkQueryRunner
export const AppLayer = Layer.provideMerge(SubprocessLifecycleLive, WithSdkQueryRunner);

export const AppRuntime = ManagedRuntime.make(AppLayer);
