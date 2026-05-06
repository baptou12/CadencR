export function rendererCsp(isPackaged: boolean): string {
  const scriptSrc = isPackaged
    ? "script-src 'self'"
    : "script-src 'self' 'unsafe-eval' 'unsafe-inline'";
  const connectSrc = isPackaged
    ? "connect-src 'self' http://127.0.0.1:5004 ws://127.0.0.1:5004"
    : "connect-src 'self' http://127.0.0.1:5004 http://127.0.0.1:5005 http://127.0.0.1:1420 ws://127.0.0.1:5004 ws://127.0.0.1:5005 ws://127.0.0.1:1420";
  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    connectSrc,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
  ].join("; ");
}
