import {
  createContext,
  useContext,
  type ComponentType,
  type ReactElement,
  type ReactEventHandler,
  type ReactNode,
} from "react";

export interface MarkdownImageProps {
  src?: string;
  alt?: string;
  title?: string;
  width?: string | number;
  height?: string | number;
}

/**
 * Component the Markdown renderer delegates `<img>` rendering to. Provided
 * where images need fetching outside the renderer's CSP (the editor preview
 * resolves repo-relative paths to files; pull requests and the changelog proxy
 * remote images); left null elsewhere (agent chat), where images are rendered
 * as a plain `<img>`.
 */
export type MarkdownImageRenderer = ComponentType<MarkdownImageProps>;

const MarkdownImageContext = createContext<MarkdownImageRenderer | null>(null);
export const MarkdownImageProvider = MarkdownImageContext.Provider;

/** `data:` and `blob:` sources are what the CSP already permits. */
export function isDirectSource(src: string): boolean {
  return src.startsWith("data:") || src.startsWith("blob:");
}

/**
 * A plain, overflow-safe `<img>` — the shared presentation for markdown images.
 * Inline and middle-aligned: badges share a text line with headings and prose.
 */
export function PlainMarkdownImage({
  src,
  alt,
  title,
  width,
  height,
  onError,
}: MarkdownImageProps & { onError?: ReactEventHandler<HTMLImageElement> }): ReactElement {
  return (
    <img
      src={src}
      alt={alt ?? ""}
      title={title}
      width={width}
      height={height}
      onError={onError}
      loading="lazy"
      className="inline-block h-auto max-w-full rounded align-middle"
    />
  );
}

/** The inline chip's shell, shared with the forge's "Load image" button. */
export const MARKDOWN_IMAGE_NOTICE_CLASS =
  "inline-flex max-w-full items-center gap-1.5 rounded border border-border bg-muted px-2 py-1 align-middle text-xs text-muted-foreground";

/**
 * Inline chip standing in for a proxied image that is loading, deferred, or
 * failed — the icon says which, and `title` carries a failure's reason.
 */
export function MarkdownImageNotice({
  children,
  label,
  title,
}: {
  children: ReactNode;
  label: string;
  title?: string;
}): ReactElement {
  return (
    <span title={title} className={MARKDOWN_IMAGE_NOTICE_CLASS}>
      {children}
      <span className="truncate">{label}</span>
    </span>
  );
}

/**
 * `img` override for the Markdown renderer. When a context renderer is present
 * it handles the image (e.g. loading local repo files); otherwise the image is
 * rendered as a plain `<img>`.
 */
export function MarkdownImg(props: MarkdownImageProps): ReactElement {
  const Renderer = useContext(MarkdownImageContext);
  return Renderer ? <Renderer {...props} /> : <PlainMarkdownImage {...props} />;
}
