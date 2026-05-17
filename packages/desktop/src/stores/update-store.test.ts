import { beforeEach, describe, expect, it } from "vitest";
import { useUpdateStore } from "./update-store";

function resetStore(): void {
  useUpdateStore.setState({
    status: "idle",
    version: null,
    changelogMarkdown: null,
    changelogLoading: false,
    progress: 0,
    error: null,
  });
}

describe("update-store applyEvent", () => {
  beforeEach(resetStore);

  it("marks the changelog as loading while a new version is downloading", () => {
    useUpdateStore.getState().applyEvent({ kind: "available", version: "0.2.0" });
    const state = useUpdateStore.getState();
    expect(state).toMatchObject({
      status: "downloading",
      version: "0.2.0",
      changelogMarkdown: null,
      changelogLoading: true,
      progress: 0,
      error: null,
    });
  });

  it("stores the changelog markdown when it arrives for the current version", () => {
    useUpdateStore.getState().applyEvent({ kind: "available", version: "0.2.0" });
    useUpdateStore
      .getState()
      .applyEvent({ kind: "changelog", version: "0.2.0", markdown: "# v0.2.0\n- thing" });

    const state = useUpdateStore.getState();
    expect(state.changelogMarkdown).toBe("# v0.2.0\n- thing");
    expect(state.changelogLoading).toBe(false);
  });

  it("ignores stale changelog events for a different version", () => {
    useUpdateStore.getState().applyEvent({ kind: "available", version: "0.3.0" });
    useUpdateStore
      .getState()
      .applyEvent({ kind: "changelog", version: "0.2.0", markdown: "stale" });

    const state = useUpdateStore.getState();
    expect(state.changelogMarkdown).toBeNull();
    expect(state.changelogLoading).toBe(true);
    expect(state.version).toBe("0.3.0");
  });

  it("records a missing changelog (null) without losing version state", () => {
    useUpdateStore.getState().applyEvent({ kind: "available", version: "0.2.0" });
    useUpdateStore.getState().applyEvent({ kind: "changelog", version: "0.2.0", markdown: null });

    const state = useUpdateStore.getState();
    expect(state.changelogMarkdown).toBeNull();
    expect(state.changelogLoading).toBe(false);
    expect(state.version).toBe("0.2.0");
  });

  it("transitions to downloaded with progress=100 on the downloaded event", () => {
    useUpdateStore.getState().applyEvent({ kind: "available", version: "0.2.0" });
    useUpdateStore
      .getState()
      .applyEvent({ kind: "download-progress", percent: 42.7, bytesPerSecond: 1_000 });
    useUpdateStore.getState().applyEvent({ kind: "downloaded", version: "0.2.0" });

    const state = useUpdateStore.getState();
    expect(state.status).toBe("downloaded");
    expect(state.progress).toBe(100);
  });

  it("clears the error and marks up-to-date on not-available", () => {
    useUpdateStore.setState({ error: "old error", status: "error" });
    useUpdateStore.getState().applyEvent({ kind: "not-available", version: "0.1.2" });

    const state = useUpdateStore.getState();
    expect(state.status).toBe("up-to-date");
    expect(state.error).toBeNull();
    expect(state.version).toBe("0.1.2");
  });
});
