import { describe, expect, it } from "vitest";
import { parsePhaseLine, serviceArgs } from "./sidecar";

describe("sidecar process arguments", () => {
  it("does not expose the auth token on argv", () => {
    const args = serviceArgs("/tmp/cadencr.db");

    expect(args).toEqual(["--db-path", "/tmp/cadencr.db", "--port", "5004"]);
    expect(args).not.toContain("--auth-token");
  });

  it("appends --app-version when provided", () => {
    const args = serviceArgs("/tmp/cadencr.db", "1.2.3");

    expect(args).toEqual([
      "--db-path",
      "/tmp/cadencr.db",
      "--port",
      "5004",
      "--app-version",
      "1.2.3",
    ]);
  });
});

describe("parsePhaseLine", () => {
  it("recognizes backing_up with a path detail", () => {
    expect(parsePhaseLine("CADENCR_PHASE backing_up /home/u/.cadencr/database/foo.db")).toEqual({
      phase: "backing_up",
      detail: "/home/u/.cadencr/database/foo.db",
    });
  });

  it("recognizes migrating with no detail", () => {
    expect(parsePhaseLine("CADENCR_PHASE migrating")).toEqual({
      phase: "migrating",
      detail: undefined,
    });
  });

  it("recognizes backup_failed with reason", () => {
    expect(parsePhaseLine("CADENCR_PHASE backup_failed disk full")).toEqual({
      phase: "backup_failed",
      detail: "disk full",
    });
  });

  it("ignores unrelated log lines", () => {
    expect(parsePhaseLine("INFO cadencr_service: listening")).toBeNull();
    expect(parsePhaseLine("CADENCR_PHASE bogus")).toBeNull();
  });
});
