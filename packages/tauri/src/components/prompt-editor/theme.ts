import type { EditorThemeClasses } from "lexical";

export const editorTheme: EditorThemeClasses = {
  paragraph: "mb-1 last:mb-0",
  text: {
    bold: "font-bold",
    italic: "italic",
    underline: "underline",
    strikethrough: "line-through",
    code: "bg-muted rounded px-1 py-0.5 font-mono text-sm",
  },
  heading: {
    h1: "text-2xl font-bold mb-2",
    h2: "text-xl font-bold mb-2",
    h3: "text-lg font-bold mb-1",
  },
  list: {
    ul: "list-disc ml-4",
    ol: "list-decimal ml-4",
    listitem: "mb-0.5",
    nested: {
      listitem: "ml-4",
    },
  },
  code: "bg-muted rounded p-2 font-mono text-sm block mb-1",
  quote: "border-l-2 border-muted-foreground/40 pl-3 italic text-muted-foreground",
};
