import { describe, it, expect, vi, beforeEach } from "vitest";
import { Cause, Effect, Exit, Option } from "effect";
import { PtyManager, PtyManagerLive } from "./PtyManager.js";
import { PtyNotFound } from "../errors.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("node-pty", () => ({ spawn: vi.fn() }));
import * as nodePty from "node-pty";
const mockSpawn = vi.mocked(nodePty.spawn);

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [] },
}));

// ---------------------------------------------------------------------------
// Mock PTY factory
// ---------------------------------------------------------------------------

interface MockPty {
  onData: ReturnType<typeof vi.fn>;
  onExit: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
  _triggerExit: (exitCode: number, signal?: number) => void;
}

function createMockPty(): MockPty {
  const exitCallbacks: ((ev: { exitCode: number; signal?: number }) => void)[] = [];
  return {
    onData: vi.fn(),
    onExit: vi.fn().mockImplementation((cb: (ev: { exitCode: number; signal?: number }) => void) => {
      exitCallbacks.push(cb);
    }),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    _triggerExit: (exitCode, signal) => exitCallbacks.forEach((cb) => cb({ exitCode, signal })),
  };
}

// ---------------------------------------------------------------------------
// Test helper — run an effect inside a fresh PtyManager scope
// ---------------------------------------------------------------------------

