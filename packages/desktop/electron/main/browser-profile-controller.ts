import { session } from "electron";
import { profileFromSelection } from "./browser-manager-utils";
import { BrowserProfileStore } from "./browser-profile-store";
import { browserPartitionForProfile } from "./browser-profiles";
import type { BrowserProfileMetadata } from "./browser-types";

// Profile CRUD plus per-profile storage clearing. Kept out of BrowserManager
// (which orchestrates tabs/sessions) because profiles are an orthogonal concern
// only the IPC layer touches.
export class BrowserProfileController {
  constructor(private readonly store = new BrowserProfileStore()) {}

  list(): BrowserProfileMetadata[] {
    return this.store.list();
  }

  create(profileId: string): BrowserProfileMetadata {
    return this.store.createPersistent(profileId);
  }

  duplicate(sourceId: string, newId: string): BrowserProfileMetadata {
    return this.store.duplicatePersistent(sourceId, newId);
  }

  delete(profileId: string): void {
    this.store.deletePersistent(profileId);
  }

  async clearStorage(profileId: string): Promise<void> {
    const profile = profileFromSelection(profileId);
    const partition = browserPartitionForProfile(profile);
    const targetSession = session.fromPartition(partition);
    await targetSession.clearStorageData();
    await targetSession.clearCache();
  }
}
