import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { startLoopbackModelServer } from "./helpers/loopback-model-server.mjs";

const body = {
  model: "fixture-model",
  stream: true,
  messages: [{ role: "user", content: "fixture" }],
};
const post = (server, value = body) =>
  fetch(`${server.baseUrl}/chat/completions`, {
    method: "POST",
    body: typeof value === "string" ? value : JSON.stringify(value),
  });

async function waitFor(predicate) {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, "fixture state timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("loopback emits complete OpenAI SSE and retains only bounded metadata", async () => {
  const server = await startLoopbackModelServer({ turns: [{ text: "scripted answer" }] });
  try {
    assert.match(server.baseUrl, /^http:\/\/127\.0\.0\.1:\d+\/v1$/);
    const response = await post(server);
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.match(text, /"role":"assistant"/);
    assert.match(text, /"content":"scripted answer"/);
    assert.match(text, /"finish_reason":"stop"/);
    assert.match(text, /"total_tokens":2/);
    assert.ok(text.endsWith("data: [DONE]\n\n"));
    await waitFor(() => server.requests[0]?.closed);
    assert.deepEqual(server.requests, [
      {
        model: body.model,
        messages: [
          {
            role: "user",
            contentLength: 9,
            contentSha256: createHash("sha256").update('"fixture"').digest("hex"),
          },
        ],
        closed: true,
        aborted: false,
      },
    ]);
    assert.deepEqual(server.failures, []);
  } finally {
    await server.close();
    await server.close();
  }
});

test("held stream emits content before tracking client cancellation", async () => {
  const server = await startLoopbackModelServer({ turns: [{ text: "waiting", holdOpen: true }] });
  const controller = new AbortController();
  try {
    const response = await fetch(`${server.baseUrl}/chat/completions`, {
      method: "POST",
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const reader = response.body.getReader();
    const { value } = await reader.read();
    assert.match(new TextDecoder().decode(value), /waiting/);
    controller.abort();
    await assert.rejects(reader.read());
    await waitFor(() => server.requests[0]?.aborted);
    assert.equal(server.requests[0].closed, true);
  } finally {
    controller.abort();
    await server.close();
  }
});

test("fixture refuses wrong routes, methods, bodies and extra turns", async () => {
  const server = await startLoopbackModelServer({ turns: [] });
  try {
    assert.equal((await fetch(`${server.baseUrl}/wrong`)).status, 404);
    assert.equal((await fetch(`${server.baseUrl}/chat/completions`)).status, 405);
    assert.equal((await post(server, "x".repeat(256 * 1024 + 1))).status, 413);
    assert.equal((await post(server, {})).status, 400);
    assert.equal((await post(server, "not json")).status, 400);
    assert.equal((await post(server)).status, 409);
    assert.deepEqual(
      server.failures.map(({ status }) => status),
      [404, 405, 413, 400, 400, 409],
    );
    assert.deepEqual(server.requests, []);
  } finally {
    await server.close();
  }
});

test("owner close terminates held connections and refuses future connections", async () => {
  const server = await startLoopbackModelServer({ turns: [{ text: "held", holdOpen: true }] });
  const response = await post(server);
  const reading = response.text();
  await server.close();
  await assert.rejects(reading);
  await server.close();
  await assert.rejects(post(server));
  assert.equal(server.requests[0].aborted, true);
});

test("fixture bounds scripted turns before binding", async () => {
  await assert.rejects(startLoopbackModelServer({ turns: Array(17).fill({ text: "x" }) }));
  await assert.rejects(startLoopbackModelServer({ turns: [{ text: "x".repeat(16_385) }] }));
});
