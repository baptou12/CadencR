import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { rust } from "@codemirror/lang-rust";
import { markdown } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import { python } from "@codemirror/lang-python";
import { go } from "@codemirror/lang-go";
import { sql } from "@codemirror/lang-sql";
import { StreamLanguage } from "@codemirror/language";
import { less as lessMode, sCSS } from "@codemirror/legacy-modes/mode/css";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import type { Extension } from "@codemirror/state";
import { getFileExtension, isDockerfilePath } from "@/lib/file-language";
import { astroSyntax } from "./astro-syntax";

export { getFileExtension };

export function isMarkdownFile(filePath: string): boolean {
  const ext = getFileExtension(filePath);
  return ext === "md" || ext === "mdx";
}

export function getLanguageName(filePath: string): string {
  if (isDockerfilePath(filePath)) return "Dockerfile";
  const ext = getFileExtension(filePath);
  return LANGUAGE_NAMES[ext] ?? "Plain Text";
}

const LANGUAGE_NAMES: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TSX",
  js: "JavaScript",
  jsx: "JSX",
  json: "JSON",
  jsonc: "JSONC",
  html: "HTML",
  htm: "HTML",
  css: "CSS",
  scss: "SCSS",
  less: "LESS",
  svelte: "Svelte",
  vue: "Vue",
  astro: "Astro",
  rs: "Rust",
  md: "Markdown",
  mdx: "MDX",
  yaml: "YAML",
  yml: "YAML",
  toml: "TOML",
  py: "Python",
  go: "Go",
  sql: "SQL",
  sh: "Shell",
  bash: "Shell",
  zsh: "Shell",
};

export function getLanguageExtension(filePath: string): Extension | null {
  if (isDockerfilePath(filePath)) return StreamLanguage.define(dockerFile);
  const ext = getFileExtension(filePath);

  switch (ext) {
    case "ts":
    case "tsx":
      return javascript({ typescript: true, jsx: true });
    case "js":
    case "jsx":
      return javascript({ jsx: true });
    case "json":
    case "jsonc":
      return json();
    case "html":
    case "htm":
    case "svelte":
    case "vue":
      return html();
    case "astro":
      return [html({ selfClosingTags: true }), astroSyntax()];
    case "css":
      return css();
    case "scss":
      return StreamLanguage.define(sCSS);
    case "less":
      return StreamLanguage.define(lessMode);
    case "rs":
      return rust();
    case "md":
    case "mdx":
      return markdown();
    case "yaml":
    case "yml":
      return yaml();
    case "toml":
      return StreamLanguage.define(toml);
    case "py":
      return python();
    case "go":
      return go();
    case "sql":
      return sql();
    case "sh":
    case "bash":
    case "zsh":
      return StreamLanguage.define(shell);
    default:
      return null;
  }
}