function runWithPtyManager<A>(eff: Effect.Effect<A, unknown, PtyManager>): Promise<A> {
  return Effect.runPromise(Effect.scoped(Effect.provide(eff, PtyManagerLive)));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PtyManager service — PtyManagerLive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------
  describe("create", () => {
    it("registers the PTY in the internal map (hasRunning becomes true)", async () => {
      const mockPty = createMockPty();
      mockSpawn.mockReturnValue(mockPty as unknown as nodePty.IPty);

      const result = await runWithPtyManager(
        Effect.flatMap(PtyManager, (pm) =>
          Effect.gen(function* () {
            yield* pm.create("t1", 1, "/tmp");
            return yield* pm.hasRunning();
          }),
        ),
      );

      expect(result).toBe(true);
    });

    it("kills existing PTY with same ID before creating a new one", async () => {
      const first = createMockPty();
      const second = createMockPty();
      mockSpawn.mockReturnValueOnce(first as unknown as nodePty.IPty).mockReturnValueOnce(second as unknown as nodePty.IPty);

      await runWithPtyManager(
        Effect.flatMap(PtyManager, (pm) =>
          Effect.gen(function* () {
            yield* pm.create("t1", 1, "/tmp");
            yield* pm.create("t1", 1, "/tmp"); // same id
          }),
        ),
      );

      expect(first.kill).toHaveBeenCalledOnce();
      expect(mockSpawn).toHaveBeenCalledTimes(2);
    });

    it("uses the provided shell path when given", async () => {
      const mockPty = createMockPty();
      mockSpawn.mockReturnValue(mockPty as unknown as nodePty.IPty);

      await runWithPtyManager(
        Effect.flatMap(PtyManager, (pm) => pm.create("t1", 1, "/tmp", "/bin/fish")),
      );

      expect(mockSpawn).toHaveBeenCalledWith("/bin/fish", expect.any(Array), expect.any(Object));
    });
  });

  // -------------------------------------------------------------------------
  // kill
  // -------------------------------------------------------------------------
  describe("kill", () => {
    it("removes the PTY from the map", async () => {
      const mockPty = createMockPty();
      mockSpawn.mockReturnValue(mockPty as unknown as nodePty.IPty);

      const hasRunning = await runWithPtyManager(
        Effect.flatMap(PtyManager, (pm) =>
          Effect.gen(function* () {
            yield* pm.create("t1", 1, "/tmp");
            yield* pm.kill("t1");
            return yield* pm.hasRunning();
          }),
        ),
      );

      expect(mockPty.kill).toHaveBeenCalledOnce();
      expect(hasRunning).toBe(false);
    });

    it("is a no-op when the PTY does not exist", async () => {
      await expect(
        runWithPtyManager(Effect.flatMap(PtyManager, (pm) => pm.kill("nonexistent"))),
      ).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // write / resize — PtyNotFound errors
  // -------------------------------------------------------------------------
  describe("write", () => {
    it("writes data to an existing PTY", async () => {
      const mockPty = createMockPty();
      mockSpawn.mockReturnValue(mockPty as unknown as nodePty.IPty);

      await runWithPtyManager(
        Effect.flatMap(PtyManager, (pm) =>
          Effect.gen(function* () {
            yield* pm.create("t1", 1, "/tmp");
            yield* pm.write("t1", "hello");
          }),
        ),
      );

      expect(mockPty.write).toHaveBeenCalledWith("hello");
    });

    it("fails with PtyNotFound when PTY does not exist", async () => {
      // Use Exit to inspect the typed error without unwrapping FiberFailure
      const exit = await Effect.runPromise(
        Effect.exit(
          Effect.scoped(Effect.provide(Effect.flatMap(PtyManager, (pm) => pm.write("missing", "hi")), PtyManagerLive)),
        ),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const errOpt = Cause.failureOption(exit.cause);
        expect(Option.isSome(errOpt)).toBe(true);
        expect((Option.getOrNull(errOpt) as PtyNotFound)?._tag).toBe("PtyNotFound");
      }
    });
  });

  describe("resize", () => {
    it("resizes an existing PTY", async () => {
      const mockPty = createMockPty();
      mockSpawn.mockReturnValue(mockPty as unknown as nodePty.IPty);

      await runWithPtyManager(
        Effect.flatMap(PtyManager, (pm) =>
          Effect.gen(function* () {
            yield* pm.create("t1", 1, "/tmp");
            yield* pm.resize("t1", 120, 40);
          }),
        ),
      );

      expect(mockPty.resize).toHaveBeenCalledWith(120, 40);
    });

    it("fails with PtyNotFound when PTY does not exist", async () => {
      // Use Exit to inspect the typed error without unwrapping FiberFailure
      const exit = await Effect.runPromise(
        Effect.exit(
          Effect.scoped(
            Effect.provide(Effect.flatMap(PtyManager, (pm) => pm.resize("missing", 80, 24)), PtyManagerLive),
          ),
        ),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const errOpt = Cause.failureOption(exit.cause);
        expect(Option.isSome(errOpt)).toBe(true);
        expect((Option.getOrNull(errOpt) as PtyNotFound)?._tag).toBe("PtyNotFound");
      }
    });
  });

  // -------------------------------------------------------------------------
  // killAllForFeature
  // -------------------------------------------------------------------------
  describe("killAllForFeature", () => {
    it("kills only PTYs belonging to the specified feature", async () => {
      const pty1 = createMockPty();
      const pty2 = createMockPty();
      const pty3 = createMockPty();
      mockSpawn
        .mockReturnValueOnce(pty1 as unknown as nodePty.IPty)
        .mockReturnValueOnce(pty2 as unknown as nodePty.IPty)
        .mockReturnValueOnce(pty3 as unknown as nodePty.IPty);

      // hasRunning is checked INSIDE the scope (before the finalizer runs)
      const stillRunningAfterKill = await runWithPtyManager(
        Effect.flatMap(PtyManager, (pm) =>
          Effect.gen(function* () {
            yield* pm.create("t1", 10, "/tmp"); // feature 10
            yield* pm.create("t2", 20, "/tmp"); // feature 20
            yield* pm.create("t3", 10, "/tmp"); // feature 10
            yield* pm.killAllForFeature(10);
            return yield* pm.hasRunning(); // checked before scope/finalizer closes
          }),
        ),
      );

      // pty1 and pty3 (feature 10) killed by killAllForFeature and removed from map.
      // pty2 (feature 20) killed only by the scope finalizer (still in map at that point).
      expect(pty1.kill).toHaveBeenCalledOnce();
      expect(pty3.kill).toHaveBeenCalledOnce();
      // pty2 is still alive inside scope (feature 20 was not targeted)
      expect(stillRunningAfterKill).toBe(true);
      // After scope closes, finalizer kills pty2 exactly once
      expect(pty2.kill).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // hasRunning
  // -------------------------------------------------------------------------
  describe("hasRunning", () => {
    it("returns false when no PTYs are running", async () => {
      const result = await runWithPtyManager(
        Effect.flatMap(PtyManager, (pm) => pm.hasRunning()),
      );
      expect(result).toBe(false);
    });

    it("returns true when at least one PTY is running", async () => {
      const mockPty = createMockPty();
      mockSpawn.mockReturnValue(mockPty as unknown as nodePty.IPty);

      const result = await runWithPtyManager(
        Effect.flatMap(PtyManager, (pm) =>
          Effect.gen(function* () {
            yield* pm.create("t1", 1, "/tmp");
            return yield* pm.hasRunning();
          }),
        ),
      );
      expect(result).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Scope finalizer — kills all PTYs on scope close
  // -------------------------------------------------------------------------
  describe("scope finalizer", () => {
    it("kills all running PTYs when the scope closes", async () => {
      const pty1 = createMockPty();
      const pty2 = createMockPty();
      mockSpawn
        .mockReturnValueOnce(pty1 as unknown as nodePty.IPty)
        .mockReturnValueOnce(pty2 as unknown as nodePty.IPty);

      // Create two PTYs and let the scope close
      await Effect.runPromise(
        Effect.scoped(
          Effect.provide(
            Effect.flatMap(PtyManager, (pm) =>
              Effect.gen(function* () {
                yield* pm.create("t1", 1, "/tmp");
                yield* pm.create("t2", 2, "/tmp");
                // Scope will close here, triggering the finalizer
              }),
            ),
            PtyManagerLive,
          ),
        ),
      );

      expect(pty1.kill).toHaveBeenCalled();
      expect(pty2.kill).toHaveBeenCalled();
    });

    it("does not kill PTYs that were already killed before scope closes", async () => {
      const mockPty = createMockPty();
      mockSpawn.mockReturnValue(mockPty as unknown as nodePty.IPty);

      await Effect.runPromise(
        Effect.scoped(
          Effect.provide(
            Effect.flatMap(PtyManager, (pm) =>
              Effect.gen(function* () {
                yield* pm.create("t1", 1, "/tmp");
                yield* pm.kill("t1"); // explicitly killed before scope closes
              }),
            ),
            PtyManagerLive,
          ),
        ),
      );

      // kill() is called once by pm.kill("t1"); finalizer has empty map
      expect(mockPty.kill).toHaveBeenCalledTimes(1);
    });
  });
});
