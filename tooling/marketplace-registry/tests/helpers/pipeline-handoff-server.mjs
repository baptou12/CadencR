// Test-only HTTP fake; archived legacy evidence replaces executable legacy publishing.
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { startGitHubFixture } from "./github-server.mjs";
import { loadCapture } from "../../../../packages/registry-publisher/src/pipeline/handoff/rebase.mjs";

const cleanup = [];
const { state, url } = await startGitHubFixture(
  { after: (fn) => cleanup.push(fn) },
  "handoff-token",
  {
    repository: "cadencr/registry",
    branch: "main",
    inlineAssets: true,
  },
);
state.strictTags = true;
state.sourceArchives.set(
  "/public/acme/provider/releases/download/v1/provider.tgz",
  Buffer.from("archive"),
);
async function control(input) {
  if (input.action === "configure") {
    state.publicUnavailable = input.publicUnavailable ?? false;
    state.rawUnavailable = input.rawUnavailable ?? false;
    if (input.retireSources) state.sourceArchives.clear();
  }
  if (input.action === "load") {
    const { remote: captured, result } = await loadCapture(input);
    const revive = (bytes) => (Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.data));
    delete captured.release; // Derived getter, not independent state.
    Object.assign(state, captured);
    state.tags = new Map(captured.tags);
    state.sourceArchives = new Map(
      captured.sourceArchives.map(([key, bytes]) => [key, revive(bytes)]),
    );
    state.assets = captured.assets.map((asset) => ({ ...asset, bytes: revive(asset.bytes) }));
    if (state.discovery) state.discovery.bytes = revive(state.discovery.bytes);
    return result;
  }
  return {
    writes: state.requests.filter((entry) => entry.method !== "GET").length,
    requests: state.requests,
    releases: state.releases.length,
    releaseRecords: state.releases,
    discovery: state.discovery
      ? {
          sha: state.discovery.sha,
          sha256: createHash("sha256").update(state.discovery.bytes).digest("hex"),
        }
      : null,
  };
}
const server = createServer(async (request, response) => {
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const result = await control(JSON.parse(Buffer.concat(chunks).toString()));
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(result));
  } catch (error) {
    response.writeHead(500);
    response.end(JSON.stringify({ error: error.message }));
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
console.log(JSON.stringify({ remote: url, control: `http://127.0.0.1:${server.address().port}` }));
const timeout = setTimeout(() => process.exit(2), 120_000);
process.once("SIGTERM", async () => {
  clearTimeout(timeout);
  server.closeAllConnections();
  server.close();
  for (const fn of cleanup) await fn();
  process.exit(0);
});
