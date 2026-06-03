import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen } from "@/test-utils";
import { LspServerList } from "./LspServerList";

type ListResult = {
  data: { servers: unknown[] } | undefined;
  isLoading: boolean;
  error: Error | null;
};

let mockResult: ListResult = { data: undefined, isLoading: true, error: null };

vi.mock("@/api/generated", async () => {
  const actual = await vi.importActual<typeof import("@/api/generated")>("@/api/generated");
  return {
    ...actual,
    useListLspServers: vi.fn(() => mockResult),
  };
});

describe("LspServerList", () => {
  it("shows a loading skeleton while fetching", () => {
    mockResult = { data: undefined, isLoading: true, error: null };
    render(<LspServerList />);
    // Skeleton must be present (per `explicit-state.md`). The "Language
    // servers" heading now lives on the wrapping SettingsCard, not here.
    const skeleton = document.querySelector("[aria-busy='true']");
    expect(skeleton).not.toBeNull();
  });

  it("filters rows by language or server name", async () => {
    mockResult = {
      data: {
        servers: [
          {
            lsp_id: "typescript-language-server",
            bin_name: "typescript-language-server",
            language_ids: ["typescript", "typescriptreact"],
            status: "on_path",
            path: "/opt/homebrew/bin/typescript-language-server",
            version: "4.3.3",
            downloadable: false,
          },
          {
            lsp_id: "rust-analyzer",
            bin_name: "rust-analyzer",
            language_ids: ["rust"],
            status: "missing",
            path: null,
            version: null,
            downloadable: true,
          },
        ],
      },
      isLoading: false,
      error: null,
    };
    const user = userEvent.setup();
    render(<LspServerList />);
    await user.type(screen.getByRole("textbox", { name: /search language servers/i }), "rust");
    expect(screen.getByText("rust-analyzer")).toBeInTheDocument();
    expect(screen.queryByText("typescript-language-server")).not.toBeInTheDocument();
  });

  it("surfaces fetch errors verbatim", () => {
    mockResult = {
      data: undefined,
      isLoading: false,
      error: new Error("offline"),
    };
    render(<LspServerList />);
    expect(screen.getByText("offline")).toBeInTheDocument();
  });

  it("renders one row per server with status and language ids", () => {
    mockResult = {
      data: {
        servers: [
          {
            lsp_id: "typescript-language-server",
            bin_name: "typescript-language-server",
            language_ids: ["typescript", "typescriptreact"],
            status: "on_path",
            path: "/opt/homebrew/bin/typescript-language-server",
            version: "4.3.3",
            downloadable: false,
          },
          {
            lsp_id: "rust-analyzer",
            bin_name: "rust-analyzer",
            language_ids: ["rust"],
            status: "missing",
            path: null,
            version: null,
            downloadable: true,
          },
        ],
      },
      isLoading: false,
      error: null,
    };
    render(<LspServerList />);
    expect(screen.getByText("typescript-language-server")).toBeInTheDocument();
    expect(screen.getByText("v4.3.3")).toBeInTheDocument();
    expect(screen.getByText("Installed (PATH)")).toBeInTheDocument();
    expect(screen.getByText("typescript, typescriptreact")).toBeInTheDocument();
    expect(screen.getByText("/opt/homebrew/bin/typescript-language-server")).toBeInTheDocument();

    expect(screen.getByText("rust-analyzer")).toBeInTheDocument();
    // Downloadable + missing → "auto-install" affordance label.
    expect(screen.getByText("Will auto-install on first use")).toBeInTheDocument();
  });

  it("distinguishes managed installs from on-path installs", () => {
    mockResult = {
      data: {
        servers: [
          {
            lsp_id: "rust-analyzer",
            bin_name: "rust-analyzer",
            language_ids: ["rust"],
            status: "managed",
            path: "/home/u/.cadencr/lsp/rust-analyzer/2025-05-19/rust-analyzer",
            version: "2025-05-19",
            downloadable: true,
          },
        ],
      },
      isLoading: false,
      error: null,
    };
    render(<LspServerList />);
    expect(screen.getByText("Managed install")).toBeInTheDocument();
    expect(screen.getByText("v2025-05-19")).toBeInTheDocument();
  });
});
