import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BrowserProfileStore } from "./browser-profile-store";

describe("BrowserProfileStore", () => {
  it("starts with built-in fresh, feature, and default persistent profiles", () => {
    const store = new BrowserProfileStore(tempFile());

    expect(store.list().map((profile) => profile.id)).toEqual(["fresh", "feature", "default"]);
  });

  it("creates and persists named persistent profiles", () => {
    const file = tempFile();
    const store = new BrowserProfileStore(file);
    store.createPersistent("dev-login");

    expect(new BrowserProfileStore(file).list().map((profile) => profile.id)).toContain(
      "dev-login",
    );
  });

  it("duplicates and deletes persistent profiles without deleting defaults", () => {
    const store = new BrowserProfileStore(tempFile());
    store.duplicatePersistent("default", "copy");
    store.deletePersistent("copy");

    expect(store.list().map((profile) => profile.id)).not.toContain("copy");
    expect(() => store.deletePersistent("default")).toThrow("default");
  });
});

function tempFile(): string {
  return path.join(mkdtempSync(path.join(os.tmpdir(), "browser-profiles-")), "profiles.json");
}
