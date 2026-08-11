import { renderHook } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestQueryClient } from "@/test-utils";
import { CADENCR_DARK_THEME } from "@/lib/themes/cadencr-dark";
import { FROST_DARK_THEME } from "@/lib/themes/frost-dark";
import { DRACULA_THEME } from "@/lib/themes/dracula";
import type { ThemeDefinition } from "@/lib/themes";
import { useThemeLibraryActions } from "./useThemeLibraryActions";

const create = vi.hoisted(() => vi.fn());

vi.mock("@/api/generated", () => ({
  useCreateTheme: () => ({ mutate: create, isPending: false }),
  useDeleteTheme: () => ({ mutate: vi.fn() }),
  getListThemesQueryKey: () => ["/api/themes"],
}));
vi.mock("./useReleaseTheme", () => ({ useReleaseTheme: () => vi.fn() }));
// The CadencR and Frost tokens still live in a stylesheet, so duplicating one
// reads them off the live document — which jsdom has no stylesheets for. The
// colors are not what these tests are about; the chrome travelling with them is.
vi.mock("@/lib/themes/user-theme", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/themes/user-theme")>()),
  readThemeCssVars: () => ({}),
}));

function renderActions() {
  const client = createTestQueryClient();
  return renderHook(() => useThemeLibraryActions(), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

/** What the create request would carry for `source`. */
function payloadFor(source: ThemeDefinition, label = "Mine") {
  const { result } = renderActions();
  result.current.duplicate(source, label);
  return create.mock.calls[0][0].data;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("duplicating a theme", () => {
  it("carries the source's chassis and tab style, not just its colors", () => {
    // The bug this guards: a copy of CadencR Dark used to arrive without the
    // rail chassis and the segmented tabs, because both lived in a stylesheet
    // keyed on the theme id rather than in the theme.
    expect(payloadFor(CADENCR_DARK_THEME).chrome).toEqual(
      expect.objectContaining({ chassis: "rail", tabs: "segmented" }),
    );
  });

  it("carries the source's texture, so a copy of Frost still has a field behind it", () => {
    const texture = payloadFor(FROST_DARK_THEME).chrome.texture;

    expect(texture.base).toBeTruthy();
    expect(texture.halos.length).toBeGreaterThan(0);
    expect(texture.grain).not.toBeNull();
    expect(texture.veil).toBe(true);
  });

  it("gives a theme that declares no chrome the plain default rather than undefined", () => {
    expect(payloadFor(DRACULA_THEME).chrome).toEqual({
      chassis: "flat",
      tabs: "underline",
      texture: { base: null, halos: [], image: null, grain: null, veil: false },
    });
  });

  describe("texture assets", () => {
    const withImage: ThemeDefinition = {
      ...DRACULA_THEME,
      id: "user:papery",
      chrome: {
        chassis: "flat",
        tabs: "underline",
        texture: {
          base: null,
          halos: [],
          grain: null,
          veil: false,
          image: { asset: "paper.png", opacity: 0.2, blend: "multiply", fit: "tile", scale: 320 },
        },
      },
    };

    it("asks the backend to copy the source theme's files, by its on-disk id", () => {
      // The document names `paper.png`; the file itself lives in the source
      // theme's folder and has to be copied, or the copy renders nothing.
      expect(payloadFor(withImage).copyAssetsFrom).toBe("papery");
    });

    it("asks for nothing from a built-in, which has no folder to copy from", () => {
      expect(payloadFor(FROST_DARK_THEME).copyAssetsFrom).toBeUndefined();
    });
  });
});
