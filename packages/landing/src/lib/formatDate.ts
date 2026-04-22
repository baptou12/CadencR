export function formatDate(
  d: Date,
  opts: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "numeric",
  },
): string {
  return d.toLocaleDateString("en-US", opts);
}
