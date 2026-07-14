import { getFileExtension, isDockerfilePath, isEnvFilePath } from "@/lib/file-language";

export const EDITOR_LANGUAGES = [
  { id: "plaintext", label: "Plain Text", lspLanguageId: null },
  { id: "typescript", label: "TypeScript", lspLanguageId: "typescript" },
  { id: "typescriptreact", label: "TSX", lspLanguageId: "typescriptreact" },
  { id: "javascript", label: "JavaScript", lspLanguageId: "javascript" },
  { id: "javascriptreact", label: "JSX", lspLanguageId: "javascriptreact" },
  { id: "json", label: "JSON", lspLanguageId: "json" },
  { id: "jsonc", label: "JSONC", lspLanguageId: "jsonc" },
  { id: "html", label: "HTML", lspLanguageId: "html" },
  { id: "css", label: "CSS", lspLanguageId: "css" },
  { id: "scss", label: "SCSS", lspLanguageId: "scss" },
  { id: "less", label: "LESS", lspLanguageId: "less" },
  { id: "svelte", label: "Svelte", lspLanguageId: "svelte" },
  { id: "vue", label: "Vue", lspLanguageId: "vue" },
  { id: "astro", label: "Astro", lspLanguageId: "astro" },
  { id: "rust", label: "Rust", lspLanguageId: "rust" },
  { id: "markdown", label: "Markdown", lspLanguageId: null },
  { id: "mdx", label: "MDX", lspLanguageId: null },
  { id: "yaml", label: "YAML", lspLanguageId: "yaml" },
  { id: "toml", label: "TOML", lspLanguageId: null },
  { id: "python", label: "Python", lspLanguageId: "python" },
  { id: "go", label: "Go", lspLanguageId: "go" },
  { id: "sql", label: "SQL", lspLanguageId: null },
  { id: "shellscript", label: "Shell", lspLanguageId: "shellscript" },
  { id: "dockerfile", label: "Dockerfile", lspLanguageId: "dockerfile" },
  { id: "env", label: "Env", lspLanguageId: null },
] as const;

export type EditorLanguageId = (typeof EDITOR_LANGUAGES)[number]["id"];

const LANGUAGE_BY_ID = new Map(EDITOR_LANGUAGES.map((language) => [language.id, language]));

const EXTENSION_LANGUAGES: Readonly<Record<string, EditorLanguageId>> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "typescriptreact",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascriptreact",
  json: "json",
  jsonc: "jsonc",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  less: "less",
  svelte: "svelte",
  vue: "vue",
  astro: "astro",
  rs: "rust",
  md: "markdown",
  mdx: "mdx",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  py: "python",
  go: "go",
  sql: "sql",
  sh: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
};

export function isEditorLanguageId(value: unknown): value is EditorLanguageId {
  return typeof value === "string" && LANGUAGE_BY_ID.has(value as EditorLanguageId);
}

export function detectEditorLanguageId(filePath: string): EditorLanguageId {
  if (isDockerfilePath(filePath)) return "dockerfile";
  if (isEnvFilePath(filePath)) return "env";
  const extension = getFileExtension(filePath);
  return Object.hasOwn(EXTENSION_LANGUAGES, extension)
    ? EXTENSION_LANGUAGES[extension]
    : "plaintext";
}

export function getEditorLanguageLabel(languageId: EditorLanguageId): string {
  return LANGUAGE_BY_ID.get(languageId)?.label ?? "Plain Text";
}

export function getEditorLspLanguageId(languageId: EditorLanguageId): string | null {
  return LANGUAGE_BY_ID.get(languageId)?.lspLanguageId ?? null;
}
