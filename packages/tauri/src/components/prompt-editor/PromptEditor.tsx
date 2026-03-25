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
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ListItemNode, ListNode } from "@lexical/list";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { TRANSFORMERS } from "@lexical/markdown";
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
  function PromptEditorInner({ onChange, placeholder, className, mentionFiles }, ref) {
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
                "placeholder:text-muted-foreground border-input w-full min-w-0 rounded-md border bg-transparent px-3 py-2 text-base shadow-xs outline-none md:text-sm",
                "focus:border-ring focus:ring-ring/50 focus:ring-[3px]",
                "min-h-[80px] max-h-[300px] overflow-y-auto resize-none",
                className,
              )}
            />
          }
          placeholder={
            placeholder ? (
              <div className="text-muted-foreground pointer-events-none absolute top-2 left-3 select-none text-base md:text-sm">
                {placeholder}
              </div>
            ) : null
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <ListPlugin />
        <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
        <OnChangePlugin onChange={handleChange} />
        <AutoResizePlugin />
        <MentionPlugin files={mentionFiles} />
      </>
    );
  },
);

function LexicalErrorBoundary({
  children,
  onError,
}: {
  children: React.ReactNode;
  onError: (error: Error) => void;
}) {
  void onError;
  return <>{children}</>;
}

export const PromptEditor = forwardRef<PromptEditorHandle, PromptEditorProps>(
  function PromptEditor(props, ref) {
    const initialConfig = {
      namespace: "PromptEditor",
      theme: editorTheme,
      nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, MentionNode],
      onError(error: Error) {
        toast.error(`Editor error: ${error.message}`);
      },
    };

    return (
      <LexicalComposer initialConfig={initialConfig}>
        <div className="relative">
          <PromptEditorInner ref={ref} {...props} />
        </div>
      </LexicalComposer>
    );
  },
);
