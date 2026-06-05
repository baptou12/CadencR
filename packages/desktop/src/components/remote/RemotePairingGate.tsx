import { useState, type FormEvent, type ReactNode } from "react";

import { CadencrLogo } from "@/components/CadencrLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isBrowserRemote, readDeviceToken, writeDeviceToken } from "@/lib/remote/device-token";

/**
 * Gate shown to an UNPAIRED remote browser. Normally the host's QR link carries
 * a `?code=` that pairs before React mounts, so this never appears. It exists
 * for the case the token is gone at launch — most importantly iOS "Add to Home
 * Screen": the standalone web-clip gets its OWN storage sandbox, so the token
 * paired in Safari isn't visible and every request 401s. Here the user pastes
 * the pairing link once; we persist the token to this context's `localStorage`
 * (so it survives relaunches) and reload authenticated.
 *
 * Pass-through on the desktop shell and on any already-paired device.
 */
export function RemotePairingGate({ children }: { children: ReactNode }): ReactNode {
  if (!isBrowserRemote() || readDeviceToken()) return children;
  return <PairingScreen />;
}

/**
 * Pull the pairing code out of whatever the user pasted: a full
 * `https://host/?code=…` link, a bare `?code=…` fragment, or the raw code.
 */
export function extractPairingCode(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const code = new URL(trimmed).searchParams.get("code");
    if (code) return code;
  } catch {
    // Not a full URL — fall through to the looser checks below.
  }
  const match = trimmed.match(/[?&]code=([^&\s]+)/);
  if (match) return decodeURIComponent(match[1]);
  return trimmed;
}

function PairingScreen(): ReactNode {
  const [value, setValue] = useState("");
  const [pairing, setPairing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePair = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const code = extractPairingCode(value);
    if (!code) {
      setError("Paste the pairing link or code from your computer.");
      return;
    }
    setPairing(true);
    setError(null);
    try {
      const resp = await fetch(`${location.origin}/api/remote/pair`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!resp.ok) {
        throw new Error(
          resp.status === 400
            ? "That pairing link has expired. Generate a fresh one on your computer."
            : `Pairing failed (HTTP ${resp.status}).`,
        );
      }
      const body: unknown = await resp.json();
      const token = (body as { device_token?: unknown }).device_token;
      if (typeof token !== "string") {
        throw new Error("The pairing response was malformed.");
      }
      // Persist (localStorage) so this device stays paired across relaunches —
      // the whole point of the standalone flow. Then reload so the app
      // re-bootstraps with the token already in place.
      writeDeviceToken(token, true);
      location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pairing failed.");
      setPairing(false);
    }
  };

  return (
    <div className="flex h-dvh w-full flex-col items-center justify-center gap-6 bg-background px-6 text-center">
      <CadencrLogo className="size-12" />
      <div className="space-y-1.5">
        <h1 className="text-lg font-semibold">Pair this device</h1>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          Open <span className="font-medium text-foreground">Remote access</span> on your computer,
          copy the pairing link, and paste it below. On the same Apple ID you can copy on your Mac
          and paste here with Universal Clipboard.
        </p>
      </div>
      <form onSubmit={handlePair} className="flex w-full max-w-sm flex-col gap-3">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Paste pairing link…"
          autoFocus
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          disabled={pairing}
          aria-label="Pairing link or code"
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={pairing || !value.trim()}>
          {pairing ? "Pairing…" : "Pair device"}
        </Button>
      </form>
    </div>
  );
}
