import { desktopBridge, type RendererErrorReportPayload } from "./desktop-bridge";

type ReportRendererError = (payload: RendererErrorReportPayload) => Promise<void>;

const MAX_ERROR_REPORTS = 20;
type ReactErrorSource = "react-boundary" | "react-uncaught" | "react-recoverable";

export function installGlobalRendererErrorHandlers(
  report: ReportRendererError = defaultReportRendererError,
): () => void {
  let reports = 0;
  const reportGlobalError = (payload: RendererErrorReportPayload): void => {
    if (reports >= MAX_ERROR_REPORTS) return;
    reports += 1;
    reportSafely(report, payload);
  };
  const onError = (event: ErrorEvent): void => {
    reportGlobalError(toRendererErrorPayload(event));
  };
  const onUnhandledRejection = (event: PromiseRejectionEvent): void => {
    reportGlobalError(toRendererErrorPayload(event));
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
  };
}

export function toRendererErrorPayload(
  event: ErrorEvent | PromiseRejectionEvent,
): RendererErrorReportPayload {
  if (event instanceof ErrorEvent) {
    const error = errorFromUnknown(event.error);
    return {
      source: "error",
      message: event.message || error.message,
      stack: error.stack,
      url: event.filename || window.location.href,
      line: event.lineno || null,
      column: event.colno || null,
    };
  }

  const error = errorFromUnknown(event.reason);
  return {
    source: "unhandledrejection",
    message: error.message,
    stack: error.stack,
    url: window.location.href,
    line: null,
    column: null,
  };
}

export const reportReactBoundaryError = createReactErrorReporter();

export function createReactErrorReporter(report: ReportRendererError = defaultReportRendererError) {
  let reports = 0;
  const pending = new WeakMap<object, RendererErrorReportPayload>();
  return (
    error: unknown,
    componentStack: string | null,
    source: ReactErrorSource = "react-boundary",
  ): void => {
    const boundaryError =
      source === "react-boundary" && typeof error === "object" && error !== null ? error : null;
    const previous = boundaryError ? pending.get(boundaryError) : undefined;
    if (previous) {
      // Consolidate the root hook and componentDidCatch before persisting. Keep
      // the fuller stack even when the reporting budget has just been exhausted.
      if ((componentStack?.trim().length ?? 0) > (previous.componentStack?.trim().length ?? 0))
        previous.componentStack = componentStack;
      return;
    }
    if (reports >= MAX_ERROR_REPORTS) return;
    reports += 1;
    const normalized = errorFromUnknown(error);
    const payload: RendererErrorReportPayload = {
      source,
      message: normalized.message,
      stack: normalized.stack,
      componentStack,
      url: window.location.href,
      line: null,
      column: null,
    };
    if (!boundaryError) return reportSafely(report, payload);
    pending.set(boundaryError, payload);
    queueMicrotask(() => {
      pending.delete(boundaryError);
      reportSafely(report, payload);
    });
  };
}

function defaultReportRendererError(payload: RendererErrorReportPayload): Promise<void> {
  return desktopBridge.reportRendererError(payload);
}

function errorFromUnknown(value: unknown): { message: string; stack: string | null } {
  if (value instanceof Error) {
    return { message: value.message || String(value), stack: value.stack ?? null };
  }
  return { message: stringifyUnknown(value), stack: null };
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function reportSafely(report: ReportRendererError, payload: RendererErrorReportPayload): void {
  void report(payload).catch((error: unknown) => {
    console.error("Failed to persist renderer error:", error);
  });
}
