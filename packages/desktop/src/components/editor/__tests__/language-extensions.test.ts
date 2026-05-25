import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { highlightTree, classHighlighter } from "@lezer/highlight";
import { describe, it, expect } from "vitest";
import { getLanguageExtension, getLanguageName } from "../language-extensions";

describe("getLanguageExtension", () => {
  const supported = [
    "file.ts",
    "file.tsx",
    "file.js",
    "file.jsx",
    "file.json",
    "file.jsonc",
    "file.html",
    "file.htm",
    "file.css",
    "file.scss",
    "file.less",
    "file.svelte",
    "file.vue",
    "file.astro",
    "file.rs",
    "file.md",
    "file.yaml",
    "file.yml",
    "file.py",
    "file.go",
    "file.sql",
    "file.sh",
    "file.bash",
    "file.zsh",
    "file.toml",
    "Dockerfile",
    "services/api.Dockerfile",
    ".env",
    ".env.local",
    ".env.production.local",
    "local.env",
    "development.env",
    "API.ENV",
  ];

  for (const file of supported) {
    it(`returns a non-null extension for ${file}`, () => {
      expect(getLanguageExtension(file)).not.toBeNull();
    });
  }

  it("returns null for unknown extension", () => {
    expect(getLanguageExtension("file.xyz")).toBeNull();
    expect(getLanguageExtension("file.abc123")).toBeNull();
  });

  it("handles unsupported files with no extension", () => {
    expect(getLanguageExtension("Makefile")).toBeNull();
  });

  it("does not treat unrelated files as env", () => {
    // `env` (no extension) and `env.txt` shouldn't trigger env-file
    // detection — only filenames with `.env` as a real segment.
    expect(getLanguageExtension("env")).toBeNull();
    expect(getLanguageExtension("env.txt")).toBeNull();
    // `environment.json` is a JSON file, not an env file.
    expect(getLanguageName("environment.json")).toBe("JSON");
  });
});

function highlightClassesFor(filePath: string, doc: string): string[] {
  const extension = getLanguageExtension(filePath);
  if (!extension) return [];
  const state = EditorState.create({ doc, extensions: [extension] });
  const tree = ensureSyntaxTree(state, doc.length, 1_000) ?? syntaxTree(state);
  const classes = new Set<string>();
  highlightTree(tree, classHighlighter, (_from, _to, classesForToken) => {
    for (const className of classesForToken.split(" ")) classes.add(className);
  });
  return [...classes];
}

describe("rich syntax highlighting", () => {
  it("highlights Astro frontmatter as TypeScript instead of YAML/plain text", () => {
    const extension = getLanguageExtension("file.astro");
    expect(extension).not.toBeNull();
    const view = new EditorView({
      doc: "---\nconst title = 'Hi';\n---\n<h1>{title}</h1>\n",
      extensions: [extension!],
    });

    expect(view.dom.querySelector(".cm-astro-keyword")?.textContent).toBe("const");
    expect(view.dom.querySelector(".cm-astro-string")?.textContent).toBe("'Hi'");
    expect(
      [...view.dom.querySelectorAll(".cm-astro-variable")].filter(
        (node) => node.textContent === "title",
      ),
    ).toHaveLength(2);
    expect(view.dom.querySelector(".cm-astro-frontmatter-delimiter")?.textContent).toContain("---");
    view.destroy();
  });

  it("highlights YAML keys", () => {
    expect(highlightClassesFor("file.yaml", "name: test\n")).toContain("tok-propertyName");
  });
});

describe("getLanguageName", () => {
  it("labels new LSP-backed file types", () => {
    expect(getLanguageName("file.jsonc")).toBe("JSONC");
    expect(getLanguageName("file.scss")).toBe("SCSS");
    expect(getLanguageName("file.svelte")).toBe("Svelte");
    expect(getLanguageName("file.vue")).toBe("Vue");
    expect(getLanguageName("file.astro")).toBe("Astro");
    expect(getLanguageName("services/api.Dockerfile")).toBe("Dockerfile");
    expect(getLanguageName("Dockerfile.prod")).toBe("Dockerfile");
  });

  it("labels env files", () => {
    expect(getLanguageName(".env")).toBe("Env");
    expect(getLanguageName(".env.local")).toBe("Env");
    expect(getLanguageName(".env.production.local")).toBe("Env");
    expect(getLanguageName("local.env")).toBe("Env");
    expect(getLanguageName("development.env")).toBe("Env");
    expect(getLanguageName("API.ENV")).toBe("Env");
    expect(getLanguageName("env.txt")).toBe("Plain Text");
  });
});
