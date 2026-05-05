import { isAxiosError } from "axios";

interface ApiErrorBody {
  error?: unknown;
}

export function apiErrorMessage(err: unknown, fallback: string): string {
  const backendMessage = backendErrorMessage(err);
  if (backendMessage) return backendMessage;
  if (err instanceof Error && err.message.trim().length > 0) return err.message;
  return fallback;
}

function backendErrorMessage(err: unknown): string | null {
  if (!isAxiosError(err)) return null;
  const data = err.response?.data;
  if (typeof data === "string") {
    const trimmed = data.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (!isApiErrorBody(data)) return null;
  const error = data.error;
  return typeof error === "string" && error.trim().length > 0 ? error : null;
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return typeof value === "object" && value !== null;
}
