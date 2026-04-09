import { Markdown } from "@/components/Markdown";

export function UserMessageBlock({ content }: { content: string }) {
  let textContent = content;
  let imageBlocks: Array<{ source: { media_type: string; data: string } }> = [];

  if (content.startsWith("[")) {
    try {
      const parsed = JSON.parse(content) as Array<{ type: string; text?: string; source?: { media_type: string; data: string } }>;
      if (Array.isArray(parsed)) {
        const texts: string[] = [];
        for (const block of parsed) {
          if (block.type === "text" && block.text) texts.push(block.text);
          else if (block.type === "image" && block.source) imageBlocks.push({ source: block.source });
        }
        textContent = texts.join("\n");
      }
    } catch {
      // Not JSON — render as plain text
    }
  }

  return (
    <div className="my-1 flex justify-end">
      <div className="rounded-md border border-primary/30 bg-primary/10 px-3 py-1.5 text-sm max-w-[80%]">
        <Markdown content={textContent} className="user-message-markdown" />
        {imageBlocks.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {imageBlocks.map((img, i) => (
              <img
                key={i}
                src={`data:${img.source.media_type};base64,${img.source.data}`}
                alt={`Attachment ${i + 1}`}
                className="max-h-48 max-w-full rounded border border-border"
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
