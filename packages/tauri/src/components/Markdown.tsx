import { memo, useMemo, type ReactElement } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { createLowlight, common } from "lowlight";
import ini from "highlight.js/lib/languages/ini";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { cn } from "@/lib/utils";
import { CodeBlockHeader } from "@/components/CodeBlockHeader";
import { useCodeBlockActions } from "@/components/CodeBlockActionsContext";
import "./dracula-highlight.css";

// `common` ships ~35 grammars vs. `all`'s ~155; unregistered languages fall
// back to plain text via `cachedHighlight`'s catch.
const lowlight = createLowlight(common);
// TOML uses highlight.js's `ini` grammar.
lowlight.register("toml", ini);

/** Cache for syntax-highlighted JSX to avoid re-highlighting identical code blocks. */
const highlightCache = new Map<string, React.ReactNode>();
const HIGHLIGHT_CACHE_MAX = 200;

/**
 * Cache for the rendered ReactMarkdown element, keyed on the markdown
 * content plus the presence of a `sendToTerminal` action (which changes the
 * components mapping). Stable entries are reused across mounts so that
 * scrolling a long conversation through Virtuoso preserves element
 * identity, letting downstream `React.memo`'d trees bail out on repeat
 * renders.
 *
 * The cache is opt-in via the `cacheKey` prop on `Markdown`: callers set it
 * for stable blocks (e.g. older messages) and leave it `undefined` for the
 * actively streaming block so partial states do not pollute the cache.
 */
const markdownTreeCache = new Map<string, ReactElement>();
const MARKDOWN_CACHE_MAX = 200;

function evictOldestMarkdownEntry(): void {
  const firstKey = markdownTreeCache.keys().next().value;
  if (firstKey !== undefined) markdownTreeCache.delete(firstKey);
}

/** Test helpers — not exported from the package barrel. */
export const __markdownCacheTestHelpers = {
  size: (): number => markdownTreeCache.size,
  clear: (): void => {
    markdownTreeCache.clear();
  },
  has: (content: string, sendToTerminal: boolean): boolean =>
    markdownTreeCache.has(`${sendToTerminal ? "1" : "0"}\0${content}`),
};

function cachedHighlight(lang: string, code: string): React.ReactNode {
  const key = `${lang}\0${code}`;
  const cached = highlightCache.get(key);
  if (cached !== undefined) return cached;
  try {
    const tree = lowlight.highlight(lang, code);
    const result = toJsxRuntime(tree, { Fragment, jsx, jsxs });
    if (highlightCache.size >= HIGHLIGHT_CACHE_MAX) {
      // Evict oldest entry
      const firstKey = highlightCache.keys().next().value;
      if (firstKey !== undefined) highlightCache.delete(firstKey);
    }
    highlightCache.set(key, result);
    return result;
  } catch {
    return null;
  }
}

/** Extract plain text from React children (handles nested elements from react-markdown). */
function extractText(children: React.ReactNode): string {
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(extractText).join("");
  if (children && typeof children === "object" && "props" in children) {
    const el = children as React.ReactElement<{ children?: React.ReactNode }>;
    return extractText(el.props.children);
  }
  return "";
}

const SHELL_LANGUAGES = new Set(["bash", "sh", "zsh", "shell", "console", "terminal"]);

