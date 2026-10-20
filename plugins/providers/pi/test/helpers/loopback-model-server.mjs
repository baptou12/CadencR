import { createHash } from "node:crypto";
import { createServer } from "node:http";

const MAX_BODY = 256 * 1024;
const MAX_TURNS = 16;

// A local wire fixture, never a model implementation: each response is scripted.
export async function startLoopbackModelServer({ turns }) {
  if (
    !Array.isArray(turns) ||
    turns.length > MAX_TURNS ||
    turns.some(
      (turn) =>
        typeof turn?.text !== "string" ||
        turn.text.length > 16_384 ||
        (turn.holdOpen !== undefined && typeof turn.holdOpen !== "boolean"),
    )
  ) {
    throw new Error("Expected at most 16 bounded scripted turns");
  }
  const script = turns.map((turn) => ({ ...turn }));
  const requests = [];
  const failures = [];
  const sockets = new Set();
  const server = createServer((request, response) => {
    void handleRequest(request, response, script, requests, failures).catch(() => {
      if (failures.length < 32) failures.push({ status: 400 });
      if (!response.headersSent) refuse(response, 400);
      else response.destroy();
    });
  });
  server.requestTimeout = 5_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 100;
  server.maxHeadersCount = 32;
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.setTimeout(10_000, () => socket.destroy());
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  let closing;
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    requests,
    failures,
    close() {
      closing ??= new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        for (const socket of sockets) socket.destroy();
      });
      return closing;
    },
  };
}

function refuse(response, status) {
  response.writeHead(status, { "Content-Type": "application/json", Connection: "close" });
  response.end(JSON.stringify({ error: "Loopback fixture refused request" }));
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  const timer = setTimeout(() => request.destroy(), 5_000);
  try {
    for await (const chunk of request.iterator({ destroyOnReturn: false })) {
      size += chunk.length;
      if (size > MAX_BODY) return null;
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    clearTimeout(timer);
  }
}

function summarize(body) {
  if (
    typeof body?.model !== "string" ||
    body.model.length > 256 ||
    body.stream !== true ||
    !Array.isArray(body.messages) ||
    body.messages.length > 128
  ) {
    return null;
  }
  const messages = [];
  for (const message of body.messages) {
    if (!["system", "developer", "user", "assistant", "tool"].includes(message?.role)) return null;
    const content = JSON.stringify(message.content ?? null);
    messages.push({
      role: message.role,
      contentLength: content.length,
      contentSha256: createHash("sha256").update(content).digest("hex"),
    });
  }
  return { model: body.model, messages, closed: false, aborted: false };
}

async function handleRequest(request, response, script, requests, failures) {
  const reject = (status) => {
    if (failures.length < 32) failures.push({ status });
    return refuse(response, status);
  };
  if (request.url !== "/v1/chat/completions") return reject(404);
  if (request.method !== "POST") return reject(405);
  const body = await readBody(request);
  if (body === null) return reject(413);
  const metadata = summarize(body);
  if (!metadata) return reject(400);
  if (requests.length >= script.length) return reject(409);
  const turn = script[requests.length];
  requests.push(metadata);
  response.once("close", () => {
    metadata.closed = true;
    metadata.aborted = !response.writableFinished;
  });
  response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
  const chunk = (delta, finishReason = null, usage) => {
    response.write(
      `data: ${JSON.stringify({
        id: `loopback-${requests.length}`,
        object: "chat.completion.chunk",
        created: 0,
        model: metadata.model,
        choices: [{ index: 0, delta, finish_reason: finishReason }],
        ...(usage ? { usage } : {}),
      })}\n\n`,
    );
  };
  chunk({ role: "assistant", content: "" });
  chunk({ content: turn.text });
  if (turn.holdOpen) return;
  chunk({}, "stop", { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 });
  response.end("data: [DONE]\n\n");
}
