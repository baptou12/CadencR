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

// SessionPersistenceLive depends on Database, so we provide DatabaseLive to it
const SessionPersistenceWithDb = Layer.provide(SessionPersistenceLive, DatabaseLive);

// PlanApprovalLive depends on Database, SessionPersistence, and EventBroadcaster
const PlanApprovalWithDeps = Layer.provide(
  PlanApprovalLive,
  Layer.mergeAll(DatabaseLive, SessionPersistenceWithDb, Layer.provide(EventBroadcasterLive, SessionPersistenceWithDb)),
);

// EventBroadcasterLive now depends on SessionPersistence (to look up session DB IDs)
const EventBroadcasterWithDeps = Layer.provide(EventBroadcasterLive, SessionPersistenceWithDb);

// CompletionActionsLive depends on SessionPersistence, EventBroadcaster, and Database
const CompletionActionsWithDeps = Layer.provide(
  CompletionActionsLive,
  Layer.mergeAll(SessionPersistenceWithDb, EventBroadcasterWithDeps, DatabaseLive),
);

// SdkQueryRunnerLive depends on SessionPersistence, EventBroadcaster, Database, CompletionActions, BackgroundTaskRegistry
const SdkQueryRunnerWithDeps = Layer.provide(
  SdkQueryRunnerLive,
  Layer.mergeAll(
    SessionPersistenceWithDb,
    EventBroadcasterWithDeps,
    DatabaseLive,
    CompletionActionsWithDeps,
    BackgroundTaskRegistryLive,
  ),
);

// SubprocessLifecycleLive depends on SdkQueryRunner, SessionPersistence, EventBroadcaster, Database
const SubprocessLifecycleWithDeps = Layer.provide(
  SubprocessLifecycleLive,
  Layer.mergeAll(
    SdkQueryRunnerWithDeps,
    SessionPersistenceWithDb,
    EventBroadcasterWithDeps,
    DatabaseLive,
  ),
);

export const AppLayer = Layer.mergeAll(
  DatabaseLive,
  PtyManagerLive,
  SessionPersistenceWithDb,
  EventBroadcasterWithDeps,
  CompletionActionsWithDeps,
  SdkQueryRunnerWithDeps,
  SubprocessLifecycleWithDeps,
  BackgroundTaskRegistryLive,
  DispatchLockLive,
  ToolPermissionsLive,
  PlanApprovalWithDeps,
  UsageServiceLive,
  SlashCommandsLive,
);

export const AppRuntime = ManagedRuntime.make(AppLayer);
