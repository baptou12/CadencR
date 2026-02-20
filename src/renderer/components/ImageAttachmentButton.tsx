import { useRef } from 'react'
import { Paperclip } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ImageAttachmentButtonProps {
  onFiles: (files: FileList) => void
  disabled?: boolean
}

export function ImageAttachmentButton({ onFiles, disabled }: ImageAttachmentButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleClick = () => {
    inputRef.current?.click()
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFiles(e.target.files)
      // Reset so same files can be selected again
      e.target.value = ''
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        className="hidden"
        onChange={handleChange}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={handleClick}
        disabled={disabled}
        aria-label="Attach images"
      >
        <Paperclip className="w-4 h-4" />
      </Button>
    </>
  )
}
