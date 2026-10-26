export interface RendererErrorReportPayload {
  source:
    | "error"
    | "unhandledrejection"
    | "react-boundary"
    | "react-uncaught"
    | "react-recoverable";
  message: string;
  stack?: string | null;
  componentStack?: string | null;
  url?: string | null;
  line?: number | null;
  column?: number | null;
}
