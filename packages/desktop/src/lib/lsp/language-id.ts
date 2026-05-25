/**
 * Map a file path to the LSP `languageId` field used by `textDocument/didOpen`
 * and `LSPClient.plugin()`. Returns `null` for files we don't have LSP coverage
 * for — caller should skip LSP wiring rather than pick a default that the
 * server will reject.
 *
 * Kept data-driven so adding a new language is one row, not a code change in
 * generic call sites. See `.claude/rules/provider-boundaries.md`: never branch
 * on language identity in shared code; consult this table instead.
 */

import { getFileExtension, isDockerfilePath, isEnvFilePath } from "@/lib/file-language";

/** @public */
export const LSP_LANGUAGE_IDS = {
  ts: "typescript",
  tsx: "typescriptreact",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascriptreact",
  mjs: "javascript",
  cjs: "javascript",
  rs: "rust",
  py: "python",
  go: "go",
  json: "json",
  jsonc: "jsonc",
  yaml: "yaml",
  yml: "yaml",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  less: "less",
  svelte: "svelte",
  vue: "vue",
  astro: "astro",
  sh: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
  dockerfile: "dockerfile",
} as const;

/** @public */
export type SupportedExtension = keyof typeof LSP_LANGUAGE_IDS;

/**
 * Returns the LSP `languageId` for `filePath`, or `null` if the file is not
 * covered. Matches by lowercased extension only — kept intentionally
 * conservative; cmd-click on a `.md` or `.json` file should be a no-op rather
 * than spawn a server we can't speak to.
 *
 * @public
 */
export function getLspLanguageId(filePath: string): string | null {
  if (isDockerfilePath(filePath)) return "dockerfile";
  // Env files get shell *syntax highlighting* via `getLanguageExtension`,
  // but they're plain KEY=value data, not shell code: no LSP server has
  // anything useful to say about them. Returning null tells `useLsp` to
  // skip client acquisition entirely (otherwise we'd spawn — and fail —
  // the shellscript LSP every time the user opens `.env`).
  if (isEnvFilePath(filePath)) return null;
  const ext = getFileExtension(filePath);
  if (!isSupportedExtension(ext)) return null;
  return LSP_LANGUAGE_IDS[ext];
}

function isSupportedExtension(ext: string): ext is SupportedExtension {
  return ext in LSP_LANGUAGE_IDS;
}
