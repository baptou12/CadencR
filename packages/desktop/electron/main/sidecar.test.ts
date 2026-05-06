import { describe, expect, it } from "vitest";
import { serviceArgs } from "./sidecar";

describe("sidecar process arguments", () => {
  it("does not expose the auth token on argv", () => {
    const args = serviceArgs("/tmp/cadencr.db");

    expect(args).toEqual(["--db-path", "/tmp/cadencr.db", "--port", "5004"]);
    expect(args).not.toContain("--auth-token");
  });
});
