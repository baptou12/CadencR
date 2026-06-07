import { useEffect, useRef, useState, type ReactElement } from "react";
import { QRCodeSVG } from "qrcode.react";
import { CheckCircle2, Loader2, QrCode, RefreshCw } from "lucide-react";
import { remotePairingCode, type PairingCodeResponse } from "@/api/generated";
import { isPairingCodeResponse } from "@/lib/remote/validate";
import { cn } from "@/lib/utils";
import { useRemoteStore } from "@/stores/remote-store";
import { CopyIconButton, SectionHeading } from "./remote-ui";

// While a live code is on screen, re-poll status so we notice the moment a
// device pairs with it (the code is single-use, so the QR is then dead).
const USED_POLL_MS = 3000;

/**
 * Mint a short-lived, single-use pairing code and present it as a QR + link.
 * The QR encodes the connect URL (which carries the code) — never a device
 * token. The host offers every reachable address (each LAN interface, plus the
 * tunnel host when configured); the user picks which one the QR points at. The
 * code is held only in this component's state and expires on a countdown, after
 * which the QR is cleared so it can't be scanned stale. Whether the paired
 * device stays signed in is decided on that device, not here.
 */
export function RemotePairSection(): ReactElement {
  const [code, setCode] = useState<PairingCodeResponse | null>(null);
  const [minting, setMinting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [selected, setSelected] = useState(0);
  const [used, setUsed] = useState(false);
  const autoMinted = useRef(false);
  // Guards the consumed signal against a stale status snapshot left over from a
  // *previous* code: we only trust "consumed" once we've seen this code reported
  // "pending" at least once. Reset on every mint.
  const sawPending = useRef(false);

  const refresh = useRemoteStore((s) => s.refresh);
  const pairingState = useRemoteStore((s) => s.status?.pairing_state);

  const mint = async (): Promise<void> => {
    setMinting(true);
    setError(null);
    setUsed(false);
    sawPending.current = false;
    try {
      const result = await remotePairingCode();
      if (!isPairingCodeResponse(result)) throw new Error("Malformed pairing-code response.");
      setCode(result);
      setSelected(0);
      setRemaining(result.expires_in_secs);
      // Pull status now so the store reflects this fresh code as "pending"
      // promptly (the 3s poll alone could otherwise miss it before a fast scan).
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create a pairing code.");
      setCode(null);
    } finally {
      setMinting(false);
    }
  };

  // Pairing is the dialog's primary action, so mint a code on mount and show
  // the QR straight away — no extra click. The ref guards against React Strict
  // Mode's double-invoke (which would otherwise burn a second single-use code).
  useEffect(() => {
    if (autoMinted.current) return;
    autoMinted.current = true;
    void mint();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  // Tick the countdown; drop the code at zero so a stale QR can't be scanned.
  useEffect(() => {
    if (!code) return;
    if (remaining <= 0) {
      setCode(null);
      return;
    }
    const timer = setTimeout(() => setRemaining((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [code, remaining]);

  // Poll status while a live code is shown so we can detect it being consumed.
  useEffect(() => {
    if (!code || used) return;
    const id = setInterval(() => void refresh(), USED_POLL_MS);
    return () => clearInterval(id);
  }, [code, used, refresh]);

  // The host reports the current code's lifecycle directly. Once we've observed
  // it "pending" (so we're not reacting to a prior code's leftover state), a
  // "consumed" report means this single-use code was just used: retire the QR.
  useEffect(() => {
    if (!code || used) return;
    if (pairingState === "pending") sawPending.current = true;
    else if (pairingState === "consumed" && sawPending.current) setUsed(true);
  }, [code, used, pairingState]);

  return (
    <section className="space-y-2">
      <SectionHeading>Pair a new device</SectionHeading>
      {used ? (
        <UsedNotice minting={minting} onRegenerate={() => void mint()} />
      ) : code ? (
        <PairingCodeView
          urls={code.urls}
          selected={selected}
          onSelect={setSelected}
          remaining={remaining}
          onRegenerate={() => void mint()}
          minting={minting}
        />
      ) : (
        <GeneratePrompt minting={minting} error={error} onGenerate={() => void mint()} />
      )}
    </section>
  );
}

/**
 * Shown after a code is consumed. The code is single-use by design, so rather
 * than silently leaving a dead QR up (which would just fail on the next device),
 * we say so and require an explicit click to mint a fresh one — no auto-regen.
 */
function UsedNotice({
  minting,
  onRegenerate,
}: {
  minting: boolean;
  onRegenerate: () => void;
}): ReactElement {
  return (
    <div className="space-y-2">
      <div className="flex items-start gap-1.5 rounded border border-border bg-card px-2.5 py-2 text-xs text-muted-foreground">
        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-[var(--acc-green)]" aria-hidden />
        <span>
          This code paired a device and is now used up. Each code works once — generate a new one to
          pair another device.
        </span>
      </div>
      <button
        type="button"
        onClick={onRegenerate}
        disabled={minting}
        className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {minting ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
        ) : (
          <QrCode className="size-3.5" aria-hidden />
        )}
        Generate a new code
      </button>
    </div>
  );
}

function GeneratePrompt({
  minting,
  error,
  onGenerate,
}: {
  minting: boolean;
  error: string | null;
  onGenerate: () => void;
}): ReactElement {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Generate a code, then scan the QR or open the link on the other device. The code is
        single-use and expires shortly.
      </p>
      <button
        type="button"
        onClick={onGenerate}
        disabled={minting}
        className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {minting ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
        ) : (
          <QrCode className="size-3.5" aria-hidden />
        )}
        Generate pairing code
      </button>
      {error ? <p className="text-xs text-[var(--acc-red)]">{error}</p> : null}
    </div>
  );
}

function PairingCodeView({
  urls,
  selected,
  onSelect,
  remaining,
  onRegenerate,
  minting,
}: {
  urls: string[];
  selected: number;
  onSelect: (index: number) => void;
  remaining: number;
  onRegenerate: () => void;
  minting: boolean;
}): ReactElement {
  const url = urls[selected] ?? urls[0] ?? "";
  if (!url) {
    return (
      <p className="text-xs text-muted-foreground">
        No reachable network address was detected. Connect this machine to a network — or set a
        tunnel hostname below — then generate a new code.
      </p>
    );
  }
  return (
    <div className="flex gap-3">
      {/* White plate so the QR scans on any theme (dark modules need a light field). */}
      <div className="shrink-0 rounded-md bg-white p-2">
        <QRCodeSVG value={url} size={132} marginSize={0} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2 rounded border border-border bg-card px-2 py-1">
          <code className="truncate font-mono text-[11px]">{url}</code>
          <CopyIconButton value={url} successLabel="Pairing link copied" />
        </div>
        {urls.length > 1 ? (
          <PairingTargets urls={urls} selected={selected} onSelect={onSelect} />
        ) : null}
        <div className="mt-auto flex items-center justify-between text-[11px] text-muted-foreground">
          <span className="tabular-nums">Expires in {remaining}s</span>
          <button
            type="button"
            onClick={onRegenerate}
            disabled={minting}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={`size-3 ${minting ? "animate-spin" : ""}`} aria-hidden />
            New code
          </button>
        </div>
      </div>
    </div>
  );
}

/** Address picker shown when more than one connect URL exists (multiple LAN
 * interfaces, or LAN + tunnel). Selecting one repoints the QR and link. */
function PairingTargets({
  urls,
  selected,
  onSelect,
}: {
  urls: string[];
  selected: number;
  onSelect: (index: number) => void;
}): ReactElement {
  return (
    <div className="flex flex-wrap gap-1">
      {urls.map((url, index) => (
        <button
          key={url}
          type="button"
          onClick={() => onSelect(index)}
          className={cn(
            "rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors",
            index === selected
              ? "border-primary bg-primary/10 text-foreground"
              : "border-border text-muted-foreground hover:text-foreground",
          )}
        >
          {hostLabel(url)}
        </button>
      ))}
    </div>
  );
}

/** The host:port of a connect URL, for the address-picker chip label. */
function hostLabel(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
