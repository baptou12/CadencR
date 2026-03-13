import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { AppRuntime } from "./runtime.js";
import { DatabaseError } from "./errors.js";

describe("AppRuntime", () => {
  it("can run a simple Effect.succeed", async () => {
    const result = await AppRuntime.runPromise(Effect.succeed(42));
    expect(result).toBe(42);
  });

  it("resolves promises correctly", async () => {
    const result = await AppRuntime.runPromise(Effect.succeed("hello"));
    expect(result).toBe("hello");
  });

  it("propagates Effect errors as promise rejections", async () => {
    const error = new DatabaseError({ operation: "test", cause: "oops" });
    await expect(AppRuntime.runPromise(Effect.fail(error))).rejects.toThrow();
  });

  it("works with Effect.map", async () => {
    const result = await AppRuntime.runPromise(
      Effect.succeed(10).pipe(Effect.map((n) => n * 2))
    );
    expect(result).toBe(20);
  });
});
