import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Strip a base path prefix to produce a relative path for display. */
export function toRelativePath(filePath: string, basePath?: string): string {
  if (!basePath || !filePath.startsWith(basePath)) return filePath;
  return filePath.slice(basePath.endsWith("/") ? basePath.length : basePath.length + 1);
}
