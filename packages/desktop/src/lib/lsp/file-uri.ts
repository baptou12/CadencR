/**
 * Convert between absolute filesystem paths and `file://` URIs as required by
 * LSP. Centralised because LSPs are extremely picky about URI shape (trailing
 * slashes on directories, percent-encoding) and getting it wrong silently
 * breaks `textDocument/definition` results.
 */

/** @public */
export function pathToFileUri(absPath: string): string {
  // Encode each path segment so that spaces and non-ASCII characters become
  // valid URI components, but keep the leading slashes that LSP expects.
  const parts = absPath.split("/").map((seg) => encodeURIComponent(seg));
  return `file://${parts.join("/")}`;
}

/**
 * Parse a `file://` URI back to an absolute path. Returns `null` for URIs we
 * don't recognise rather than throwing — callers (cmd-click handlers) should
 * surface that as "can't navigate" rather than crash.
 *
 * @public
 */
export function fileUriToPath(uri: string): string | null {
  if (!uri.startsWith("file://")) return null;
  const after = uri.slice("file://".length);
  const path = after.startsWith("/") ? after : `/${after}`;
  try {
    return path
      .split("/")
      .map((seg) => decodeURIComponent(seg))
      .join("/");
  } catch {
    return null;
  }
}
