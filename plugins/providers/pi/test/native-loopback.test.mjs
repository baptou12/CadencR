import test from "node:test";
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, realpath, access } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { serializeJsonLine } from "../src/jsonl.mjs";
import { qaClient, stopChild } from "../scripts/qa-client.mjs";
import { startLoopbackModelServer } from "./helpers/loopback-model-server.mjs";

const command = process.env.CADENCR_PI_NATIVE_TEST_COMMAND;
const provider = process.env.CADENCR_PI_NATIVE_TEST_PROVIDER;
const enabled = command !== undefined || provider !== undefined;
const model = "cadencr-loopback-fixture/deterministic";
const initialize = {
  protocolVersion: 1,
  clientCapabilities: {},
  clientInfo: { name: "loopback-conformance", version: "1" },
};

// No scratch, child, or listener is created unless BOTH explicit executable paths are supplied.
test(
  "actual Pi loopback-model protocol qualification (not external auth or managed feed)",
  {
    skip:
      !enabled &&
      "requires CADENCR_PI_NATIVE_TEST_COMMAND and CADENCR_PI_NATIVE_TEST_PROVIDER absolute paths",
    timeout: 90_000,
  },
  async (t) => {
    validateNativePaths(command, provider);
    for (const executable of [command, provider]) {
      try {
        await access(executable, constants.X_OK);
      } catch {
        throw new Error("explicit native executable is unavailable or not executable");
      }
    }
    const scratch = await mkdtemp(join(tmpdir(), "pi-native-loopback-"));
    const home = join(scratch, "home");
    const agent = join(scratch, "agent");
    const workspace = join(scratch, "workspace");
    const sessions = join(scratch, "sessions");
    const temporary = join(scratch, "tmp");
    await Promise.all([home, agent, workspace, sessions, temporary].map((path) => mkdir(path)));
    const fixture = await startLoopbackModelServer({
      turns: [
        { text: "LOOPBACK_FIRST" },
        { text: "LOOPBACK_RESUMED" },
        { text: "LOOPBACK_HELD", holdOpen: true },
      ],
    });
    let active;
    let stage = "isolated configuration";
    try {
      // Allowlist only: never inherit credentials, proxy settings, personal HOME, or native defaults.
      const env = {
        PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
        HOME: home,
        TMPDIR: temporary,
        PI_CODING_AGENT_DIR: agent,
        PI_SKIP_VERSION_CHECK: "1",
        CADENCR_PI_COMMAND: await realpath(command),
      };
      const args = [
        "--provider",
        "cadencr-loopback-fixture",
        "--model",
        "deterministic",
        "--no-skills",
        "--no-prompt-templates",
        "--session-dir",
        sessions,
      ];
      await writeFile(
        join(agent, "models.json"),
        JSON.stringify({
          providers: {
            "cadencr-loopback-fixture": {
              api: "openai-completions",
              baseUrl: fixture.baseUrl,
              apiKey: "inert-loopback-placeholder",
              models: [
                {
                  id: "deterministic",
                  reasoning: false,
                  input: ["text"],
                  contextWindow: 32768,
                  maxTokens: 512,
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                },
              ],
            },
          },
        }),
      );
      const start = () => {
        const child = spawn(provider, ["run", "--protocol", "acp-v1", ...args], {
          cwd: workspace,
          env,
          stdio: ["pipe", "pipe", "pipe"],
        });
        const client = qaClient(child, { timeoutMs: 20_000 });
        return {
          ...client,
          notify(method, params) {
            child.stdin.write(serializeJsonLine({ jsonrpc: "2.0", method, params }));
          },
          async stop() {
            try {
              await stopChild(child);
            } finally {
              client.dispose();
            }
          },
        };
      };
      stage = "Pi version verification";
      const version = await promisify(execFile)(command, ["--version"], {
        cwd: workspace,
        env,
        timeout: 15_000,
        maxBuffer: 4096,
      });
      assert.equal(version.stdout.trim(), "0.85.1", "native qualification requires Pi 0.85.1");
      stage = "model discovery";
      const discovery = await promisify(execFile)(
        provider,
        ["models", "--format", "acp-config-options-v1", "--cwd", workspace, ...args],
        { cwd: workspace, env, timeout: 15_000, maxBuffer: 1024 * 1024 },
      );
      const catalog = JSON.parse(discovery.stdout);
      assert.deepEqual(
        catalog[0].options.map((option) => option.value),
        [model],
      );
      assert.equal(fixture.requests.length, 0, "discovery must not prompt the endpoint");
      stage = "ACP initialize and session creation";
      active = start();
      const initialized = await active.request("initialize", initialize);
      assert.ok(initialized.agentCapabilities?.sessionCapabilities?.resume);
      const session = await active.request("session/new", { cwd: workspace, mcpServers: [] });
      assert.equal(
        session.configOptions.find((option) => option.category === "model").currentValue,
        model,
      );
      const memory = "Remember synthetic loopback context C7N4.";
      stage = "first streamed turn and usage";
      const firstTurnOffset = active.updates.length;
      await completeTurn(active, session.sessionId, memory, "LOOPBACK_FIRST");
      const usage = active.updates
        .slice(firstTurnOffset)
        .find((update) => update.sessionUpdate === "usage_update");
      assert.ok(usage, "fixture-provided native usage must reach ACP");
      assert.equal(
        usage.used,
        2,
        "native first-turn context usage must include both fixture tokens",
      );
      assert.equal(usage.size, 32768, "native usage must preserve the synthetic context window");
      assert.equal(usage._meta?.pi?.tokens?.input, 1, "native input usage must match the fixture");
      assert.equal(
        usage._meta?.pi?.tokens?.output,
        1,
        "native output usage must match the fixture",
      );
      assert.equal(active.permissions.length, 0, "first inert turn must never request model tools");
      await active.stop();
      active = null;
      stage = "durable resume initialization";
      active = start();
      await active.request("initialize", initialize);
      stage = "durable resume";
      const resumed = await active.request("session/resume", {
        sessionId: session.sessionId,
        cwd: workspace,
        mcpServers: [],
      });
      assert.equal(
        resumed.configOptions.find((option) => option.category === "model").currentValue,
        model,
      );
      await completeTurn(
        active,
        session.sessionId,
        "Continue synthetic context.",
        "LOOPBACK_RESUMED",
      );
      const oldUser = fixture.requests[0].messages.find((message) => message.role === "user");
      assert.ok(oldUser);
      assert.ok(
        fixture.requests[1].messages.some(
          (message) => message.role === "user" && message.contentSha256 === oldUser.contentSha256,
        ),
        "resumed native request must retain first user context",
      );
      assert.ok(
        fixture.requests[1].messages.some((message) => message.role === "assistant"),
        "resumed request must retain assistant context",
      );
      const assistantDigests = ["LOOPBACK_FIRST", [{ type: "text", text: "LOOPBACK_FIRST" }]].map(
        (content) => createHash("sha256").update(JSON.stringify(content)).digest("hex"),
      );
      assert.ok(
        fixture.requests[1].messages.some(
          (message) =>
            message.role === "assistant" && assistantDigests.includes(message.contentSha256),
        ),
        "resume must preserve the exact prior synthetic assistant content",
      );
      stage = "held-stream cancellation";
      const offset = active.updates.length;
      const pending = active.request("session/prompt", {
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: "Wait for cancellation." }],
      });
      // Attach rejection handling immediately, including assertion-failure teardown paths.
      const outcome = pending.then(
        (result) => ({ result }),
        (error) => ({ error }),
      );
      await waitFor(() => textSince(active, offset).includes("LOOPBACK_HELD"));
      const cancelledAt = performance.now();
      active.notify("session/cancel", { sessionId: session.sessionId });
      const cancelled = await outcome;
      assert.ok(
        performance.now() - cancelledAt < 3000,
        "cancel must complete before the fixture idle timeout",
      );
      assert.equal(cancelled.error, undefined);
      assert.equal(cancelled.result.stopReason, "cancelled");
      await waitFor(() => fixture.requests[2]?.aborted === true, 3000);
      assert.equal(active.permissions.length, 0, "inert fixture must never request model tools");
      assert.equal(fixture.requests.length, 3);
      assert.deepEqual(fixture.failures, []);
      t.diagnostic(
        "Passed: discovery, initialize, new, streamed text/end_turn/usage, durable restart/resume context, held-stream cancellation; 3 loopback requests. Scratch retained.",
      );
    } catch (error) {
      // Native stderr and ACP responses are not public diagnostic artifacts.
      throw new Error(
        `Native loopback qualification failed during ${stage} (${error.code ?? error.name})`,
      );
    } finally {
      try {
        await active?.stop();
      } finally {
        await fixture.close();
      }
    }
  },
);

