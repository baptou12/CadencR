import { StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import type {
  ConflictChoice,
  ConflictHunk,
  MappedConflictHunk,
} from "./conflict-resolution-adapter";
import { mapConflictHunk } from "./conflict-resolution-adapter";

interface ConflictControlConfig {
  hunks: ConflictHunk[];
  currentLabel: string;
  incomingLabel: string;
  onApply: (hunk: MappedConflictHunk, choice: ConflictChoice) => void;
}

export function conflictResolutionControls(config: ConflictControlConfig): Extension {
  const controls = StateField.define<DecorationSet>({
    create: (state) => buildDecorations(state, config),
    update: (decorations, transaction) =>
      transaction.docChanged ? buildDecorations(transaction.state, config) : decorations,
    provide: (field) => EditorView.decorations.from(field),
  });
  return [controls, conflictControlTheme];
}

function buildDecorations(state: EditorState, config: ConflictControlConfig): DecorationSet {
  const documentText = state.doc.toString();
  const decorations = conflictSectionDecorations(state);
  for (const hunk of config.hunks) {
    // Anchor the action row on the raw marker so a hunk that can no longer be
    // applied safely (ambiguous or imprecise mapping) still explains itself
    // inline instead of silently vanishing. A hunk whose marker is gone has
    // been resolved away — nothing to render.
    const anchor = documentText.indexOf(hunk.markerText);
    if (anchor < 0) continue;
    const mapped = mapConflictHunk(documentText, hunk);
    decorations.push(
      Decoration.widget({
        block: true,
        side: -1,
        widget: new ConflictActionsWidget(mapped, config),
      }).range(anchor),
    );
  }
  return Decoration.set(decorations, true);
}

function conflictSectionDecorations(state: EditorState): Range<Decoration>[] {
  const decorations: Range<Decoration>[] = [];
  let section: "current" | "base" | "incoming" | null = null;
  for (let number = 1; number <= state.doc.lines; number += 1) {
    const line = state.doc.line(number);
    if (line.text.startsWith("<<<<<<<")) {
      section = "current";
      decorations.push(lineDecoration(line.from, "cm-conflictCurrentMarker"));
    } else if (line.text.startsWith("|||||||")) {
      section = "base";
      decorations.push(lineDecoration(line.from, "cm-conflictBaseMarker"));
    } else if (line.text.startsWith("=======")) {
      section = "incoming";
      decorations.push(lineDecoration(line.from, "cm-conflictDivider"));
    } else if (line.text.startsWith(">>>>>>>")) {
      decorations.push(lineDecoration(line.from, "cm-conflictIncomingMarker"));
      section = null;
    } else if (section) {
      decorations.push(lineDecoration(line.from, `cm-conflict${capitalize(section)}Line`));
    }
  }
  return decorations;
}

function lineDecoration(from: number, className: string): Range<Decoration> {
  return Decoration.line({ class: className }).range(from);
}

function capitalize(value: "current" | "base" | "incoming"): "Current" | "Base" | "Incoming" {
  return `${value[0].toUpperCase()}${value.slice(1)}` as "Current" | "Base" | "Incoming";
}

class ConflictActionsWidget extends WidgetType {
  constructor(
    private readonly hunk: MappedConflictHunk,
    private readonly config: ConflictControlConfig,
  ) {
    super();
  }

  eq(other: ConflictActionsWidget): boolean {
    return (
      other.hunk.id === this.hunk.id &&
      other.hunk.disabledReason === this.hunk.disabledReason &&
      other.config.currentLabel === this.config.currentLabel &&
      other.config.incomingLabel === this.config.incomingLabel
    );
  }

  toDOM(): HTMLElement {
    const container = document.createElement("div");
    container.className = "cm-conflictActions";
    container.setAttribute("role", "group");
    container.setAttribute("aria-label", `Resolution actions for ${this.hunk.id}`);
    if (this.hunk.disabledReason) {
      container.classList.add("cm-conflictActions-disabled");
      const reason = container.appendChild(document.createElement("span"));
      reason.className = "cm-conflictActionsReason";
      reason.textContent = this.hunk.disabledReason;
      return container;
    }
    container.appendChild(this.button("current", `Accept ${this.config.currentLabel}`));
    container.appendChild(this.button("incoming", `Accept ${this.config.incomingLabel}`));
    container.appendChild(this.button("both", "Accept both"));
    return container;
  }

  private button(choice: ConflictChoice, label: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cm-conflictActionButton";
    button.dataset.choice = choice;
    button.textContent = label;
    button.setAttribute("aria-label", label);
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => this.config.onApply(this.hunk, choice));
    return button;
  }
}

