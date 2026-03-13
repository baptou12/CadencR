import { useState, useEffect, useCallback } from 'react'

export interface ImageAttachment {
  id: string
  file: File
  base64: string
  mimeType: string
  previewUrl: string
}

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const MAX_FILES = 10
const MAX_SIZE_BYTES = 20 * 1024 * 1024 // 20MB

export function useImageAttachments() {
  const [attachments, setAttachments] = useState<ImageAttachment[]>([])
  const [isDragging, setIsDragging] = useState(false)

  useEffect(() => {
    return () => {
      attachments.forEach((a) => URL.revokeObjectURL(a.previewUrl))
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const fileArray = Array.from(files)
      const remaining = MAX_FILES - attachments.length

      if (remaining <= 0) {
        console.warn('useImageAttachments: max 10 images allowed')
        return
      }

      const toProcess = fileArray.slice(0, remaining)

      toProcess.forEach((file) => {
        if (!ALLOWED_TYPES.includes(file.type)) {
          console.warn(`useImageAttachments: unsupported file type ${file.type}`)
          return
        }
        if (file.size > MAX_SIZE_BYTES) {
          console.warn(`useImageAttachments: file ${file.name} exceeds 20MB limit`)
          return
        }

        const reader = new FileReader()
        reader.addEventListener('load', (e) => {
          const dataUrl = e.target?.result as string
          // dataUrl is "data:<mime>;base64,<data>" — strip the prefix
          const base64 = dataUrl.split(',')[1]
          const previewUrl = URL.createObjectURL(file)
          const attachment: ImageAttachment = {
            id: crypto.randomUUID(),
            file,
            base64,
            mimeType: file.type,
            previewUrl,
          }
          setAttachments((prev) => {
            if (prev.length >= MAX_FILES) return prev
            return [...prev, attachment]
          })
        })
        reader.readAsDataURL(file)
      })
    },
    [attachments.length],
  )

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id)
      if (target) URL.revokeObjectURL(target.previewUrl)
      return prev.filter((a) => a.id !== id)
    })
  }, [])

  const clearAttachments = useCallback(() => {
    setAttachments((prev) => {
      prev.forEach((a) => URL.revokeObjectURL(a.previewUrl))
      return []
    })
  }, [])

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      if (e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files)
      }
    },
    [addFiles],
  )

  const dragHandlers = { onDragOver, onDragLeave, onDrop }

  return {
    attachments,
    addFiles,
    removeAttachment,
    clearAttachments,
    dragHandlers,
    isDragging,
  }
}
