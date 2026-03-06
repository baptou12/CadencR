import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { cn } from "@/lib/utils";
import { CodeBlockHeader } from "@/components/CodeBlockHeader";
import { useCodeBlockActions } from "@/components/CodeBlockActionsContext";

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
        return (
          <div className="my-1 rounded-md border border-border bg-muted/50 overflow-hidden group/codeblock">
            <CodeBlockHeader
              language={lang}
              code={code}
              showTerminalButton={isShell && !!sendToTerminal}
              onSendToTerminal={sendToTerminal}
            />
            <pre className="overflow-x-auto p-3 text-xs leading-relaxed">
              <code>{children}</code>
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
    td: ({ children }) => (
      <td className="border border-border px-2 py-1">{children}</td>
    ),
    blockquote: ({ children }) => (
      <blockquote className="my-1 border-l-2 border-[var(--drac-comment)] pl-3 text-[var(--drac-comment)] italic">
        {children}
      </blockquote>
    ),
    ul: ({ children }) => (
      <ul className="my-1 ml-4 list-disc space-y-0.5">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="my-1 ml-4 list-decimal space-y-0.5">{children}</ol>
    ),
    hr: () => <hr className="my-3 border-border" />,
    p: ({ children }) => <p className="my-1">{children}</p>,
  };
}

interface MarkdownProps {
  content: string;
  className?: string;
}

function preprocessContent(raw: string): string {
  return raw.replace(/---PLAN_START---|---PLAN_END---/g, "\n---\n");
}

export function Markdown({ content, className }: MarkdownProps) {
  const { sendToTerminal } = useCodeBlockActions();
  const components = useMemo(() => buildComponents(sendToTerminal), [sendToTerminal]);

  return (
    <div className={cn("text-sm leading-relaxed text-foreground", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {preprocessContent(content)}
      </ReactMarkdown>
    </div>
  );
}
