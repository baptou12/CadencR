/**
 * Reject empty names, names containing path separators, and `.` / `..`.
 *
 * Same rule the backend enforces in
 * `domain/editor/mutation_routes.rs::validate_simple_name`. Failing fast in
 * the UI avoids a round-trip; the backend remains the source of truth.
 *
 * Returns `null` on success, or a user-facing error string.
 */
export function validateSimpleName(name: string): string | null {
  if (!name.trim()) return "Name cannot be empty";
  if (name.includes("/") || name.includes("\\")) return "Name cannot contain '/' or '\\'";
  if (name === "." || name === "..") return "Invalid name";
  return null;
}
