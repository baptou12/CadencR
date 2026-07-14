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
import { getFileExtension, isMarkdownFile } from "@/lib/file-language";
import { detectEditorLanguageId, type EditorLanguageId } from "@/lib/editor-language";
import { astroSyntax } from "./astro-syntax";

// Re-exported so existing editor imports keep working — the canonical
// home for these helpers is `@/lib/file-language`.
export { getFileExtension, isMarkdownFile };

export function getLanguageExtension(
  filePath: string,
  languageId?: EditorLanguageId,
): Extension | null {
  switch (languageId ?? detectEditorLanguageId(filePath)) {
    case "typescript":
      return javascript({ typescript: true, jsx: true });
    case "typescriptreact":
      return javascript({ typescript: true, jsx: true });
    case "javascript":
    case "javascriptreact":
      return javascript({ jsx: true });
    case "json":
    case "jsonc":
      return json();
    case "html":
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
    case "rust":
      return rust();
    case "markdown":
    case "mdx":
      return markdown();
    case "yaml":
      return yaml();
    case "toml":
      return StreamLanguage.define(toml);
    case "python":
      return python();
    case "go":
      return go();
    case "sql":
      return sql();
    case "shellscript":
    case "env":
      return StreamLanguage.define(shell);
    case "dockerfile":
      return StreamLanguage.define(dockerFile);
    case "plaintext":
    default:
      return null;
  }
}
