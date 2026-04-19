import { useState, useEffect, useCallback, useRef } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'

export interface ImageAttachment {
  id: string
  fileName: string
  base64: string
  mimeType: string
  previewUrl: string
}

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const EXTENSION_TO_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}
const MAX_FILES = 10
const MAX_SIZE_BYTES = 20 * 1024 * 1024 // 20MB

function getMimeFromExtension(path: string): string | undefined {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return EXTENSION_TO_MIME[ext]
}

export function useImageAttachments() {
  const [attachments, setAttachments] = useState<ImageAttachment[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const attachmentsRef = useRef(attachments)
  attachmentsRef.current = attachments

  const addAttachment = useCallback((attachment: ImageAttachment) => {
    setAttachments((prev) => {
      if (prev.length >= MAX_FILES) return prev
      return [...prev, attachment]
    })
  }, [])

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const fileArray = Array.from(files)
      const remaining = MAX_FILES - attachmentsRef.current.length
      if (remaining <= 0) return

      fileArray.slice(0, remaining).forEach((file) => {
        if (!ALLOWED_TYPES.includes(file.type)) return
        if (file.size > MAX_SIZE_BYTES) return

        const reader = new FileReader()
        reader.addEventListener('load', (e) => {
          const dataUrl = e.target?.result as string
          const base64 = dataUrl.split(',')[1]
          const previewUrl = URL.createObjectURL(file)
          addAttachment({
            id: crypto.randomUUID(),
            fileName: file.name,
            base64,
            mimeType: file.type,
            previewUrl,
          })
        })
        reader.readAsDataURL(file)
      })
    },
    [addAttachment],
  )

  const addFilePaths = useCallback(
    async (paths: string[]) => {
      const remaining = MAX_FILES - attachmentsRef.current.length
      if (remaining <= 0) return

      for (const path of paths.slice(0, remaining)) {
        const fileName = path.split('/').pop() ?? path
        const mimeType = getMimeFromExtension(path)
        if (!mimeType) {
          toast.error(`Unsupported file: ${fileName}`, {
            description: 'Only PNG, JPEG, GIF, and WebP images can be attached.',
          })
          continue
        }

        try {
          const base64 = await invoke<string>('read_file_base64', { path })
          const previewUrl = `data:${mimeType};base64,${base64}`
          addAttachment({
            id: crypto.randomUUID(),
            fileName,
            base64,
            mimeType,
            previewUrl,
          })
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e)
          toast.error(`Couldn't attach ${fileName}`, { description: message })
        }
      }
    },
    [addAttachment],
  )

  // Stable ref so the effect doesn't re-register on every render
  const addFilePathsRef = useRef(addFilePaths)
  addFilePathsRef.current = addFilePaths

  // Listen for Tauri OS-level file drops (e.g. from Finder)
  useEffect(() => {
    let cancelled = false
    let unlisten: (() => void) | undefined
    try {
      getCurrentWindow()
        .onDragDropEvent((event) => {
          if (event.payload.type === 'enter') {
            setIsDragging(true)
          } else if (event.payload.type === 'leave') {
            setIsDragging(false)
          } else if (event.payload.type === 'drop') {
            setIsDragging(false)
            addFilePathsRef.current(event.payload.paths)
          }
        })
        .then((fn) => {
          if (cancelled) {
            fn()
          } else {
            unlisten = fn
          }
        })
    } catch (e) {
      console.warn('Tauri drag-drop listener unavailable:', e)
    }
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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

  // React-level handlers — still needed for visual drag feedback.
  // Note: Tauri intercepts OS file drops, so onDrop won't receive files
  // from Finder. But we preventDefault to avoid browser default behavior.
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const dragHandlers = { onDragOver, onDrop }

  return {
    attachments,
    addFiles,
    removeAttachment,
    clearAttachments,
    dragHandlers,
    isDragging,
  }
}