function buildComponents(sendToTerminal?: (cmd: string) => void): Components {
  return {
    h1: ({ children }) => (
      <h1 className="text-2xl font-bold mt-5 mb-2 text-[var(--drac-purple)]">{children}</h1>
    ),
    h2: ({ children }) => (
      <h2 className="text-xl font-bold mt-4 mb-2 text-[var(--drac-cyan)]">{children}</h2>
    ),
    h3: ({ children }) => (
      <h3 className="text-lg font-semibold mt-3 mb-1.5 text-[var(--drac-green)]">{children}</h3>
    ),
    h4: ({ children }) => (
      <h4 className="text-base font-semibold mt-2 mb-1 text-[var(--drac-orange)]">{children}</h4>
    ),
    h5: ({ children }) => (
      <h5 className="text-sm font-semibold mt-2 mb-1 text-[var(--drac-pink)]">{children}</h5>
    ),
    h6: ({ children }) => (
      <h6 className="text-xs font-semibold mt-1 mb-0.5 text-[var(--drac-yellow)]">{children}</h6>
    ),
    code: ({ className, children, node, ...props }) => {
      const match = /language-(\w+)/.exec(className || "");
      const isBlock = node?.position && node.position.start.line !== node.position.end.line;
      if (match || isBlock) {
        const lang = match?.[1] ?? "text";
        const code = extractText(children).replace(/\n$/, "");
        const isShell = SHELL_LANGUAGES.has(lang);
        const highlighted = cachedHighlight(lang, code) ?? children;
        return (
          <div className="my-1 rounded-md border border-border bg-muted/50 overflow-hidden group/codeblock">
            <CodeBlockHeader
              language={lang}
              code={code}
              showTerminalButton={isShell && !!sendToTerminal}
              onSendToTerminal={sendToTerminal}
            />
            <pre className="overflow-x-auto p-3 text-xs leading-relaxed">
              <code className="hljs">{highlighted}</code>
            </pre>
          </div>
        );
      }
      return (
        <code
          className="rounded bg-muted px-1 py-0.5 text-xs font-mono text-[var(--drac-pink)]"
          {...props}
        >
          {children}
        </code>
      );
    },
    pre: ({ children }) => <>{children}</>,
    a: ({ href, children }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[var(--drac-cyan)] underline underline-offset-2 hover:text-[var(--drac-purple)]"
      >
        {children}
      </a>
    ),
    table: ({ children }) => (
      <div className="my-2 overflow-x-auto">
        <table className="min-w-full border-collapse text-xs">{children}</table>
      </div>
    ),
    th: ({ children }) => (
      <th className="border border-border bg-muted px-2 py-1 text-left font-semibold">
        {children}
      </th>
    ),
    td: ({ children }) => <td className="border border-border px-2 py-1">{children}</td>,
    blockquote: ({ children }) => (
      <blockquote className="my-1 border-l-2 border-[var(--drac-comment)] pl-3 text-[var(--drac-comment)] italic">
        {children}
      </blockquote>
    ),
    ul: ({ children }) => <ul className="my-1 ml-4 list-disc space-y-0.5">{children}</ul>,
    ol: ({ children }) => <ol className="my-1 ml-4 list-decimal space-y-0.5">{children}</ol>,
    hr: () => <hr className="my-3 border-border" />,
    p: ({ children }) => <p className="my-1">{children}</p>,
  };
}

interface MarkdownProps {
  content: string;
  className?: string;
  /**
   * When set, the rendered ReactMarkdown tree is cached at module level so
   * repeated mounts (e.g. Virtuoso recycling items as the user scrolls) skip
   * the parse + AST walk. Leave `undefined` for the actively streaming block
   * so partial-content states are not cached.
   */
  cacheKey?: string;
}

function preprocessContent(raw: string): string {
  return raw.replace(/---PLAN_START---|---PLAN_END---/g, "\n---\n");
}

export const Markdown = memo(function Markdown({ content, className, cacheKey }: MarkdownProps) {
  const { sendToTerminal } = useCodeBlockActions();
  const components = useMemo(() => buildComponents(sendToTerminal), [sendToTerminal]);

  const tree = useMemo<ReactElement>(() => {
    const build = (): ReactElement => (
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {preprocessContent(content)}
      </ReactMarkdown>
    );
    if (cacheKey === undefined) return build();
    const key = `${sendToTerminal ? "1" : "0"}\0${content}`;
    const cached = markdownTreeCache.get(key);
    if (cached !== undefined) {
      // Refresh recency by re-inserting (Map preserves insertion order, so
      // the freshly-set entry becomes the newest for LRU eviction).
      markdownTreeCache.delete(key);
      markdownTreeCache.set(key, cached);
      return cached;
    }
    const fresh = build();
    if (markdownTreeCache.size >= MARKDOWN_CACHE_MAX) evictOldestMarkdownEntry();
    markdownTreeCache.set(key, fresh);
    return fresh;
  }, [cacheKey, content, components, sendToTerminal]);

  return <div className={cn("text-sm leading-relaxed text-foreground", className)}>{tree}</div>;
});