function textSince(client, offset) {
  return client.updates
    .slice(offset)
    .filter((update) => update?.sessionUpdate === "agent_message_chunk")
    .map((update) => update.content?.text ?? "")
    .join("");
}

async function completeTurn(client, sessionId, prompt, expected) {
  const offset = client.updates.length;
  const result = await client.request("session/prompt", {
    sessionId,
    prompt: [{ type: "text", text: prompt }],
  });
  assert.equal(result.stopReason, "end_turn");
  assert.equal(textSince(client, offset), expected);
}

async function waitFor(predicate, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, "native loopback condition timed out");
    await delay(20);
  }
}

function validateNativePaths(nativeCommand, nativeProvider) {
  if (nativeCommand === undefined && nativeProvider === undefined) return false;
  for (const path of [nativeCommand, nativeProvider]) {
    assert.ok(
      typeof path === "string" && isAbsolute(path),
      "both native opt-in variables must be absolute executable paths",
    );
  }
  return true;
}

test("native opt-in refuses partial and nonabsolute paths without side effects", () => {
  assert.equal(validateNativePaths(undefined, undefined), false);
  for (const paths of [
    ["/pi", undefined],
    [undefined, "/provider"],
    ["pi", "/provider"],
    ["/pi", "provider"],
    ["", ""],
  ]) {
    assert.throws(() => validateNativePaths(...paths), /both native opt-in variables/);
  }
  assert.equal(validateNativePaths("/pi", "/provider"), true);
});
