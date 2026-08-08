import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildStartupRecovery,
  findLatestPreMigrationBackup,
  managedBackupFileName,
  restoreBackupOverDatabase,
} from "./startup-recovery";

describe("buildStartupRecovery", () => {
  it("returns install-focused actions for newer-database startup failures", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cadencr-no-backup-test-"));
    const dbPath = path.join(dir, "cadencr.db");
    writeFileSync(dbPath, "broken");
    const recovery = buildStartupRecovery({
      appVersion: "0.6.1",
      getDbPath: () => dbPath,
      message:
        "This database was updated by a newer version of Cadencr and cannot be opened safely by this older app.",
      now: new Date("2026-06-22T11:30:00.000Z"),
      platform: "darwin",
    });

    expect(recovery.title).toBe("Cadencr can't open this database safely");
    expect(recovery.detail).toContain("Install the latest version to continue");
    expect(recovery.actions.map((action) => action.id)).toEqual([
      "download_latest",
      "copy_diagnostics",
      "quit",
    ]);
    expect(recovery.actions.map((action) => action.label)).not.toContain("Open data folder");
    expect(recovery.diagnostics).toContain("appVersion: 0.6.1");
    expect(recovery.diagnostics).toContain(`dbPath: ${dbPath}`);
  });

  it("includes restore backup when a backup candidate exists", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cadencr-recovery-test-"));
    const dbPath = path.join(dir, "cadencr.db");
    const backupPath = path.join(dir, managedBackupFileName(dbPath, "0.6.0", "2026-06-22-10"));
    writeFileSync(dbPath, "broken");
    writeFileSync(backupPath, "backup");

    const recovery = buildStartupRecovery({
      appVersion: "0.6.1",
      getDbPath: () => dbPath,
      message:
        "This database was updated by a newer version of Cadencr and cannot be opened safely by this older app.",
      now: new Date("2026-06-22T11:30:00.000Z"),
      platform: "darwin",
    });

    expect(recovery.actions.map((action) => action.id)).toEqual([
      "download_latest",
      "restore_backup",
      "copy_diagnostics",
      "quit",
    ]);
    expect(recovery.backup?.path).toBe(backupPath);
  });

  it("does not touch the database path for generic startup failures", () => {
    const recovery = buildStartupRecovery({
      appVersion: "0.6.1",
      getDbPath: () => {
        throw new Error("db path should not be computed");
      },
      message: "Service failed before startup.",
      now: new Date("2026-06-22T11:30:00.000Z"),
      platform: "darwin",
    });

    expect(recovery.title).toBe("Cadencr couldn't start");
    expect(recovery.backup).toBeNull();
    expect(recovery.dbPath).toBeNull();
    expect(recovery.diagnostics).toContain("dbPath: unavailable");
  });
});

describe("findLatestPreMigrationBackup", () => {
  it("selects the newest cadencr backup beside the database", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cadencr-backups-test-"));
    const dbPath = path.join(dir, "cadencr.db");
    const oldBackup = path.join(dir, managedBackupFileName(dbPath, "0.6.0", "2026-06-22-08"));
    const newBackup = path.join(dir, managedBackupFileName(dbPath, "0.6.1", "2026-06-22-10"));
    writeFileSync(dbPath, "db");
    writeFileSync(oldBackup, "old");
    writeFileSync(newBackup, "new");

    expect(findLatestPreMigrationBackup(dbPath)?.path).toBe(newBackup);
  });

  it("ignores snapshot-like files without a generated version and timestamp", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cadencr-recovery-"));
    const dbPath = path.join(dir, "cadencr.db");
    writeFileSync(dbPath, "live");
    writeFileSync(path.join(dir, "notes.2026-06-22-10.cadencr.backup.db"), "not a backup");
    writeFileSync(path.join(dir, "0.6.0.not-a-date.cadencr.backup.db"), "not a backup");

    expect(findLatestPreMigrationBackup(dbPath)).toBeNull();
  });

  it("never offers another custom database's managed backup", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cadencr-scoped-backups-"));
    const firstDb = path.join(dir, "first.db");
    const secondDb = path.join(dir, "second.db");
    writeFileSync(firstDb, "first");
    writeFileSync(secondDb, "second");
    writeFileSync(
      path.join(dir, managedBackupFileName(secondDb, "0.6.1", "2026-06-22-10")),
      "second backup",
    );
    // A legacy backup has no source identity and is intentionally ambiguous.
    writeFileSync(path.join(dir, "0.6.0.2026-06-22-08.cadencr.backup.db"), "legacy");

    expect(findLatestPreMigrationBackup(firstDb)).toBeNull();
  });
});

describe("restoreBackupOverDatabase", () => {
  it("copies the backup over the database", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cadencr-restore-test-"));
    const dbPath = path.join(dir, "cadencr.db");
    const backupPath = path.join(dir, "0.6.0.2026-06-22-10.cadencr.backup.db");
    writeFileSync(dbPath, "broken");
    writeFileSync(backupPath, "backup");

    restoreBackupOverDatabase({ dbPath, backupPath });

    expect(readFileSync(dbPath, "utf8")).toBe("backup");
  });
});

describe("parseStartupRecoveryActionUrl", () => {
  it("extracts known splash action ids", async () => {
    const { parseStartupRecoveryActionUrl } = await import("./startup-recovery");

    expect(parseStartupRecoveryActionUrl("cadencr-splash://action/download_latest")).toBe(
      "download_latest",
    );
    expect(parseStartupRecoveryActionUrl("cadencr-splash://action/restore_backup")).toBe(
      "restore_backup",
    );
    expect(parseStartupRecoveryActionUrl("https://example.com")).toBeNull();
    expect(parseStartupRecoveryActionUrl("cadencr-splash://action/open_data_folder")).toBeNull();
  });
});