// Two distinct, theme-owned accent hues carry the two sides: cyan for the
// Current side, violet for the Incoming side. Both are defined in every theme
// and avoid the reserved add/green and delete/red diff colors. Tints wash over
// `transparent` so they read consistently over solid and translucent code
// surfaces (e.g. Frost's glass editor); the solid inset bar guarantees the
// region is legible regardless of the wash.
const CURRENT = "var(--acc-cyan)";
const INCOMING = "var(--acc-purple)";

const conflictControlTheme = EditorView.theme({
  ".cm-conflictActions": {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "6px",
    padding: "4px 10px",
    borderBlockEnd: "1px solid var(--border)",
    backgroundColor: "color-mix(in srgb, var(--foreground) 4%, transparent)",
    fontFamily: "var(--font-sans)",
  },
  ".cm-conflictActions-disabled": {
    backgroundColor: "color-mix(in srgb, var(--acc-orange) 8%, transparent)",
  },
  ".cm-conflictActionsReason": {
    color: "var(--muted-foreground)",
    fontSize: "11px",
    fontStyle: "italic",
  },
  ".cm-conflictActionButton": {
    minHeight: "22px",
    padding: "2px 9px",
    border: "1px solid var(--border)",
    borderRadius: "5px",
    backgroundColor: "var(--code-bg)",
    color: "var(--foreground)",
    cursor: "pointer",
    fontFamily: "var(--font-sans)",
    fontSize: "11px",
    fontWeight: "500",
  },
  ".cm-conflictActionButton:hover": {
    backgroundColor: "var(--accent)",
  },
  ".cm-conflictActionButton:focus-visible": {
    outline: "2px solid var(--ring)",
    outlineOffset: "1px",
  },
  '.cm-conflictActionButton[data-choice="current"]': {
    borderColor: `color-mix(in srgb, ${CURRENT} 60%, var(--border))`,
    backgroundColor: `color-mix(in srgb, ${CURRENT} 16%, var(--code-bg))`,
    color: CURRENT,
  },
  '.cm-conflictActionButton[data-choice="current"]:hover': {
    backgroundColor: `color-mix(in srgb, ${CURRENT} 28%, var(--code-bg))`,
  },
  '.cm-conflictActionButton[data-choice="incoming"]': {
    borderColor: `color-mix(in srgb, ${INCOMING} 60%, var(--border))`,
    backgroundColor: `color-mix(in srgb, ${INCOMING} 16%, var(--code-bg))`,
    color: INCOMING,
  },
  '.cm-conflictActionButton[data-choice="incoming"]:hover': {
    backgroundColor: `color-mix(in srgb, ${INCOMING} 28%, var(--code-bg))`,
  },
  ".cm-line.cm-conflictCurrentLine": {
    boxShadow: `inset 3px 0 0 ${CURRENT}`,
    backgroundColor: `color-mix(in srgb, ${CURRENT} 12%, transparent)`,
  },
  ".cm-line.cm-conflictIncomingLine": {
    boxShadow: `inset 3px 0 0 ${INCOMING}`,
    backgroundColor: `color-mix(in srgb, ${INCOMING} 13%, transparent)`,
  },
  ".cm-line.cm-conflictBaseLine": {
    boxShadow: "inset 3px 0 0 var(--muted-foreground)",
    backgroundColor: "color-mix(in srgb, var(--muted-foreground) 8%, transparent)",
  },
  ".cm-line.cm-conflictCurrentMarker": {
    boxShadow: `inset 3px 0 0 ${CURRENT}`,
    backgroundColor: `color-mix(in srgb, ${CURRENT} 24%, transparent)`,
    color: CURRENT,
    fontWeight: "700",
  },
  ".cm-line.cm-conflictIncomingMarker": {
    boxShadow: `inset 3px 0 0 ${INCOMING}`,
    backgroundColor: `color-mix(in srgb, ${INCOMING} 26%, transparent)`,
    color: INCOMING,
    fontWeight: "700",
  },
  ".cm-line.cm-conflictBaseMarker": {
    boxShadow: "inset 3px 0 0 var(--muted-foreground)",
    backgroundColor: "color-mix(in srgb, var(--muted-foreground) 16%, transparent)",
    color: "var(--muted-foreground)",
    fontWeight: "700",
  },
  ".cm-line.cm-conflictDivider": {
    background: `linear-gradient(90deg, color-mix(in srgb, ${CURRENT} 20%, transparent), color-mix(in srgb, ${INCOMING} 22%, transparent))`,
    color: "var(--muted-foreground)",
    fontWeight: "700",
  },
});
