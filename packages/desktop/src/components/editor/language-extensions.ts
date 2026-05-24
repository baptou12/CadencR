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
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import type { Extension } from "@codemirror/state";

export function isMarkdownFile(filePath: string): boolean {
  const ext = filePath.split(".").at(-1)?.toLowerCase() ?? "";
  return ext === "md" || ext === "mdx";
}

export function getLanguageExtension(filePath: string): Extension | null {
  const ext = filePath.split(".").at(-1)?.toLowerCase() ?? "";

  switch (ext) {
    case "ts":
    case "tsx":
      return javascript({ typescript: true, jsx: true });
    case "js":
    case "jsx":
      return javascript({ jsx: true });
    case "json":
      return json();
    case "html":
      return html();
    case "css":
      return css();
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
