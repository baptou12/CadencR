import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { AppRuntime, runEffect } from "./runtime.js";
import { DatabaseError } from "./errors.js";

describe("AppRuntime", () => {
  it("can run a simple Effect.succeed", async () => {
    const result = await AppRuntime.runPromise(Effect.succeed(42));
    expect(result).toBe(42);
  });

  it("runEffect helper resolves promises correctly", async () => {
    const result = await runEffect(Effect.succeed("hello"));
    expect(result).toBe("hello");
  });

  it("runEffect propagates Effect errors as promise rejections", async () => {
    const error = new DatabaseError({ operation: "test", cause: "oops" });
    await expect(runEffect(Effect.fail(error))).rejects.toThrow();
  });

  it("runEffect works with Effect.map", async () => {
    const result = await runEffect(
      Effect.succeed(10).pipe(Effect.map((n) => n * 2))
    );
    expect(result).toBe(20);
  });
});
