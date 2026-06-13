import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import {
  createBrowserProfile,
  isPersistentProfileId,
  type BrowserProfile,
} from "./browser-profiles";

interface PersistedProfiles {
  profiles: Array<{ id: string; label: string }>;
}

const BUILTIN_PROFILES: BrowserProfile[] = [
  createBrowserProfile("fresh", "fresh"),
  createBrowserProfile("feature", "feature"),
  createBrowserProfile("persistent", "default"),
];

export class BrowserProfileStore {
  constructor(private readonly filePath = defaultProfileStorePath()) {}

  list(): BrowserProfile[] {
    return [
      ...BUILTIN_PROFILES,
      ...this.read().profiles.map((profile) => ({ ...profile, mode: "persistent" as const })),
    ];
  }

  createPersistent(id: string): BrowserProfile {
    this.assertMutableId(id);
    const data = this.read();
    if (data.profiles.some((profile) => profile.id === id) || id === "default") {
      throw new Error(`Browser profile already exists: ${id}`);
    }
    data.profiles.push({ id, label: id });
    this.write(data);
    return createBrowserProfile("persistent", id);
  }

  duplicatePersistent(sourceId: string, newId: string): BrowserProfile {
    if (!this.list().some((profile) => profile.id === sourceId && profile.mode === "persistent")) {
      throw new Error(`Unknown browser profile: ${sourceId}`);
    }
    return this.createPersistent(newId);
  }

  deletePersistent(id: string): void {
    this.assertMutableId(id);
    if (id === "default") throw new Error("Cannot delete the default browser profile.");
    const data = this.read();
    const next = data.profiles.filter((profile) => profile.id !== id);
    if (next.length === data.profiles.length) throw new Error(`Unknown browser profile: ${id}`);
    this.write({ profiles: next });
  }

  private assertMutableId(id: string): void {
    if (!isPersistentProfileId(id)) throw new Error("Invalid browser profile id.");
    if (id === "fresh" || id === "feature")
      throw new Error(`Cannot modify built-in profile: ${id}`);
  }

  private read(): PersistedProfiles {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      if (
        !parsed ||
        typeof parsed !== "object" ||
        !Array.isArray((parsed as PersistedProfiles).profiles)
      ) {
        return { profiles: [] };
      }
      return { profiles: (parsed as PersistedProfiles).profiles.filter(isPersistedProfile) };
    } catch {
      return { profiles: [] };
    }
  }

  private write(data: PersistedProfiles): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
  }
}

function isPersistedProfile(value: unknown): value is { id: string; label: string } {
  return Boolean(
    value &&
    typeof value === "object" &&
    isPersistentProfileId((value as { id?: unknown }).id as string) &&
    typeof (value as { label?: unknown }).label === "string",
  );
}

function defaultProfileStorePath(): string {
  return path.join(app.getPath("userData"), "browser-profiles.json");
}
