/**
 * In-editor viewer for image files (PNG/JPG/GIF/WebP/BMP/ICO/AVIF).
 * Renders the bitmap with a transparency checkerboard backdrop, plus a
 * status row showing pixel dimensions and on-disk file size.
 *
 * Image bytes are fetched as a Blob via the API client (so auth
 * headers travel with the request) and exposed to the `<img>` element
 * through `URL.createObjectURL`.
 *
 * Zoom and pan match macOS Preview: trackpad pinch zooms around the
 * cursor, two-finger scroll pans, double-click resets to fit. The
 * geometry is driven by a single `transform: translate() scale()`
 * with `transform-origin: 0 0`; `userView === null` means "fit"
 * (recomputed on resize).
 */
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { customInstance } from "@/api/client";
import { formatBytes } from "@/lib/diff-thresholds";
import { getFileName } from "@/lib/file-language";
import { CheckerboardBackdrop } from "./CheckerboardBackdrop";

interface ImageFileViewerProps {
  filePath: string;
  projectId: number;
  featureId: number;
}

interface ImageDimensions {
  width: number;
  height: number;
}

interface View {
  scale: number;
  /** Image top-left, in container coordinates. */
  tx: number;
  ty: number;
}

const MIN_SCALE = 0.05;
const MAX_SCALE = 16;
const PINCH_SENSITIVITY = 0.01;

/** Fit + center, never upscaling — the convention image viewers use. */
function computeFitView(image: ImageDimensions, container: DOMRect): View {
  const scale = Math.min(container.width / image.width, container.height / image.height, 1);
  return {
    scale,
    tx: (container.width - image.width * scale) / 2,
    ty: (container.height - image.height * scale) / 2,
  };
}

/**
 * Keep the image inside the container: when it's larger than the pane
 * on an axis its edges stick to the pane edges; when smaller it
 * re-centers. Matches macOS Preview's pan behavior.
 */
function clampView(view: View, image: ImageDimensions, container: DOMRect): View {
  const renderedW = image.width * view.scale;
  const renderedH = image.height * view.scale;
  const tx =
    renderedW <= container.width
      ? (container.width - renderedW) / 2
      : Math.min(0, Math.max(container.width - renderedW, view.tx));
  const ty =
    renderedH <= container.height
      ? (container.height - renderedH) / 2
      : Math.min(0, Math.max(container.height - renderedH, view.ty));
  return { scale: view.scale, tx, ty };
}

