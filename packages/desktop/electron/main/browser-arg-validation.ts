import type { BrowserBounds } from "./browser-types";

export function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Expected ${label}.`);
  return value;
}

export function requiredNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Expected ${label}.`);
  return value;
}

export function parseBounds(value: unknown): BrowserBounds {
  if (!value || typeof value !== "object") throw new Error("Expected browser bounds.");
  const record = value as Record<string, unknown>;
  return {
    x: requiredNumber(record.x, "x"),
    y: requiredNumber(record.y, "y"),
    width: requiredNumber(record.width, "width"),
    height: requiredNumber(record.height, "height"),
  };
}

export function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Expected ${label}.`);
  return value as Record<string, unknown>;
}
