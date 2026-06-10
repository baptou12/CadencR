import { useRef } from "react";
import { Paperclip } from "lucide-react";
import { attachmentAcceptForProvider } from "@/lib/prompt-attachments";

interface ImageAttachmentButtonProps {
  onFilesSelected: (files: FileList | File[]) => void;
  disabled?: boolean;
  providerId?: string;
}

export function ImageAttachmentButton({
  onFilesSelected,
  disabled,
  providerId,
}: ImageAttachmentButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClick = () => {
    inputRef.current?.click();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFilesSelected(e.target.files);
      // Reset so same files can be selected again
      e.target.value = "";
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={attachmentAcceptForProvider(providerId)}
        multiple
        className="hidden"
        onChange={handleChange}
      />
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        aria-label="Attach files"
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
      >
        <Paperclip className="size-4" />
      </button>
    </>
  );
}