function ImageFileViewerImpl({ filePath, projectId, featureId }: ImageFileViewerProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [dimensions, setDimensions] = useState<ImageDimensions | null>(null);
  const [error, setError] = useState<string | null>(null);
  // `null` means "use the auto-computed fit view"; any value means the
  // user has taken manual control via pinch or pan.
  const [userView, setUserView] = useState<View | null>(null);
  const [fitView, setFitView] = useState<View | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  // The container rect is read on every wheel event; caching avoids
  // `getBoundingClientRect()` (forced layout) on the pinch hot path.
  const rectRef = useRef<DOMRect | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let revokedUrl: string | null = null;
    setObjectUrl(null);
    setDimensions(null);
    setFileSize(null);
    setError(null);
    setUserView(null);
    setFitView(null);

    customInstance<Blob>({
      url: "/api/editor/read-image",
      method: "GET",
      params: { project_id: projectId, feature_id: featureId, file_path: filePath },
      responseType: "blob",
      signal: controller.signal,
    })
      .then((blob) => {
        if (controller.signal.aborted) return;
        const url = URL.createObjectURL(blob);
        revokedUrl = url;
        setFileSize(blob.size);
        setObjectUrl(url);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const message = err instanceof Error ? err.message : "Failed to load image";
        setError(message);
        // Sonner dedupes by `id`, so unrelated re-renders / both error
        // paths (fetch + <img> decode) won't stack toasts.
        toast.error(message, { id: `image-viewer:${filePath}` });
      });

    return () => {
      controller.abort();
      if (revokedUrl) URL.revokeObjectURL(revokedUrl);
    };
  }, [projectId, featureId, filePath]);

  const handleImgLoad = useCallback((event: React.SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget;
    setDimensions({ width: img.naturalWidth, height: img.naturalHeight });
  }, []);

  const handleImgError = useCallback(() => {
    const message = "Failed to decode image";
    setError(message);
    toast.error(message, { id: `image-viewer:${filePath}` });
  }, [filePath]);

  // Track the container rect (drives both the cached `rectRef` for the
  // wheel hot path and the auto-fit view that mirrors pane resizes).
  useEffect(() => {
    const node = containerRef.current;
    if (!node || !dimensions) return;

    function refresh(): void {
      if (!node || !dimensions) return;
      const rect = node.getBoundingClientRect();
      rectRef.current = rect;
      setFitView(computeFitView(dimensions, rect));
    }
    refresh();

    const observer = new ResizeObserver(refresh);
    observer.observe(node);
    return () => observer.disconnect();
  }, [dimensions]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    function onWheel(event: WheelEvent): void {
      const dims = dimensions;
      const rect = rectRef.current;
      if (!dims || !rect) return;
      const isPinch = event.ctrlKey || event.metaKey;
      if (!isPinch && event.deltaX === 0 && event.deltaY === 0) return;
      // Always claim the gesture so it doesn't bubble to outer scroll
      // containers (and Chromium's page-zoom doesn't fire on pinch).
      event.preventDefault();

      setUserView((prev) => {
        const base = prev ?? fitView ?? computeFitView(dims, rect);
        let next: View;
        if (isPinch) {
          const cx = event.clientX - rect.left;
          const cy = event.clientY - rect.top;
          const newScale = Math.min(
            MAX_SCALE,
            Math.max(MIN_SCALE, base.scale * Math.exp(-event.deltaY * PINCH_SENSITIVITY)),
          );
          // Anchor at the cursor: keep the image-local pixel under the
          // cursor in the same screen position after the scale change.
          const ratio = newScale / base.scale;
          next = {
            scale: newScale,
            tx: cx - (cx - base.tx) * ratio,
            ty: cy - (cy - base.ty) * ratio,
          };
        } else {
          // Pixel-level trackpad scroll → 1:1 pan.
          next = { scale: base.scale, tx: base.tx - event.deltaX, ty: base.ty - event.deltaY };
        }
        return clampView(next, dims, rect);
      });
    }

    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [dimensions, fitView]);

  // Double-click resets — macOS Preview / Quick Look convention.
  const handleDoubleClick = useCallback(() => setUserView(null), []);

  const fileNameLabel = getFileName(filePath);
  const view = userView ?? fitView;
  const statusParts: string[] = [fileNameLabel];
  if (dimensions) statusParts.push(`${dimensions.width} × ${dimensions.height}`);
  if (fileSize !== null) statusParts.push(formatBytes(fileSize));
  const zoomLabel = view ? `${Math.round(view.scale * 100)}%` : "—";

  return (
    <div className="h-full flex flex-col">
      <div
        ref={containerRef}
        onDoubleClick={handleDoubleClick}
        className="flex-1 relative overflow-hidden"
      >
        {error ? (
          <div className="h-full flex items-center justify-center text-destructive text-sm px-6 text-center">
            {error}
          </div>
        ) : objectUrl === null ? (
          <div className="h-full flex items-center justify-center bg-background">
            <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <CheckerboardBackdrop className="!overflow-hidden">
            <img
              src={objectUrl}
              alt={fileNameLabel}
              onLoad={handleImgLoad}
              onError={handleImgError}
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                transformOrigin: "0 0",
                transform: view
                  ? `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`
                  : "scale(0)",
                // `pixelated` keeps sprites/icons crisp past 2×; below
                // that the GPU's bilinear filter is what you want.
                imageRendering: view && view.scale > 2 ? "pixelated" : "auto",
                visibility: view ? "visible" : "hidden",
              }}
              className="select-none max-w-none max-h-none"
              draggable={false}
            />
          </CheckerboardBackdrop>
        )}
      </div>
      <div className="flex items-center justify-between px-3 py-0.5 border-t border-border bg-card text-xs text-muted-foreground shrink-0">
        <span className="truncate">{statusParts.join("  ·  ")}</span>
        <span>{zoomLabel}</span>
      </div>
    </div>
  );
}

const ImageFileViewer = memo(ImageFileViewerImpl);
export default ImageFileViewer;
