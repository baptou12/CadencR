/**
 * Images embedded in release notes — screenshots committed to Cadencr's
 * repository and referenced by their GitHub URL.
 *
 * The renderer runs under `img-src 'self' data: blob:`, so a remote source is
 * blocked before the request leaves. The Electron main process fetches the
 * bytes (`electron/main/changelog-images.ts`) and they render from a `blob:` URL.
 */
import { useState, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { ImageOffIcon, Loader2Icon } from "lucide-react";
import {
  isDirectSource,
  MarkdownImageNotice,
  PlainMarkdownImage,
  type MarkdownImageProps,
} from "@/components/markdown-image";
import { useObjectUrl } from "@/hooks/useObjectUrl";
import { apiErrorMessage } from "@/lib/api-errors";
import { desktopBridge } from "@/lib/desktop-bridge";

/** Electron prefixes errors thrown by an `ipcMain.handle` handler; keep only the handler's message. */
const IPC_ERROR_PREFIX = /^Error invoking remote method '[^']+': (?:Error: )?/;

async function changelogImageBlob(src: string): Promise<Blob> {
  const { data, mimeType } = await desktopBridge.fetchChangelogImage(src);
  return new Blob([data], { type: mimeType });
}

/** `img` renderer for markdown inside the changelog dialogs. */
export function ChangelogImage(props: MarkdownImageProps): ReactElement {
  const src = props.src ?? "";
  const direct = isDirectSource(src);
  const query = useQuery({
    queryKey: ["changelog-image", src],
    queryFn: () => changelogImageBlob(src),
    enabled: src.length > 0 && !direct,
    // A release's images don't change while the dialog is open, and a missing
    // one stays missing. This is the only cache: the main process keeps none.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
  const url = useObjectUrl(query.data);
  const label = props.alt || src || "image";

  if (direct) return <DisplayChangelogImage key={src} {...props} />;
  if (query.error || !src) {
    const reason = query.error
      ? apiErrorMessage(query.error, "Could not load this image").replace(IPC_ERROR_PREFIX, "")
      : "This image has no source.";
    return (
      <MarkdownImageNotice title={reason} label={label}>
        <ImageOffIcon className="size-3.5 shrink-0" aria-hidden />
      </MarkdownImageNotice>
    );
  }
  if (!url) {
    return (
      <MarkdownImageNotice label={label}>
        <Loader2Icon className="size-3.5 shrink-0 animate-spin" aria-hidden />
      </MarkdownImageNotice>
    );
  }
  return <DisplayChangelogImage key={src} {...props} src={url} />;
}

/** Fetching bytes can succeed even when the browser cannot decode them. */
function DisplayChangelogImage(props: MarkdownImageProps): ReactElement {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <MarkdownImageNotice title="Could not display this image." label={props.alt || "image"}>
        <ImageOffIcon className="size-3.5 shrink-0" aria-hidden />
      </MarkdownImageNotice>
    );
  }
  return <PlainMarkdownImage {...props} onError={() => setFailed(true)} />;
}
