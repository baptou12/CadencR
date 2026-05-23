/**
 * Server-initiated `window/showMessage` and `window/logMessage` handlers.
 *
 * `@codemirror/lsp-client`'s defaults render `window/showMessage` as a
 * banner at the top of the editor buffer (the same `showDialog` it uses
 * for `Find definition failed`) and dumps `window/logMessage` to the
 * console with no user-visible feedback. Cadencr's convention is sonner
 * toasts, so we intercept both and route by LSP severity.
 *
 * Returning `true` from a handler tells the library "we handled it, skip
 * the default", which is the whole point: keep the buffer chrome clean.
 */
import { toast } from "sonner";

/** Subset of LSP 3.17 we read from these notifications. */
interface ShowMessageParams {
  /** 1=Error 2=Warning 3=Info 4=Log 5=Debug. */
  type: number;
  message: string;
}

const enum MessageType {
  Error = 1,
  Warning = 2,
  Info = 3,
  Log = 4,
  Debug = 5,
}

/** Show via toast, picking severity from the LSP type. */
export function showLspMessage(params: ShowMessageParams): void {
  const { type, message } = params;
  switch (type) {
    case MessageType.Error:
      toast.error(message);
      return;
    case MessageType.Warning:
      toast.warning(message);
      return;
    case MessageType.Info:
      toast.info(message);
      return;
    default:
      // Log / Debug from `showMessage` are rare; route to info rather than
      // silently swallow so the user still sees them.
      toast(message);
  }
}

/**
 * Build the `notificationHandlers` object for `LSPClient`. The library
 * tries these before its own defaults and skips the defaults when we
 * return `true`.
 */
export function buildLspNotificationHandlers(): Record<
  string,
  (client: unknown, params: unknown) => boolean
> {
  return {
    "window/showMessage": (_client, params) => {
      const p = params as ShowMessageParams;
      if (typeof p?.message !== "string") return false;
      showLspMessage(p);
      return true;
    },
    "window/logMessage": (_client, params) => {
      const p = params as ShowMessageParams;
      if (typeof p?.message !== "string") return false;
      // logMessage is the diagnostic-traffic channel — rust-analyzer
      // produces a lot, so we keep it console-only by default. Errors get
      // a toast too because they often signal something the user needs to
      // act on (config issue, missing toolchain, etc.).
      if (p.type === MessageType.Error) toast.error(p.message);
      else console.debug("[lsp]", p.message);
      return true;
    },
  };
}
