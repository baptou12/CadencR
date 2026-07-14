import { createContext, useContext, type ComponentType, type ReactElement } from "react";

export interface MarkdownImageProps {
  src?: string;
  alt?: string;
  title?: string;
  width?: string | number;
  height?: string | number;
}

/**
 * Component the Markdown renderer delegates `<img>` rendering to. Provided
 * only where images may reference on-disk files (the editor preview resolves
 * repo-relative paths to actual files); left null elsewhere (agent chat,
 * changelog), where images are remote URLs rendered as a plain `<img>`.
 */
export type MarkdownImageRenderer = ComponentType<MarkdownImageProps>;

const MarkdownImageContext = createContext<MarkdownImageRenderer | null>(null);
export const MarkdownImageProvider = MarkdownImageContext.Provider;

/** A plain, overflow-safe `<img>` — the shared presentation for markdown images. */
export function PlainMarkdownImage({
  src,
  alt,
  title,
  width,
  height,
}: MarkdownImageProps): ReactElement {
  return (
    <img
      src={src}
      alt={alt ?? ""}
      title={title}
      width={width}
      height={height}
      loading="lazy"
      className="my-2 h-auto max-w-full rounded"
    />
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
