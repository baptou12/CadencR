import { Markdown } from "@/components/Markdown";
import { parseUserMessageContent } from "@/types/agent-types";

export function UserMessageBlock({ content }: { content: string }) {
  const { text: textContent, images } = parseUserMessageContent(content);

  return (
    <div className="my-1 flex justify-end">
      <div className="rounded-md border border-primary/30 bg-primary/10 px-3 py-1.5 text-sm max-w-[80%]">
        <Markdown content={textContent} className="user-message-markdown" />
        {images.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {images.map((img, i) => (
              <img
                key={i}
                src={`data:${img.mediaType};base64,${img.data}`}
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
