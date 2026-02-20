import { X } from 'lucide-react'
import { ImageAttachment } from '@/hooks/useImageAttachments'

interface ImageAttachmentPreviewProps {
  attachments: ImageAttachment[]
  onRemove: (id: string) => void
}

export function ImageAttachmentPreview({ attachments, onRemove }: ImageAttachmentPreviewProps) {
  if (attachments.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2 p-2">
      {attachments.map((attachment) => (
        <div key={attachment.id} className="relative group">
          <img
            src={attachment.previewUrl}
            alt={attachment.file.name}
            className="w-12 h-12 rounded object-cover border border-border"
          />
          <button
            type="button"
            onClick={() => onRemove(attachment.id)}
            className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            aria-label={`Remove ${attachment.file.name}`}
          >
            <X className="w-2.5 h-2.5" />
          </button>
        </div>
      ))}
    </div>
  )
}
