import type { z } from "zod";
import type { rendererErrorSchema } from "./renderer-diagnostics";

export type RendererErrorReportPayload = z.input<typeof rendererErrorSchema>;

export function normalizeRendererError(value: unknown): { message: string; stack: string | null } {
  if (value instanceof Error) {
    return { message: value.message || String(value), stack: value.stack ?? null };
  }
  if (typeof value === "string") return { message: value, stack: null };
  try {
    return { message: JSON.stringify(value) ?? String(value), stack: null };
  } catch {
    return { message: String(value), stack: null };
  }
}
