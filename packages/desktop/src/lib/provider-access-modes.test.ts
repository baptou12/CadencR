import { describe, expect, it } from "vitest";
import { PROVIDER_IDS } from "@/lib/providers";
import { providerAccessModeConfig } from "@/lib/provider-access-modes";

describe("providerAccessModeConfig", () => {
  it("keeps Cursor and Codex defaults provider-scoped", () => {
    expect(providerAccessModeConfig(PROVIDER_IDS.CURSOR)?.settingKey).toBe("cursor_access_mode");
    expect(providerAccessModeConfig(PROVIDER_IDS.CODEX_CLI)?.settingKey).toBe(
      "codex_permission_mode",
    );
  });

  it("keeps labels provider-scoped and rejects unsupported providers", () => {
    expect(providerAccessModeConfig(PROVIDER_IDS.CURSOR)?.providerLabel).toBe("Cursor");
    expect(providerAccessModeConfig(PROVIDER_IDS.CODEX_CLI)?.providerLabel).toBe("Codex");
    expect(providerAccessModeConfig(PROVIDER_IDS.CLAUDE_CODE)).toBeNull();
  });
});
