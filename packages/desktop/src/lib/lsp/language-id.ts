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

import {
  detectEditorLanguageId,
  getEditorLspLanguageId,
  type EditorLanguageId,
} from "@/lib/editor-language";

/**
 * Returns the LSP `languageId` for `filePath`, or `null` if the file is not
 * covered. An explicit editor language takes precedence over the detected
 * file type so syntax highlighting and language tooling switch together.
 *
 * @public
 */
export function getLspLanguageId(
  filePath: string,
  editorLanguageId?: EditorLanguageId,
): string | null {
  return getEditorLspLanguageId(editorLanguageId ?? detectEditorLanguageId(filePath));
}
