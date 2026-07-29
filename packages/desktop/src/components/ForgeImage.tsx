/**
 * Images that belong to a pull request: the authors' faces, and whatever a
 * reviewer pasted into a comment.
 *
 * None of them can be an ordinary `<img src="https://…">`. The renderer runs
 * under `img-src 'self' data: blob:`, so a remote source is blocked before the
 * request leaves, and a private repository's attachments need the forge token
 * on the way out. Both are answered the same way the editor answers local
 * images: the service fetches the bytes, and these render them from a `blob:`
 * URL.
 *
 * Scope this with {@link ForgeImageScope}; without it every image falls back to
 * the plain `<img>` it would have been.
 */
import { createContext, useContext, type ReactElement, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ImageOffIcon, Loader2Icon } from "lucide-react";
import type { ForgeUser } from "@/api/generated";
import {
  MarkdownImageProvider,
  PlainMarkdownImage,
  type MarkdownImageProps,
} from "@/components/markdown-image";
import { useObjectUrl } from "@/hooks/useObjectUrl";
import { apiErrorMessage } from "@/lib/api-errors";
import { forgeImageBlob, forgeImageBlobQueryKey } from "@/lib/forge-image-blob";
import { cn } from "@/lib/utils";

/** Which feature's forge (and therefore whose credentials) serves these images. */
const ForgeImageFeature = createContext<number | null>(null);

/**
 * Marks a subtree as belonging to one pull request, so everything inside it —
 * markdown bodies included — loads its images through that feature's forge.
 */
export function ForgeImageScope({
  featureId,
  children,
}: {
  featureId: number;
  children: ReactNode;
}): ReactElement {
  return (
    <ForgeImageFeature.Provider value={featureId}>
      <MarkdownImageProvider value={ForgeMarkdownImage}>{children}</MarkdownImageProvider>
    </ForgeImageFeature.Provider>
  );
}

interface ForgeImageState {
  url: string | null;
  errorMessage: string | null;
  /** The source is already renderable as-is — the CSP allows it unproxied. */
  direct: boolean;
  /** A feature's forge is in scope, so a proxied fetch is possible at all. */
  scoped: boolean;
}

/** `data:` and `blob:` sources are what the CSP already permits. */
function isDirectSource(src: string): boolean {
  return src.startsWith("data:") || src.startsWith("blob:");
}

function useForgeImage(src: string | undefined): ForgeImageState {
  const featureId = useContext(ForgeImageFeature);
  const direct = !src || isDirectSource(src);
  const scoped = featureId !== null;
  const query = useQuery({
    queryKey: forgeImageBlobQueryKey(featureId ?? 0, src ?? ""),
    queryFn: ({ signal }) => forgeImageBlob(featureId ?? 0, src ?? "", signal),
    enabled: scoped && !direct,
    // A forge asset does not change under a fixed URL, and one avatar recurs on
    // every comment in a thread. Without a stale window, scrolling a review
    // would re-fetch the same face on each remount.
    staleTime: 5 * 60_000,
    // Keep the blob around for Virtuoso remounts, but not for half an hour —
    // a PR full of screenshots would otherwise pin tens of MB in the query cache.
    cacheTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    // A forge that refused this image once will refuse it again; a retry storm
    // across every avatar in a long review is the expensive way to find out.
    retry: false,
  });
  const url = useObjectUrl(query.data);
  return {
    url,
    errorMessage: query.error ? apiErrorMessage(query.error, "Could not load this image") : null,
    direct,
    scoped,
  };
}

/**
 * `img` renderer for markdown inside a pull request.
 *
 * Failures are named rather than left as a broken-image glyph: an attachment on
 * a repository the token cannot read is a fixable problem, and the chip carries
 * the reason in its tooltip.
 */
export function ForgeMarkdownImage(props: MarkdownImageProps): ReactElement {
  const { url, errorMessage, direct, scoped } = useForgeImage(props.src);
  if (direct || !scoped) return <PlainMarkdownImage {...props} />;
  const label = props.alt || props.src || "image";
  if (errorMessage) {
    return (
      <ForgeImageNotice title={errorMessage} label={label}>
        <ImageOffIcon className="size-3.5 shrink-0" aria-hidden />
      </ForgeImageNotice>
    );
  }
  if (!url) {
    return (
      <ForgeImageNotice label={label}>
        <Loader2Icon className="size-3.5 shrink-0 animate-spin" aria-hidden />
      </ForgeImageNotice>
    );
  }
  return <PlainMarkdownImage {...props} src={url} />;
}

function ForgeImageNotice({
  children,
  label,
  title,
}: {
  children: ReactNode;
  label: string;
  title?: string;
}): ReactElement {
  return (
    <span
      title={title}
      className="my-2 inline-flex max-w-full items-center gap-1.5 rounded border border-border bg-muted px-2 py-1 text-xs text-muted-foreground"
    >
      {children}
      <span className="truncate">{label}</span>
    </span>
  );
}

/**
 * A comment author's face, with their initials underneath it.
 *
 * The initials are not a fallback bolted on afterwards: they render first and
 * stay put until the bytes arrive, so a thread never reflows as avatars land,
 * and a forge that will not part with the picture still names everyone. An
 * outright failure keeps the initials and explains itself on hover.
 */
export function ForgeAvatar({
  user,
  className,
}: {
  user: ForgeUser;
  className?: string;
}): ReactElement {
  const name = user.display_name ?? user.username;
  const { url, errorMessage } = useForgeImage(user.avatar_url ?? undefined);
  return (
    <span
      title={errorMessage ?? undefined}
      className={cn(
        "relative grid size-5 shrink-0 place-items-center overflow-hidden rounded-full bg-muted text-[10px] font-semibold text-foreground",
        className,
      )}
    >
      {authorInitials(name)}
      {url && (
        <img src={url} alt="" aria-hidden className="absolute inset-0 size-full object-cover" />
      )}
    </span>
  );
}

/** First letters of the first two words — "?" when there is nothing to letter. */
function authorInitials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?"
  );
}
