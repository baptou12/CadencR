import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ListItemNode, ListNode } from "@lexical/list";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import {
  BOLD_ITALIC_STAR,
  BOLD_ITALIC_UNDERSCORE,
  BOLD_STAR,
  BOLD_UNDERSCORE,
  HEADING,
  INLINE_CODE,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  ORDERED_LIST,
  QUOTE,
  STRIKETHROUGH,
  UNORDERED_LIST,
} from "@lexical/markdown";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  type EditorState,
  type LexicalEditor,
} from "lexical";
import { cn } from "@/lib/utils";
import { editorTheme } from "./theme";
import { toast } from "sonner";
import { MentionNode } from "./nodes/MentionNode";
import { MentionPlugin } from "./plugins/MentionPlugin";
import { SlashCommandNode } from "./nodes/SlashCommandNode";
import { SlashCommandPlugin } from "./plugins/SlashCommandPlugin";
import { KeyboardShortcutsPlugin } from "./plugins/KeyboardShortcutsPlugin";
import type { SlashCommand } from "@/hooks/useSlashCommand";

/** Markdown transformers excluding CODE_BLOCK which requires @lexical/code */
const MARKDOWN_TRANSFORMERS = [
  HEADING,
  QUOTE,
  UNORDERED_LIST,
  ORDERED_LIST,
  BOLD_ITALIC_STAR,
  BOLD_ITALIC_UNDERSCORE,
  BOLD_STAR,
  BOLD_UNDERSCORE,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  STRIKETHROUGH,
  INLINE_CODE,
];

export interface PromptEditorHandle {
  focus: () => void;
  clear: () => void;
  setText: (text: string) => void;
  getText: () => string;
}

interface PromptEditorProps {
  onChange?: (text: string) => void;
  placeholder?: string;
  className?: string;
  mentionFiles?: string[];
  slashCommands?: SlashCommand[];
  slashCommandsLoading?: boolean;
  /** Called when Enter pressed (no shift, no popover). Return true to consume. */
  onEnterSend?: () => boolean;
  /** Called on ArrowUp in empty editor for prompt history. */
  onArrowUp?: () => string | null;
  /** Called on ArrowDown for prompt history navigation. */
  onArrowDown?: () => string | null;
  onFocusChange?: (focused: boolean) => void;
  disabled?: boolean;
  /** Initial text to populate the editor with (e.g. restored draft) */
  initialText?: string;
}

function EditorRefPlugin({
  editorRef,
}: {
  editorRef: React.MutableRefObject<LexicalEditor | null>;
}) {
  const [editor] = useLexicalComposerContext();
  editorRef.current = editor;
  return null;
}

function AutoResizePlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const rootElement = editor.getRootElement();
    if (!rootElement) return;

    const resize = () => {
      rootElement.style.height = "auto";
      rootElement.style.height = `${rootElement.scrollHeight}px`;
    };

    const unregister = editor.registerUpdateListener(() => resize());
    resize();
    return unregister;
  }, [editor]);

  return null;
}

const PromptEditorInner = forwardRef<PromptEditorHandle, PromptEditorProps>(
  function PromptEditorInner({ onChange, placeholder, className, mentionFiles, slashCommands, slashCommandsLoading, onEnterSend, onArrowUp, onArrowDown, onFocusChange, disabled }, ref) {
    const editorRef = useRef<LexicalEditor | null>(null);

    useImperativeHandle(ref, () => ({
      focus() {
        editorRef.current?.focus();
      },
      clear() {
        editorRef.current?.update(() => {
          const root = $getRoot();
          root.clear();
          root.append($createParagraphNode());
        });
      },
      setText(text: string) {
        editorRef.current?.update(() => {
          const root = $getRoot();
          root.clear();
          const paragraph = $createParagraphNode();
          paragraph.append($createTextNode(text));
          root.append(paragraph);
        });
      },
      getText() {
        let text = "";
        editorRef.current?.getEditorState().read(() => {
          text = $getRoot().getTextContent();
        });
        return text;
      },
    }));

    const handleChange = useCallback(
      (_editorState: EditorState, editor: LexicalEditor) => {
        if (!onChange) return;
        editor.getEditorState().read(() => {
          onChange($getRoot().getTextContent());
        });
      },
      [onChange],
    );

    return (
      <>
        <EditorRefPlugin editorRef={editorRef} />
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              className={cn(
                "w-full min-w-0 outline-none",
                disabled && "pointer-events-none opacity-50",
                className,
              )}
              onFocus={() => onFocusChange?.(true)}
              onBlur={() => onFocusChange?.(false)}
              aria-disabled={disabled}
            />
          }
          placeholder={
            placeholder ? (
              <div className="text-muted-foreground pointer-events-none absolute top-0 left-0 select-none text-sm leading-[22px]">
                {placeholder}
              </div>
            ) : null
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <ListPlugin />
        <MarkdownShortcutPlugin transformers={MARKDOWN_TRANSFORMERS} />
        <OnChangePlugin onChange={handleChange} />
        <AutoResizePlugin />
        <MentionPlugin files={mentionFiles} />
        <SlashCommandPlugin commands={slashCommands} isLoading={slashCommandsLoading} />
        <KeyboardShortcutsPlugin onEnterSend={onEnterSend} onArrowUp={onArrowUp} onArrowDown={onArrowDown} />
      </>
    );
  },
);

export const PromptEditor = forwardRef<PromptEditorHandle, PromptEditorProps>(
  function PromptEditor(props, ref) {
    const initialConfig = {
      namespace: "PromptEditor",
      theme: editorTheme,
      nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, MentionNode, SlashCommandNode],
      onError(error: Error) {
        toast.error(`Editor error: ${error.message}`);
      },
      editorState: props.initialText
        ? () => {
            const root = $getRoot();
            const p = $createParagraphNode();
            p.append($createTextNode(props.initialText!));
            root.append(p);
          }
        : undefined,
    };

    return (
      <LexicalComposer initialConfig={initialConfig}>
        <div className="relative min-w-0 flex-1">
          <PromptEditorInner ref={ref} {...props} />
        </div>
      </LexicalComposer>
    );
  },
);
