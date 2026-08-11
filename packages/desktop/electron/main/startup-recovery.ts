import { copyFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export type StartupRecoveryActionId =
  | "download_latest"
  | "restore_backup"
  | "copy_diagnostics"
  | "quit";

export interface StartupRecoveryAction {
  id: StartupRecoveryActionId;
  label: string;
  primary?: boolean;
  danger?: boolean;
}

export interface BackupCandidate {
  path: string;
  modifiedMs: number;
}

export interface StartupRecoveryInput {
  appVersion: string;
  getDbPath: () => string;
  message: string;
  now: Date;
  platform: NodeJS.Platform | string;
}

export interface StartupRecoveryState {
  title: string;
  detail: string;
  actions: StartupRecoveryAction[];
  diagnostics: string;
  backup: BackupCandidate | null;
  dbPath: string | null;
}

export const NEWER_DATABASE_MARKER = "updated by a newer version of Cadencr";
export const NEWER_DATABASE_RECOVERY_TITLE = "Cadencr can't open this database safely";
export const NEWER_DATABASE_RECOVERY_DETAIL =
  "This database was updated by a newer version of Cadencr. Install the latest version to continue, or restore a pre-migration backup if you need to use this older version.";

export function isNewerDatabaseStartupFailure(message: string): boolean {
  return message.includes(NEWER_DATABASE_MARKER);
}

export function buildStartupRecovery(input: StartupRecoveryInput): StartupRecoveryState {
  const isNewerDatabase = isNewerDatabaseStartupFailure(input.message);
  const dbPath = isNewerDatabase ? input.getDbPath() : null;
  const backup = dbPath ? findLatestPreMigrationBackup(dbPath) : null;
  const title = isNewerDatabase ? NEWER_DATABASE_RECOVERY_TITLE : "Cadencr couldn't start";
  const detail = isNewerDatabase ? NEWER_DATABASE_RECOVERY_DETAIL : input.message;
  const actions: StartupRecoveryAction[] = [
    { id: "download_latest", label: "Download latest Cadencr", primary: true },
  ];
  if (backup) actions.push({ id: "restore_backup", label: "Restore backup…", danger: true });
  actions.push(
    { id: "copy_diagnostics", label: "Copy diagnostics" },
    { id: "quit", label: "Quit" },
  );

  return {
    title,
    detail,
    actions,
    diagnostics: buildDiagnostics(input, dbPath, backup),
    backup,
    dbPath,
  };
}

export function findLatestPreMigrationBackup(dbPath: string): BackupCandidate | null {
  const dir = path.dirname(dbPath);
  if (!existsSync(dir)) return null;
  const identity = databaseIdentity(dbPath);

  let latest: BackupCandidate | null = null;
  for (const name of readdirSync(dir)) {
    if (!isPreMigrationBackupName(name, identity)) continue;
    const candidatePath = path.join(dir, name);
    const candidate = {
      path: candidatePath,
      modifiedMs: statSync(candidatePath).mtimeMs,
    };
    if (
      !latest ||
      candidate.modifiedMs > latest.modifiedMs ||
      (candidate.modifiedMs === latest.modifiedMs && candidate.path > latest.path)
    ) {
      latest = candidate;
    }
  }

  return latest;
}

function databaseIdentity(dbPath: string): string {
  return `db-${Buffer.from(path.basename(dbPath), "utf8").toString("hex")}`;
}

export function managedBackupFileName(dbPath: string, version: string, timestamp: string): string {
  return `${databaseIdentity(dbPath)}.${version}.${timestamp}.cadencr.backup.db`;
}

function isPreMigrationBackupName(name: string, expectedIdentity: string): boolean {
  const suffix = ".cadencr.backup.db";
  if (!name.endsWith(suffix)) return false;
  const stem = name.slice(0, -suffix.length);
  const identitySeparator = stem.indexOf(".");
  const timestampSeparator = stem.lastIndexOf(".");
  if (identitySeparator <= 0 || timestampSeparator <= identitySeparator) return false;
  const identity = stem.slice(0, identitySeparator);
  const version = stem.slice(identitySeparator + 1, timestampSeparator);
  const timestamp = stem.slice(timestampSeparator + 1);
  if (identity !== expectedIdentity) return false;
  if (!/^db-(?:[0-9a-f]{2})+$/.test(identity)) return false;
  if (!/^v?\d+(?:\.\d+){1,2}(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})$/.exec(timestamp);
  if (!match) return false;
  const [, , month, day, hour] = match;
  return (
    Number(month) >= 1 &&
    Number(month) <= 12 &&
    Number(day) >= 1 &&
    Number(day) <= 31 &&
    Number(hour) <= 23
  );
}

const ACTION_IDS = new Set<StartupRecoveryActionId>([
  "download_latest",
  "restore_backup",
  "copy_diagnostics",
  "quit",
]);

export function parseStartupRecoveryActionUrl(rawUrl: string): StartupRecoveryActionId | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "cadencr-splash:" || parsed.hostname !== "action") return null;
  const actionId = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  return ACTION_IDS.has(actionId as StartupRecoveryActionId)
    ? (actionId as StartupRecoveryActionId)
    : null;
}

export function restoreBackupOverDatabase(input: { dbPath: string; backupPath: string }): void {
  copyFileSync(input.backupPath, input.dbPath);
}

function buildDiagnostics(
  input: StartupRecoveryInput,
  dbPath: string | null,
  backup: BackupCandidate | null,
): string {
  return [
    "Cadencr startup failure diagnostics",
    `timestamp: ${input.now.toISOString()}`,
    `appVersion: ${input.appVersion}`,
    `platform: ${input.platform}`,
    `dbPath: ${dbPath ?? "unavailable"}`,
    `backupPath: ${backup?.path ?? "none"}`,
    "",
    "error:",
    input.message,
  ].join("\n");
}
